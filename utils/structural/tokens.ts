import type { Tree } from "web-tree-sitter";

/** One token of a text: UTF-16 offsets, `end` exclusive, and the string the diff compares. */
export interface Token {
  readonly start: number;
  readonly end: number;
  readonly key: string;
}

/**
 * `tree`'s leaves in source order as tokens keyed by their text; a parent's own non-blank text
 * between its children is a token too. `undefined` past `maxTokens`.
 */
export function leafTokens(tree: Tree, text: string, maxTokens: number): Token[] | undefined {
  const tokens: Token[] = [];
  const parentEnds: number[] = [];
  let covered = 0;
  const push = (start: number, end: number) =>
    tokens.push({ start, end, key: text.slice(start, end) }) <= maxTokens;
  const fillTo = (end: number) => {
    const ok =
      parentEnds.length === 0 ||
      end <= covered ||
      !/\S/.test(text.slice(covered, end)) ||
      push(covered, end);
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
      if (end > start && !push(start, end)) return undefined;
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

const BRACKET_DEPTH: Record<string, number> = { "(": 1, "[": 1, "{": 1, ")": -1, "]": -1, "}": -1 };

/** `tokens` with each logical line's block depth prefixed to the key of the line's first token. */
export function keyedByIndentation(tokens: readonly Token[], text: string): Token[] {
  // ponytail: a tab counts as one column; a backslash continuation, a comment-only line, and a
  // closing `"""` on its own line each read as a new logical line. Tokenize like CPython if these bite.
  const widths: number[] = [];
  let bracketDepth = 0;
  let lastLineStart = -1;

  return tokens.map((token) => {
    const lineStart = text.lastIndexOf("\n", token.start - 1) + 1;
    const firstOnLine = lineStart !== lastLineStart;
    lastLineStart = lineStart;
    const keyed =
      firstOnLine && bracketDepth === 0 ? withDepth(token, text, lineStart, widths) : token;
    bracketDepth += BRACKET_DEPTH[token.key] ?? 0;
    return keyed;
  });
}

/** `token` keyed by its line's block depth, after updating `widths` (mutated) with the line's indent. */
function withDepth(token: Token, text: string, lineStart: number, widths: number[]): Token {
  const width = /^[ \t]*/.exec(text.slice(lineStart, token.start))?.[0].length ?? 0;
  if (width > (widths.at(-1) ?? 0)) widths.push(width);
  while ((widths.at(-1) ?? 0) > width) widths.pop();
  return { ...token, key: `${widths.length}\u0000${token.key}` };
}
