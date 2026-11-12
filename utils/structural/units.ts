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
 */
export function wholeLineUnits(tree: Tree, text: string): Unit[] {
  const units: (Unit | undefined)[] = [];
  const levelOf = (start: number, end: number): Level => ({
    start,
    end,
    lastType: undefined,
    lastStart: start,
    lastOneLineUnit: undefined,
  });
  const levels = [levelOf(0, 0)];

  const cursor = tree.walk();
  try {
    for (;;) {
      const { startIndex: start, endIndex, nodeType: type } = cursor;
      const level = levels.at(-1) as Level;
      const end = withoutTrailingSpace(text, start, endIndex);
      const separates = type === SEPARATOR;
      if (separates && level.lastOneLineUnit !== undefined)
        units[level.lastOneLineUnit] = undefined;

      // A terminator or separator closes the sibling before it, so the unit starts there.
      const closes = (separates || type === TERMINATOR) && level.lastType !== undefined;
      const from = closes ? level.lastStart : start;
      const lineBreak = text.indexOf("\n", from);
      const oneLine = lineBreak === -1 || lineBreak >= end;
      const isEntry = separates || level.lastType === SEPARATOR;
      const isUnit = !(isEntry && oneLine) && hasItsLines(text, from, end);
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
  while (at > start && /\s/.test(text[at - 1] as string)) at--;
  return at;
}

/** Whether `text` from `start` to `end` isn't empty and only whitespace shares its lines. */
function hasItsLines(text: string, start: number, end: number): boolean {
  if (end <= start) return false;

  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineBreak = text.indexOf("\n", end);
  const lineEnd = lineBreak === -1 ? text.length : lineBreak;
  return text.slice(lineStart, start).trim() === "" && text.slice(end, lineEnd).trim() === "";
}
