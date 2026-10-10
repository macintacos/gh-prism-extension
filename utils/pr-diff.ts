export type PrFileStatus = "added" | "deleted" | "modified" | "renamed";

/**
 * One file of a PR's `.diff`. A text file's `patch` is its hunks from the first `@@` to the last
 * line, with no trailing newline — the REST API's `patch` shape — and is empty for a mode-only
 * change or a pure rename.
 */
export type PrFileDiff =
  | {
      kind: "text";
      path: string;
      previousPath?: string;
      status: PrFileStatus;
      patch: string;
    }
  | {
      kind: "binary";
      path: string;
      previousPath?: string;
      status: PrFileStatus;
    };

/** One `@@` hunk of a {@link PrFileDiff} patch. */
export interface PrHunk {
  /** 1-based head-file line where the hunk's new side starts; 0 for a deleted file's `+0,0`. */
  readonly newStart: number;
  /** The hunk's body lines, each keeping git's ` `, `+`, `-` or `\` prefix. */
  readonly lines: readonly string[];
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Splits a text file's `patch` at each `@@` header, dropping the header's function context. */
export function parsePrHunks(patch: string): PrHunk[] {
  const hunks: { newStart: number; lines: string[] }[] = [];
  for (const line of patch.split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) hunks.push({ newStart: Number(header[1]), lines: [] });
    else hunks.at(-1)?.lines.push(line);
  }
  return hunks;
}

/** A run of head-file lines, 1-based and inclusive. */
export interface HeadLineSpan {
  readonly first: number;
  readonly last: number;
}

/** The head-file lines a hunk's new side covers; `undefined` when it has none. */
export function hunkHeadSpan(hunk: PrHunk): HeadLineSpan | undefined {
  // A patch has no trailing newline, or its final empty line would count as a head line.
  const count = hunk.lines.filter((line) => !line.startsWith("-") && !line.startsWith("\\")).length;
  return count === 0 ? undefined : { first: hunk.newStart, last: hunk.newStart + count - 1 };
}

/** Splits a unified `git diff` into one entry per file. */
export function parsePrDiff(diff: string): PrFileDiff[] {
  const blocks: string[][] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) blocks.push([line]);
    else blocks.at(-1)?.push(line);
  }
  return blocks.map(parseBlock);
}

function parseBlock(block: string[]): PrFileDiff {
  while (block.length > 1 && block.at(-1) === "") block.pop();
  const hunkStart = block.findIndex((line) => line.startsWith("@@"));
  const header = hunkStart === -1 ? block : block.slice(0, hunkStart);
  const headerValue = (prefix: string) =>
    header.find((line) => line.startsWith(prefix))?.slice(prefix.length);

  const renameFrom = headerValue("rename from ");
  const status: PrFileStatus =
    headerValue("new file mode") !== undefined
      ? "added"
      : headerValue("deleted file mode") !== undefined
        ? "deleted"
        : renameFrom !== undefined
          ? "renamed"
          : "modified";
  const path = pathOf(header, headerValue);
  const previousPath = renameFrom === undefined ? {} : { previousPath: unquote(renameFrom) };

  if (
    header.some((line) => line.startsWith("Binary files ") || line.startsWith("GIT binary patch"))
  )
    return { kind: "binary", path, ...previousPath, status };
  const patch = hunkStart === -1 ? "" : block.slice(hunkStart).join("\n");
  return { kind: "text", path, ...previousPath, status, patch };
}

function pathOf(header: string[], headerValue: (prefix: string) => string | undefined): string {
  const renameTo = headerValue("rename to ");
  if (renameTo !== undefined) return unquote(renameTo);
  const newName = headerValue("+++ ");
  if (newName !== undefined && newName !== "/dev/null") return dropPrefix(unquote(newName));
  const oldName = headerValue("--- ");
  if (oldName !== undefined && oldName !== "/dev/null") return dropPrefix(unquote(oldName));

  const names = header[0]?.slice("diff --git ".length) ?? "";
  if (names.endsWith('"')) {
    const separator = names.lastIndexOf(' "');
    return dropPrefix(unquote(names.slice(separator + 1)));
  }
  // No ---/+++/rename lines, so both names are equal: "a/<p> b/<p>" is 2n + 5 characters.
  return names.slice(2, 2 + (names.length - 5) / 2);
}

const dropPrefix = (name: string) => name.replace(/^[ab]\//, "");

/** Decodes git's C-quoted path; git appends a tab to a ---/+++ name containing a space. */
function unquote(raw: string): string {
  const name = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  if (!name.startsWith('"')) return name;
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const body = name.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body[i] ?? "";
    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const escaped = body[++i] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(i));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 2;
    } else {
      bytes.push(
        ...encoder.encode(
          { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r" }[escaped] ?? escaped,
        ),
      );
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
