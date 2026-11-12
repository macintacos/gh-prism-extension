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
  /**
   * Each version's 1-based lines holding a token that changed inside a syntax unit that remains,
   * such as a name removed from a wrapped import. Absent when the file has no syntax tree.
   */
  readonly inside?: { readonly old: readonly number[]; readonly new: readonly number[] };
}

/** 0-based UTF-16 columns of one line, `endCol` exclusive. */
export interface ColumnRange {
  readonly startCol: number;
  readonly endCol: number;
}

/**
 * What to paint on one line the page draws as changed: its changed tokens' ranges in column order,
 * or quiet when it has none. `inside` is set when a token of the line changed inside a syntax unit
 * that remains.
 */
export type LineAnnotation =
  | { readonly quiet: true }
  | { readonly quiet: false; readonly ranges: readonly ColumnRange[]; readonly inside?: true };

/**
 * Annotations for one version of a file, old or new, keyed by its 1-based line number. A record,
 * not a `Map`, so it survives an extension port.
 */
export type AnnotationsByLine = Readonly<Record<number, LineAnnotation>>;

/** A file's annotations for its old lines and its new lines. */
export interface LineAnnotations {
  readonly old: AnnotationsByLine;
  readonly new: AnnotationsByLine;
}

/** A line's text by 1-based line number, as the engine read it, without its line terminator. */
export type TextByLine = Readonly<Record<number, string>>;

/** What structural mode knows about one changed file: its annotations and the text they were computed from. */
export interface StructuralFile {
  readonly annotations: LineAnnotations;
  readonly text: { readonly old: TextByLine; readonly new: TextByLine };
}

/** {@link structuralFile}'s annotations alone. */
export function annotateLines(
  changes: StructuralChanges,
  hunks: readonly PrHunk[],
): LineAnnotations | undefined {
  return structuralFile(changes, hunks)?.annotations;
}

/**
 * Annotations for every line of `hunks`, with each line's text from `hunks`, without its line
 * terminator. A context line is annotated on both sides: a page that hides whitespace changes
 * aligns the two texts another way and draws some of these context lines as changed. A span
 * outside the hunks is dropped. Columns are passed through unchecked: `changes` must come from the
 * texts these hunks describe. `undefined` when a hunk's body cannot be read.
 */
export function structuralFile(
  changes: StructuralChanges,
  hunks: readonly PrHunk[],
): StructuralFile | undefined {
  const oldRanges = rangesByLine(changes.old);
  const newRanges = rangesByLine(changes.new);
  const oldInside = new Set(changes.inside?.old);
  const newInside = new Set(changes.inside?.new);
  const oldAnnotations: Record<number, LineAnnotation> = {};
  const newAnnotations: Record<number, LineAnnotation> = {};
  const oldText: Record<number, string> = {};
  const newText: Record<number, string> = {};

  for (const hunk of hunks) {
    const ops = hunkOps(hunk.lines);
    if (ops === undefined) return undefined;
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const { kind, text } of ops) {
      const lineText = text.endsWith("\n") ? text.slice(0, -1) : text;
      if (kind !== "+") {
        oldAnnotations[oldLine] = annotationOf(oldRanges.get(oldLine), oldInside.has(oldLine));
        oldText[oldLine] = lineText;
        oldLine++;
      }
      if (kind !== "-") {
        newAnnotations[newLine] = annotationOf(newRanges.get(newLine), newInside.has(newLine));
        newText[newLine] = lineText;
        newLine++;
      }
    }
  }

  return {
    annotations: { old: oldAnnotations, new: newAnnotations },
    text: { old: oldText, new: newText },
  };
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

function annotationOf(ranges: readonly ColumnRange[] | undefined, inside: boolean): LineAnnotation {
  if (ranges === undefined) return { quiet: true };
  return inside ? { quiet: false, ranges, inside } : { quiet: false, ranges };
}
