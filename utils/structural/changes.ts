import { hunkOps, type PrHunk } from "../github/pr-diff";

/**
 * A changed token's extent on one line: a 1-based line of its own file, and 0-based UTF-16
 * columns, `endCol` exclusive.
 */
export interface TokenSpan {
  readonly line: number;
  readonly startCol: number;
  readonly endCol: number;
}

/**
 * What a structural engine found in one changed file: each version's changed tokens, a token on
 * several lines as one span per line.
 */
export interface StructuralChanges {
  readonly old: readonly TokenSpan[];
  readonly new: readonly TokenSpan[];
}

/** 0-based UTF-16 columns of one line, `endCol` exclusive. */
export interface ColumnRange {
  readonly startCol: number;
  readonly endCol: number;
}

/**
 * What to paint on one `+` or `-` line: its changed tokens' ranges in column order, or quiet when
 * it has none.
 */
export type LineAnnotation =
  | { readonly quiet: true }
  | { readonly quiet: false; readonly ranges: readonly ColumnRange[] };

/**
 * Annotations for one version of a file, old or new, keyed by its 1-based line number. A record,
 * not a `Map`, so it survives an extension port.
 */
export type AnnotationsByLine = Readonly<Record<number, LineAnnotation>>;

/** A file's annotations for its `-` lines (`old`) and its `+` lines (`new`). */
export interface LineAnnotations {
  readonly old: AnnotationsByLine;
  readonly new: AnnotationsByLine;
}

/** A changed line's text by 1-based line number, as the engine read it, without its line terminator. */
export type TextByLine = Readonly<Record<number, string>>;

/** What structural mode knows about one changed file: its annotations and the text they were computed from. */
export interface StructuralFile {
  readonly annotations: LineAnnotations;
  readonly text: { readonly old: TextByLine; readonly new: TextByLine };
}

/**
 * Annotations for the `+` and `-` lines of `hunks`. A span on any other line is dropped: context
 * text is the same on both sides, so a token reported there is the engine's mismatch, not a
 * change. Columns are passed through unchecked: `changes` must come from the texts these hunks
 * describe. `undefined` when a hunk's body cannot be read.
 */
export function annotateLines(
  changes: StructuralChanges,
  hunks: readonly PrHunk[],
): LineAnnotations | undefined {
  const oldRanges = rangesByLine(changes.old);
  const newRanges = rangesByLine(changes.new);
  const oldAnnotations: Record<number, LineAnnotation> = {};
  const newAnnotations: Record<number, LineAnnotation> = {};

  for (const hunk of hunks) {
    const ops = hunkOps(hunk.lines);
    if (ops === undefined) return undefined;
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const { kind } of ops) {
      if (kind === "-") oldAnnotations[oldLine] = annotationOf(oldRanges.get(oldLine));
      if (kind === "+") newAnnotations[newLine] = annotationOf(newRanges.get(newLine));
      if (kind !== "+") oldLine++;
      if (kind !== "-") newLine++;
    }
  }

  return { old: oldAnnotations, new: newAnnotations };
}

/** `spans` grouped by line, each line's ranges in column order. */
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
