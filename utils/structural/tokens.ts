import type { Tree } from "web-tree-sitter";

/** One token of a text: UTF-16 offsets, `end` exclusive, and the string the diff compares. */
export interface Token {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  /** The leaf's tree-sitter node type; `""` for a parent's own text between its children. */
  readonly type: string;
}

/** Leaf types whose continuation lines' indentation is layout, not content. */
const INDENT_FREE_TYPES = new Set(["comment", "jsx_text"]);

/**
 * `tree`'s leaves in source order as tokens keyed by their text; a parent's own non-blank text
 * between its children is a token too. A comment or JSX text is keyed without its continuation
 * lines' leading whitespace. `undefined` past `maxTokens`.
 */
export function leafTokens(tree: Tree, text: string, maxTokens: number): Token[] | undefined {
  const tokens: Token[] = [];
  const parentEnds: number[] = [];
  let covered = 0;
  const push = (start: number, end: number, type: string) => {
    const raw = text.slice(start, end);
    const key = INDENT_FREE_TYPES.has(type) ? raw.replace(/\n[ \t]*/g, "\n") : raw;
    return tokens.push({ start, end, key, type }) <= maxTokens;
  };
  const fillTo = (end: number) => {
    const ok =
      parentEnds.length === 0 || // text outside the root node is not a token
      end <= covered ||
      !/\S/.test(text.slice(covered, end)) ||
      push(covered, end, "");
    covered = Math.max(covered, end);
    return ok;
  };

  const cursor = tree.walk();
  try {
    for (;;) {
      const { startIndex: start, endIndex: end } = cursor;
      if (!fillTo(start)) return undefined;
      if (cursor.gotoFirstChild()) {
        parentEnds.push(end);
        continue;
      }
      if (end > start && !push(start, end, cursor.nodeType)) return undefined;
      covered = Math.max(covered, end);
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return tokens;
        if (!fillTo(parentEnds.pop() ?? covered)) return undefined;
      }
    }
  } finally {
    cursor.delete();
  }
}

// A line inside brackets is a continuation line and carries no depth, so a rewrap stays quiet.
const BRACKET_DEPTH: Record<string, number> = { "(": 1, "[": 1, "{": 1, ")": -1, "]": -1, "}": -1 };

/** Joins a depth to a key; no source token contains it, so a depth never collides with text. */
export const DEPTH_SEPARATOR = "\u0000";

/** `tokens` with each logical line's block depth prefixed to the key of the line's first token. */
export function keyedByIndentation(tokens: readonly Token[], text: string): Token[] {
  // ponytail: a tab counts as one column, and a backslash continuation or a string's
  // continuation line reads as a new logical line. Tokenize like CPython if these bite.
  const starts = lineStarts(text);
  const widths: number[] = [];
  let bracketDepth = 0;
  let line = -1;

  return tokens.map((token) => {
    const previousLine = line;
    while ((starts[line + 1] ?? Infinity) <= token.start) line++;
    const lineStart = starts[line] ?? 0;
    const startsLogicalLine =
      line !== previousLine && bracketDepth === 0 && token.type !== "comment";
    const keyed = startsLogicalLine ? withDepth(token, text, lineStart, widths) : token;
    bracketDepth += BRACKET_DEPTH[token.type] ?? 0;
    return keyed;
  });
}

/** The offset of each line's first character; a trailing `\n` starts no extra line. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (
    let at = text.indexOf("\n");
    at !== -1 && at + 1 < text.length;
    at = text.indexOf("\n", at + 1)
  )
    starts.push(at + 1);
  return starts;
}

/**
 * `token` keyed by its line's block depth, after updating `widths` (mutated) with the line's
 * indent.
 */
function withDepth(token: Token, text: string, lineStart: number, widths: number[]): Token {
  const width = /^[ \t]*/.exec(text.slice(lineStart, token.start))?.[0].length ?? 0;
  if (width > (widths.at(-1) ?? 0)) widths.push(width);
  while ((widths.at(-1) ?? 0) > width) widths.pop();
  return { ...token, key: `${widths.length}${DEPTH_SEPARATOR}${token.key}` };
}
