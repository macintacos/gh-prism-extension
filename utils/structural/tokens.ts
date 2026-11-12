import type { Tree } from "web-tree-sitter";
import { type Spacing, wordTokens } from "./words";

/** One token of a text: UTF-16 offsets, `end` exclusive, and the string the diff compares. */
export interface Token {
  readonly start: number;
  readonly end: number;
  readonly key: string;
  /**
   * The leaf's tree-sitter node type. A parent's own text between its children has its parent's
   * type when that holds a string's text, and `""` otherwise.
   */
  readonly type: string;
}

/** Node types that hold a comment; a grammar joins by naming its comment kinds here. */
const COMMENT_TYPES = new Set([
  ...["comment", "line_comment", "block_comment", "multiline_comment", "comment_content"],
]);

/** Node types that hold other running text, with how their words' spacing counts. */
const TEXT_SPACING = new Map<string, Spacing>([
  ["jsx_text", "collapsed"],
  ["text", "collapsed"],
  ["string_fragment", "exact"],
  ["string_content", "exact"],
]);

/** Whether a token of `type` is a word of a comment or of other running text. */
const isWord = (type: string) => COMMENT_TYPES.has(type) || TEXT_SPACING.has(type);

/**
 * `tree`'s leaves in source order as tokens keyed by their text; a parent's own non-blank text
 * between its children is a token too. A comment, a string's text, and JSX text are one token
 * per word instead. `undefined` past `maxTokens`.
 */
export function leafTokens(tree: Tree, text: string, maxTokens: number): Token[] | undefined {
  const tokens: Token[] = [];
  const parents: { end: number; type: string }[] = [];
  let covered = 0;
  // The marker of the comment the last token came from, which a comment after it continues.
  let openMarker: string | undefined;
  const tokensOf = (start: number, end: number, type: string): Token[] => {
    const range = { start, end };
    const continued = openMarker;
    openMarker = undefined;
    const spacing = TEXT_SPACING.get(type);
    if (spacing) return wordTokens(text, range, type, spacing);
    if (!COMMENT_TYPES.has(type)) return [{ start, end, key: text.slice(start, end), type }];

    const comment = commentTokens(text, range, type);
    openMarker = comment.marker;
    return comment.marker && comment.marker === continued ? comment.words : comment.tokens;
  };
  const push = (start: number, end: number, type: string) => {
    for (const token of tokensOf(start, end, type)) tokens.push(token);
    return tokens.length <= maxTokens;
  };
  const fillTo = (end: number, parentType: string | undefined) => {
    const ok =
      parentType === undefined || // text outside the root node is not a token
      end <= covered ||
      !/\S/.test(text.slice(covered, end)) ||
      push(covered, end, TEXT_SPACING.has(parentType) ? parentType : "");
    covered = Math.max(covered, end);
    return ok;
  };

  const cursor = tree.walk();
  try {
    for (;;) {
      const { startIndex: start, endIndex: end, nodeType: type } = cursor;
      if (!fillTo(start, parents.at(-1)?.type)) return undefined;
      if (cursor.gotoFirstChild()) {
        parents.push({ end, type });
        continue;
      }
      if (end > start && !push(start, end, type)) return undefined;
      covered = Math.max(covered, end);
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return tokens;
        const parent = parents.pop();
        if (!fillTo(parent?.end ?? covered, parent?.type)) return undefined;
      }
    }
  } finally {
    cursor.delete();
  }
}

/** Starts a comment token's key; no source token contains it, so a comment never matches code. */
const COMMENT_KEY = "\u0000";

/** A comment's tokens: `tokens` is `words` after one token for `marker`, when it has one. */
interface CommentTokens {
  /** The punctuation that opens the comment, such as `//`, `#`, or `/**`; `""` without any. */
  readonly marker: string;
  readonly words: Token[];
  readonly tokens: Token[];
}

/**
 * The comment at `range`, one token per word. The `*` that leads a later line is layout and gets
 * none, so a re-wrap changes no token.
 */
function commentTokens(
  text: string,
  { start, end }: { readonly start: number; readonly end: number },
  type: string,
): CommentTokens {
  const keyed = (token: Token): Token => ({ ...token, key: `${COMMENT_KEY}${token.key}` });
  const marker = /^[^\s\p{L}\p{N}_]*/u.exec(text.slice(start, end))?.[0] ?? "";
  const words: Token[] = [];
  const lineLeader = /[ \t]*\*+(?!\/)/y;
  let from = start + marker.length;

  while (from < end) {
    const lineBreak = text.indexOf("\n", from);
    const to = lineBreak === -1 || lineBreak > end ? end : lineBreak;
    for (const token of wordTokens(text, { start: from, end: to }, type, "ignored"))
      words.push(keyed(token));

    lineLeader.lastIndex = to + 1;
    lineLeader.exec(text);
    from = Math.max(to + 1, lineLeader.lastIndex);
  }

  const opener = keyed({ start, end: start + marker.length, key: marker, type });
  return { marker, words, tokens: marker ? [opener, ...words] : words };
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
    const startsLogicalLine = line !== previousLine && bracketDepth === 0 && !isWord(token.type);
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
