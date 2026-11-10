import { type PrFileDiff, type PrHunk, parsePrHunks } from "../github/pr-diff";

/** Where a reverse apply stands: the old lines so far, the next head line, and each side's no-newline marker. */
interface Rebuild {
  readonly old: string[];
  cursor: number;
  oldMarked: boolean;
  headMarked: boolean;
}

/**
 * The old text of `file`, rebuilt by applying its patch in reverse to `head`, its head text.
 * `undefined` when there is no old text to rebuild — a binary, added or deleted file, or one with
 * no hunks, as a pure rename or a mode-only change — and when the patch does not apply to `head`.
 */
export function baseText(file: PrFileDiff, head: string): string | undefined {
  if (file.kind === "binary" || file.status === "added" || file.status === "deleted")
    return undefined;
  const hunks = parsePrHunks(file.patch);
  if (hunks.length === 0) return undefined;

  const headLines = head.split("\n");
  const headEndsWithNewline = headLines.at(-1) === "";
  if (headEndsWithNewline) headLines.pop();

  const state: Rebuild = { old: [], cursor: 0, oldMarked: false, headMarked: false };
  if (!hunks.every((hunk) => applyHunk(state, hunk, headLines))) return undefined;
  if (!finishHead(state, headLines, headEndsWithNewline)) return undefined;

  const endsWithNewline = state.oldMarked ? false : state.headMarked || headEndsWithNewline;
  return state.old.length === 0 ? "" : state.old.join("\n") + (endsWithNewline ? "\n" : "");
}

/** Applies one hunk in reverse, copying the untouched head lines before it; `false` when it does not apply. */
function applyHunk(state: Rebuild, hunk: PrHunk, headLines: readonly string[]): boolean {
  if (state.oldMarked || state.headMarked) return false;
  const start = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
  if (start < state.cursor || start > headLines.length) return false;
  state.old.push(...headLines.slice(state.cursor, start));
  state.cursor = start;
  if (state.old.length !== (hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1)) return false;

  const oldBefore = state.old.length;
  let previous: string | undefined;
  for (const line of hunk.lines) {
    if (!applyLine(state, line, previous, headLines)) return false;
    previous = line;
  }

  return state.cursor - start === hunk.newCount && state.old.length - oldBefore === hunk.oldCount;
}

/** Applies one body line; `previous` is the body line before it, if any. */
function applyLine(
  state: Rebuild,
  line: string,
  previous: string | undefined,
  headLines: readonly string[],
): boolean {
  const prefix = line[0];
  if (prefix === "\\") return markNoNewline(state, previous);
  if (prefix === "-") {
    if (state.oldMarked) return false;
    state.old.push(line.slice(1));
    return true;
  }
  if (prefix === "+") {
    if (state.headMarked || !matchesHead(state, line.slice(1), headLines)) return false;
    state.cursor++;
    return true;
  }
  if (prefix !== " " && prefix !== undefined) return false;

  const text = line.slice(1);
  if (state.oldMarked || state.headMarked || !matchesHead(state, text, headLines)) return false;
  state.old.push(text);
  state.cursor++;
  return true;
}

function matchesHead(state: Rebuild, text: string, headLines: readonly string[]): boolean {
  return state.cursor < headLines.length && headLines[state.cursor] === text;
}

/** Marks the side(s) of `previous` as ending without a newline; `false` for a marker with no line to mark. */
function markNoNewline(state: Rebuild, previous: string | undefined): boolean {
  if (previous === undefined || previous.startsWith("\\")) return false;
  if (!previous.startsWith("+")) state.oldMarked = true;
  if (!previous.startsWith("-")) state.headMarked = true;
  return true;
}

/** Checks head's end against the markers and copies the head lines after the last hunk; `false` on a mismatch. */
function finishHead(
  state: Rebuild,
  headLines: readonly string[],
  headEndsWithNewline: boolean,
): boolean {
  const atEnd = state.cursor === headLines.length;
  if (state.headMarked) return atEnd && !headEndsWithNewline;
  if (state.oldMarked) return atEnd;
  if (atEnd) return headEndsWithNewline;

  state.old.push(...headLines.slice(state.cursor));
  return true;
}
