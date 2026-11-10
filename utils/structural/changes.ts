import { hunkOps, type PrHunk } from "../github/pr-diff";

/** A new token's extent on one line: a 1-based line of its own file, and UTF-16 columns, `endCol` exclusive. */
export interface TokenSpan {
  readonly line: number;
  readonly startCol: number;
  readonly endCol: number;
}

/** What a structural engine found in one changed file: each side's new tokens, a token on several lines as one span per line. */
export interface StructuralChanges {
  readonly old: readonly TokenSpan[];
  readonly new: readonly TokenSpan[];
}

/** UTF-16 columns of one line, `endCol` exclusive. */
export interface ColumnRange {
  readonly startCol: number;
  readonly endCol: number;
}

/** What to paint on one `+` or `-` line: its new tokens' ranges in column order, or quiet when it has none. */
export type LineAnnotation =
  | { readonly quiet: true }
  | { readonly quiet: false; readonly ranges: readonly ColumnRange[] };

/** One side's annotations, keyed by that file's 1-based line number. */
export type SideAnnotations = Readonly<Record<number, LineAnnotation>>;

/** A file's annotations for its `-` lines (`old`) and its `+` lines (`new`). */
export interface LineAnnotations {
  readonly old: SideAnnotations;
  readonly new: SideAnnotations;
}

/**
 * Annotations for the `+` and `-` lines of `hunks`. A span on any other line is dropped: context
 * text is the same on both sides, so a new token there is a mismatched match, not a change.
 * `undefined` when a hunk's body cannot be read.
 */
export function annotateLines(
  changes: StructuralChanges,
  hunks: readonly PrHunk[],
): LineAnnotations | undefined {
  const oldRanges = rangesByLine(changes.old);
  const newRanges = rangesByLine(changes.new);
  const oldLines: Record<number, LineAnnotation> = {};
  const newLines: Record<number, LineAnnotation> = {};

  for (const hunk of hunks) {
    const ops = hunkOps(hunk.lines);
    if (ops === undefined) return undefined;
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const { kind } of ops) {
      if (kind === "-") oldLines[oldLine] = annotationOf(oldRanges.get(oldLine));
      if (kind === "+") newLines[newLine] = annotationOf(newRanges.get(newLine));
      if (kind !== "+") oldLine++;
      if (kind !== "-") newLine++;
    }
  }

  return { old: oldLines, new: newLines };
}

function rangesByLine(spans: readonly TokenSpan[]): Map<number, ColumnRange[]> {
  const byLine = new Map<number, ColumnRange[]>();
  for (const { line, startCol, endCol } of spans) {
    const ranges = byLine.get(line) ?? [];
    ranges.push({ startCol, endCol });
    byLine.set(line, ranges);
  }
  for (const ranges of byLine.values()) ranges.sort((a, b) => a.startCol - b.startCol);
  return byLine;
}

function annotationOf(ranges: readonly ColumnRange[] | undefined): LineAnnotation {
  return ranges === undefined ? { quiet: true } : { quiet: false, ranges };
}
