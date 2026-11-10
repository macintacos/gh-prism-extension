import { hunkOps, type PrFileDiff, type PrHunk, parsePrHunks } from "../github/pr-diff";

/**
 * The old text of `file`, rebuilt by applying its patch in reverse to `head`, its head text.
 * `undefined` when there is no old text to rebuild — a binary, added or deleted file, or one with
 * no hunks, as a pure rename or a mode-only change — and when the patch does not apply to `head`.
 * `head` must be the exact text: line endings are compared as they are.
 */
export function baseText(file: PrFileDiff, head: string): string | undefined {
  if (file.kind === "binary" || file.status === "added" || file.status === "deleted")
    return undefined;
  const hunks = parsePrHunks(file.patch);
  if (hunks.length === 0) return undefined;

  // Each line keeps its "\n", so head's last line without one matches only a marked patch line.
  const headLines = head.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const old: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const next = applyHunk(hunk, headLines, cursor, old);
    if (next === undefined) return undefined;
    cursor = next;
  }
  copyLines(headLines, cursor, headLines.length, old);

  // Only a text's last line may lack its newline.
  if (old.some((line, i) => i < old.length - 1 && !line.endsWith("\n"))) return undefined;
  return old.join("");
}

/**
 * Applies one hunk in reverse onto `old`, copying the untouched head lines before it; the next head
 * line's index, or `undefined` when the hunk does not apply.
 */
function applyHunk(
  hunk: PrHunk,
  headLines: readonly string[],
  cursor: number,
  old: string[],
): number | undefined {
  const start = linesBefore(hunk.newStart, hunk.newCount);
  if (start < cursor || start > headLines.length) return undefined;
  copyLines(headLines, cursor, start, old);
  if (old.length !== linesBefore(hunk.oldStart, hunk.oldCount)) return undefined;

  const ops = hunkOps(hunk.lines);
  if (ops === undefined) return undefined;
  const oldBefore = old.length;
  let next = start;
  for (const { kind, text } of ops) {
    if (kind !== "-" && headLines[next++] !== text) return undefined;
    if (kind !== "+") old.push(text);
  }

  return next - start === hunk.newCount && old.length - oldBefore === hunk.oldCount
    ? next
    : undefined;
}

/** Lines before a hunk side: a zero-count side's start names the line before it. */
const linesBefore = (start: number, count: number): number => (count === 0 ? start : start - 1);

/** Copies `lines[from..to)` onto `into` without spreading, which overflows the stack on long runs. */
function copyLines(lines: readonly string[], from: number, to: number, into: string[]): void {
  for (const line of lines.slice(from, to)) into.push(line);
}
