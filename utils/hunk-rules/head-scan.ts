/**
 * Comment-scans source lines one at a time, for the hunk rules: the docstring rule steps
 * `scanLine` over a hunk's two sides, and `scanHeadText` scans a whole head file once. Block
 * openers count only at line start, so a mid-line `/*` is code. A Python triple quote opens a
 * docstring only at file start or after a line ending in `:`; otherwise it opens a string.
 */

import type { HeadOutline, LineBlock, OutlineSpan } from "../structural/outline";

interface Block {
  readonly opener: string;
  readonly closer: string;
  /** The marker that starts each middle line of the block, such as the `*` of a JSDoc comment. */
  readonly gutter?: string;
  /**
   * Also delimits string literals, as Python's triple quotes do: a line-start opener is a string
   * where no docstring may open, and an odd count mid-line opens one.
   */
  readonly delimitsStrings?: boolean;
}

/** How one language marks comments, as the line scan reads them. */
export interface CommentSyntax {
  readonly lineMarker: string;
  readonly blocks: readonly Block[];
  /** Comment prefixes of compiler directives. They change what compiles, so they read as code. */
  readonly directives?: readonly string[];
}

// ponytail: a line scan, not a tokenizer, and the default and fallback. It misreads `//` or `/*`
// inside a template literal or Go raw string, Rust's nested `/* /* */ */`, and Lua's level-n
// `--[==[` brackets. A `#` or `//` line inside any string whose delimiters are out of view also reads
// as a comment. An outline from a tree-sitter parse, when given, replaces its guesses at where each
// head line starts; a hunk's own lines are still line-scanned, so a literal opened inside the hunk is
// still guessed.
const C_LIKE: CommentSyntax = {
  lineMarker: "//",
  blocks: [{ opener: "/*", closer: "*/", gutter: "*" }],
};
const GO: CommentSyntax = { ...C_LIKE, directives: ["//go:", "// +build"] };
const PYTHON: CommentSyntax = {
  lineMarker: "#",
  blocks: [
    { opener: '"""', closer: '"""', delimitsStrings: true },
    { opener: "'''", closer: "'''", delimitsStrings: true },
  ],
};
const LUA: CommentSyntax = { lineMarker: "--", blocks: [{ opener: "--[[", closer: "]]" }] };

const SYNTAX_BY_EXTENSION = new Map<string, CommentSyntax>([
  ...["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs"].map(
    (ext) => [ext, C_LIKE] as const,
  ),
  ["go", GO],
  ...["py", "pyi"].map((ext) => [ext, PYTHON] as const),
  ["lua", LUA],
]);

/** The text after the last dot in `path`'s file name; `""` when there is none. */
export const extensionOf = (path: string): string => /\.([^./]+)$/.exec(path)?.[1] ?? "";

/** The comment syntax for `path`'s extension; `undefined` for an extension with none. */
export const commentSyntaxOf = (path: string): CommentSyntax | undefined =>
  SYNTAX_BY_EXTENSION.get(extensionOf(path));

/** A comment or string block the scan is inside, carried from one line to the next. */
interface Inside {
  readonly closer: string;
  readonly kind: "comment" | "string";
}

/** Where a line leaves the scan: in code, or inside a block awaiting its closer. */
export type ScanPosition = "code" | Inside;

/** What one side's scan knows between two lines. */
export interface ScanState {
  readonly position: ScanPosition;
  /** Whether a line-start `"""` here opens a docstring rather than a string. */
  readonly docstringMayOpen: boolean;
}

/** The state above a file's first line: in code, where a triple quote may open a docstring. */
export const FILE_START: ScanState = { position: "code", docstringMayOpen: true };

/** How the comment scan reads one line. */
export type LineKind = "blank" | "code" | "comment";

/** How one line reads, and where it leaves the scan before the docstring fact is updated. */
interface Step {
  readonly kind: LineKind;
  readonly position: ScanPosition;
}

interface Scanned {
  readonly kind: LineKind;
  readonly state: ScanState;
}

/**
 * How `rawLine` reads from `state`, ignoring surrounding whitespace, and the state the next line
 * starts in.
 */
export function scanLine(syntax: CommentSyntax, state: ScanState, rawLine: string): Scanned {
  const line = rawLine.trim();
  const step =
    state.position === "code"
      ? scanCode(syntax, state.docstringMayOpen, line)
      : scanInside(state.position, line);
  return {
    kind: step.kind,
    state: {
      position: step.position,
      docstringMayOpen: step.kind === "code" ? line.endsWith(":") : state.docstringMayOpen,
    },
  };
}

/** Whether `line`, ignoring surrounding whitespace, is one of `syntax`'s compiler directives. */
export const isDirective = (syntax: CommentSyntax, line: string): boolean =>
  (syntax.directives ?? []).some((prefix) => line.trim().startsWith(prefix));

const countOf = (line: string, delimiter: string) => line.split(delimiter).length - 1;

function scanCode(syntax: CommentSyntax, docstringMayOpen: boolean, line: string): Step {
  if (line === "") return { kind: "blank", position: "code" };

  const opened = syntax.blocks.find(
    (block) => line.startsWith(block.opener) && (!block.delimitsStrings || docstringMayOpen),
  );
  if (opened !== undefined) {
    return scanInside({ closer: opened.closer, kind: "comment" }, line.slice(opened.opener.length));
  }

  if (line.startsWith(syntax.lineMarker) && !isDirective(syntax, line)) {
    return { kind: "comment", position: "code" };
  }

  const openedString = syntax.blocks.find(
    (block) => block.delimitsStrings && countOf(line, block.closer) % 2 === 1,
  );
  if (openedString !== undefined) {
    return { kind: "code", position: { closer: openedString.closer, kind: "string" } };
  }
  return { kind: "code", position: "code" };
}

/** A line that starts inside a block. Its closer ends the block; text after the closer makes it code. */
function scanInside(inside: Inside, line: string): Step {
  const closerIndex = line.indexOf(inside.closer);
  if (closerIndex === -1)
    return { kind: inside.kind === "comment" ? "comment" : "code", position: inside };
  const trailing = line.slice(closerIndex + inside.closer.length).trim();
  const comment = inside.kind === "comment" && trailing === "";
  return { kind: comment ? "comment" : "code", position: "code" };
}

/** A head file split and comment-scanned once, shared by every hunk and rule that reads it. */
export interface ScannedHead {
  readonly lines: readonly string[];
  /** The comment scan's state before each line, then the state at end of file. */
  readonly starts: readonly ScanState[];
  /** How each line reads; `"string"` is a line that starts inside a string literal. */
  readonly kinds: readonly ("blank" | "code" | "comment" | "string")[];
  /** The file's test blocks, present when the head came from a parse. */
  readonly testBlocks?: readonly LineBlock[];
}

const insideString = (state: ScanState) =>
  state.position !== "code" && state.position.kind === "string";

/**
 * Splits and comment-scans `text` once, with `path`'s comment syntax; `undefined` for an extension
 * with none.
 */
export function scanHeadText(path: string, text: string): ScannedHead | undefined {
  const syntax = commentSyntaxOf(path);
  if (syntax === undefined) return undefined;

  return scanLines(syntax, text.split("\n"), (_, scanned) => scanned);
}

/**
 * Splits and comment-scans `text` as {@link scanHeadText} does, but starts each line where
 * `outline`'s multi-line comments and strings put it, and carries its test blocks. Spans and
 * blocks that reach past the text are ignored. `undefined` for an extension with no comment syntax.
 */
export function headFromOutline(
  path: string,
  text: string,
  outline: HeadOutline,
): ScannedHead | undefined {
  const syntax = commentSyntaxOf(path);
  if (syntax === undefined) return undefined;

  const lines = text.split("\n");
  const fits = (start: number, end: number) => 1 <= start && start <= end && end <= lines.length;
  const spans = outline.spans.filter((span) => fits(span.startLine, span.endLine));
  const testBlocks = outline.testBlocks.filter((block) => fits(block.start, block.end));

  const head = scanLines(syntax, lines, (line) => positionIn(spans, line));
  return { ...head, testBlocks };
}

/** Where `line` starts: inside the latest-opening span that covers it, else in code. */
function positionIn(spans: readonly OutlineSpan[], line: number): ScanPosition {
  let inner: OutlineSpan | undefined;
  for (const span of spans) {
    const covers = span.startLine < line && line <= span.endLine;
    if (covers && (inner === undefined || span.startLine > inner.startLine)) inner = span;
  }
  return inner === undefined ? "code" : { closer: inner.closer, kind: inner.kind };
}

/**
 * Scans `lines` in order. `positionAt` gives each 1-based line's start position, the end of file
 * being the line after the last, from the position the previous line's scan left.
 */
function scanLines(
  syntax: CommentSyntax,
  lines: readonly string[],
  positionAt: (line: number, scanned: ScanPosition) => ScanPosition,
): ScannedHead {
  const starts: ScanState[] = [];
  const kinds: ScannedHead["kinds"][number][] = [];
  let state = FILE_START;

  for (const [index, line] of lines.entries()) {
    state = { ...state, position: positionAt(index + 1, state.position) };
    starts.push(state);
    const scanned = scanLine(syntax, state, line);
    kinds.push(insideString(state) ? "string" : scanned.kind);
    state = scanned.state;
  }

  starts.push({ ...state, position: positionAt(lines.length + 1, state.position) });
  return { lines, starts, kinds };
}
