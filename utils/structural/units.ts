import type { Tree } from "web-tree-sitter";

/**
 * A stretch of syntax that has its lines to itself, with its parent node's extent: UTF-16 offsets,
 * `end` exclusive. The root's parent is empty.
 */
export interface Unit {
  readonly start: number;
  readonly end: number;
  readonly parentStart: number;
  readonly parentEnd: number;
}

/** What separates the entries of a list. */
const SEPARATOR = ",";

/** What ends a member or a statement whose node leaves it out. */
const TERMINATOR = ";";

/** What a level of the walk remembers of the sibling before the cursor's node. */
interface Level {
  readonly start: number;
  readonly end: number;
  lastType: string | undefined;
  lastStart: number;
  /** The index in the walk's units of that sibling, when it is a unit on one line. */
  lastOneLineUnit: number | undefined;
}

/**
 * `tree`'s units in source order: each node that starts at its line's first token and ends at its
 * line's last, alone or with the terminator or separator after it. A list's entry on one line is
 * part of its list and never a unit; an entry on several lines is one.
 *
 * @param starts - `text`'s {@link lineStarts}.
 */
export function wholeLineUnits(tree: Tree, text: string, starts: readonly number[]): Unit[] {
  const units: (Unit | undefined)[] = [];
  const levelOf = (start: number, end: number): Level => ({
    start,
    end,
    lastType: undefined,
    lastStart: start,
    lastOneLineUnit: undefined,
  });
  const root = levelOf(0, 0);
  const levels = [root];
  const lines = inkedLines(text, starts);

  const cursor = tree.walk();
  try {
    for (;;) {
      const { startIndex: start, endIndex, nodeType: type } = cursor;
      const level = levels.at(-1) ?? root;
      const end = withoutTrailingSpace(text, start, endIndex);
      const separates = type === SEPARATOR;
      if (separates && level.lastOneLineUnit !== undefined)
        units[level.lastOneLineUnit] = undefined;

      // A terminator or separator closes the sibling before it, so the unit starts there.
      const closes = (separates || type === TERMINATOR) && level.lastType !== undefined;
      const from = closes ? level.lastStart : start;
      const oneLine = end <= from || lines.sameLine(from, end);
      const isEntry = separates || level.lastType === SEPARATOR;
      const isUnit = !(isEntry && oneLine) && lines.hasItsLines(from, end);
      level.lastOneLineUnit = isUnit && oneLine ? units.length : undefined;
      level.lastType = type;
      level.lastStart = start;
      if (isUnit) units.push({ start: from, end, parentStart: level.start, parentEnd: level.end });

      if (cursor.gotoFirstChild()) {
        levels.push(levelOf(start, end));
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return units.filter((unit) => unit !== undefined);
        levels.pop();
      }
    }
  } finally {
    cursor.delete();
  }
}

/** `end`, moved back over the whitespace that ends `text` from `start` to it. */
function withoutTrailingSpace(text: string, start: number, end: number): number {
  let at = end;
  while (at > start && /\s/.test(text.charAt(at - 1))) at--;
  return at;
}

/** Line lookups on `text` that cost no scan of a line's characters per call. */
function inkedLines(text: string, starts: readonly number[]) {
  // Per line, where its first non-whitespace character is and where its last one ends; a blank
  // line's first is past its end and its last before its start.
  const first: number[] = [];
  const last: number[] = [];
  starts.forEach((lineStart, line) => {
    const lineEnd = starts[line + 1] ?? text.length;
    let from = lineStart;
    while (from < lineEnd && /\s/.test(text.charAt(from))) from++;
    let to = lineEnd;
    while (to > from && /\s/.test(text.charAt(to - 1))) to--;
    first.push(from === lineEnd ? Infinity : from);
    last.push(from === lineEnd ? -Infinity : to);
  });

  const lineOf = (at: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? Infinity) <= at) low = mid;
      else high = mid - 1;
    }
    return low;
  };

  return {
    /** Whether no line break lies in `[from, end)`, for `from < end`. */
    sameLine: (from: number, end: number) =>
      lineOf(from) === lineOf(end - 1) && text.charAt(end - 1) !== "\n",
    /** Whether `text` from `start` to `end` isn't empty and only whitespace shares its lines. */
    hasItsLines: (start: number, end: number) =>
      end > start &&
      (first[lineOf(start)] ?? Infinity) >= start &&
      (last[lineOf(end)] ?? -Infinity) <= end,
  };
}
