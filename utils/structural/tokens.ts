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
  /**
   * Set on the `*` that leads a comment's later line and on the marker of a line comment that
   * continues another. The diff skips it, so a re-wrap changes nothing; it counts as changed
   * when the rest of its line is.
   */
  readonly layout?: true;
}

/**
 * Node types that hold a comment, read whole whatever children the grammar gives them; a grammar
 * joins by naming its comment kinds here.
 */
const COMMENT_TYPES = new Set(["comment", "line_comment", "block_comment", "multiline_comment"]);

/** Markdown's code and front matter: read by word, each line's first word carrying its depth. */
const MARKDOWN_VERBATIM = [
  "code_fence_content",
  "indented_code_block",
  "minus_metadata",
  "plus_metadata",
];

/**
 * Markdown's text: prose, a table cell, an HTML block, a link reference definition's parts, and
 * {@link MARKDOWN_VERBATIM}. The grammar makes its punctuation and its continuation lines' quote
 * markers and indents children.
 */
const MARKDOWN_TEXT = new Set([
  "inline",
  "pipe_table_cell",
  "html_block",
  "link_label",
  "link_destination",
  "link_title",
  ...MARKDOWN_VERBATIM,
]);

/** A Markdown table's delimiter cell, whose dashes only pad it. */
const TABLE_DELIMITER = "pipe_table_delimiter_cell";

/** A YAML plain scalar, which a mapping's key is. */
const PLAIN_SCALAR = "string_scalar";

/** Words that carry their line's depth when they open it. */
const DEPTH_WORDS = new Set([PLAIN_SCALAR, ...MARKDOWN_VERBATIM]);

/** Each of `types` with `spacing`. */
const spaced = (spacing: Spacing, types: readonly string[]) =>
  types.map((type) => [type, spacing] as const);

/**
 * Node types that hold other running text, with how their words' spacing counts. A type that is
 * a parent gives it to its own text between its children; a grammar joins by naming its kinds
 * here.
 */
const TEXT_SPACING = new Map<string, Spacing>([
  // A table padded wider, re-indented HTML, and code respaced inside a line keep their words.
  ...spaced("ignored", [...MARKDOWN_TEXT]),
  // A re-indented block keeps its words; only a gap gained or lost is a change.
  ...spaced("collapsed", ["jsx_text", "text", "raw_text", "block_scalar"]),
  ...spaced("exact", ["string_fragment", "string_content", "multiline_string_fragment"]),
  ...spaced("exact", ["interpreted_string_literal_content", "raw_string_literal_content"]),
  ...spaced("exact", ["string_literal_content", "raw_string_content", "verbatim_string_literal"]),
  ...spaced("exact", ["line_str_text", "multi_line_str_text", "raw_str_end_part"]),
  ...spaced("exact", ["raw_string", "ansi_c_string", "heredoc_body", "heredoc_content"]),
  ...spaced("exact", ["nowdoc_string", "attribute_value"]),
  // YAML's quoted scalars and TOML's strings hold their text themselves, with no child for it.
  ...spaced("exact", [PLAIN_SCALAR, "double_quote_scalar", "single_quote_scalar", "string"]),
]);

/** Whether a token of `type` is a word of a comment or of other running text. */
export const isWord = (type: string) => COMMENT_TYPES.has(type) || TEXT_SPACING.has(type);

/**
 * `tree`'s leaves in source order as tokens keyed by their text; a parent's own non-blank text
 * between its children is a token too. A comment, a string's text, and other running text are
 * one token per word instead. `undefined` past `maxTokens`.
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
    const [opener, ...words] = comment.tokens;
    const continues = opener !== undefined && comment.marker !== "" && comment.marker === continued;
    return continues ? [{ ...opener, layout: true }, ...words] : comment.tokens;
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
      const parentType = parents.at(-1)?.type;
      if (!fillTo(start, parentType)) return undefined;
      if (!COMMENT_TYPES.has(type) && cursor.gotoFirstChild()) {
        parents.push({ end, type });
        continue;
      }
      // A continuation line's quote marker or indent inside text is layout, as a comment's `*` is.
      const textType = MARKDOWN_TEXT.has(parentType ?? "") ? parentType : undefined;
      const skipped =
        end === start ||
        (textType !== undefined && type === "block_continuation") ||
        (parentType === TABLE_DELIMITER && type === "-");
      if (!skipped && !push(start, end, textType ?? type)) return undefined;
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

/** A comment's tokens: one for `marker`, when it has one, then its words and line leaders. */
interface CommentTokens {
  /** The punctuation that opens the comment, such as `//`, `#`, or `/**`; `""` without any. */
  readonly marker: string;
  readonly tokens: Token[];
}

/** The comment at `range`, one token per word, and a layout token per `*` leading a later line. */
function commentTokens(
  text: string,
  { start, end }: { readonly start: number; readonly end: number },
  type: string,
): CommentTokens {
  const keyed = (token: Token): Token => ({ ...token, key: `${COMMENT_KEY}${token.key}` });
  const marker = /^[^\s\p{L}\p{N}_]*/u.exec(text.slice(start, end))?.[0] ?? "";
  const tokens: Token[] = [];
  if (marker) tokens.push(keyed({ start, end: start + marker.length, key: marker, type }));
  const lineLeader = /[ \t]*(\*+)(?!\/)/y;
  let from = start + marker.length;

  while (from < end) {
    const lineBreak = text.indexOf("\n", from);
    const to = lineBreak === -1 || lineBreak > end ? end : lineBreak;
    for (const token of wordTokens(text, { start: from, end: to }, type, "ignored"))
      tokens.push(keyed(token));

    lineLeader.lastIndex = to + 1;
    const stars = to + 1 < end ? lineLeader.exec(text)?.[1] : undefined;
    from = stars ? lineLeader.lastIndex : to + 1;
    if (stars)
      tokens.push({ start: from - stars.length, end: from, key: stars, type, layout: true });
  }

  return { marker, tokens };
}

// A line inside brackets is a continuation line and carries no depth, so a rewrap stays quiet.
const BRACKET_DEPTH: Record<string, number> = { "(": 1, "[": 1, "{": 1, ")": -1, "]": -1, "}": -1 };

/** Joins a depth to a key; no source token contains it, so a depth never collides with text. */
const DEPTH_SEPARATOR = "\u0000";

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
    const opensLine = DEPTH_WORDS.has(token.type) || !isWord(token.type);
    const startsLogicalLine = line !== previousLine && bracketDepth === 0 && opensLine;
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
