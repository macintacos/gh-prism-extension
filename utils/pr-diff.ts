export type PrFileStatus = "added" | "deleted" | "modified" | "renamed";

/** One file of a PR's `.diff`. A text file's `patch` is its hunks from the first `@@` to the last line, with no trailing newline — the REST API's `patch` shape — and is empty for a mode-only change or a pure rename. */
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
  const value = (prefix: string) =>
    header.find((line) => line.startsWith(prefix))?.slice(prefix.length);

  const renameFrom = value("rename from ");
  const status: PrFileStatus =
    value("new file mode") !== undefined
      ? "added"
      : value("deleted file mode") !== undefined
        ? "deleted"
        : renameFrom !== undefined
          ? "renamed"
          : "modified";
  const path = pathOf(header, value);
  const previousPath = renameFrom === undefined ? {} : { previousPath: unquote(renameFrom) };

  if (header.some((l) => l.startsWith("Binary files ") || l.startsWith("GIT binary patch")))
    return { kind: "binary", path, ...previousPath, status };
  const patch = hunkStart === -1 ? "" : block.slice(hunkStart).join("\n");
  return { kind: "text", path, ...previousPath, status, patch };
}

function pathOf(header: string[], value: (prefix: string) => string | undefined): string {
  const renameTo = value("rename to ");
  if (renameTo !== undefined) return unquote(renameTo);
  const newName = value("+++ ");
  if (newName !== undefined && newName !== "/dev/null") return dropPrefix(unquote(newName));
  const oldName = value("--- ");
  if (oldName !== undefined && oldName !== "/dev/null") return dropPrefix(unquote(oldName));

  const names = header[0]?.slice("diff --git ".length) ?? "";
  if (names.endsWith('"')) {
    const second = names.lastIndexOf(' "');
    return dropPrefix(unquote(names.slice(second + 1)));
  }
  return names.slice(2, 2 + (names.length - 5) / 2);
}

const dropPrefix = (name: string) => name.replace(/^[ab]\//, "");

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
    const next = body[++i] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(i));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 2;
    } else {
      bytes.push(...encoder.encode({ t: "\t", n: "\n" }[next] ?? next));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
