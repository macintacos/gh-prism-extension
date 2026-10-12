/**
 * Comment-scans a head file line by line, for the hunk rules that read it. Block openers count
 * only at line start, so a mid-line `/*` is code. A Python triple quote opens a docstring only at
 * file start or after a line ending in `:`; otherwise it opens a string.
 */

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

export interface CommentSyntax {
  readonly lineMarker: string;
  readonly blocks: readonly Block[];
  /** Comment prefixes of compiler directives. They change what compiles, so they read as code. */
  readonly directives?: readonly string[];
}

// ponytail: a line scan, not a tokenizer. It misreads `//` or `/*` inside a template literal or Go
// raw string, Rust's nested `/* /* */ */`, and Lua's level-n `--[==[` brackets. A `#` or `//` line
// inside any string whose delimiters are out of view also reads as a comment. Upgrade path: a real
// tokenizer per language.
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
export const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1] ?? "";

/** The comment syntax for `path`'s extension; `undefined` for an extension with none. */
export const commentSyntaxOf = (path: string) => SYNTAX_BY_EXTENSION.get(extensionOf(path));

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

export const FILE_START: ScanState = { position: "code", docstringMayOpen: true };

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

function scanCode(syntax: CommentSyntax, docstringMayOpen: boolean, line: string): Step {
  if (line === "") return { kind: "blank", position: "code" };
  const opened = syntax.blocks.find(
    (block) => line.startsWith(block.opener) && (!block.delimitsStrings || docstringMayOpen),
  );
  if (opened !== undefined) {
    return scanInside({ closer: opened.closer, kind: "comment" }, line.slice(opened.opener.length));
  }
  const isDirective = (syntax.directives ?? []).some((prefix) => line.startsWith(prefix));
  if (line.startsWith(syntax.lineMarker) && !isDirective) {
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

const countOf = (line: string, delimiter: string) => line.split(delimiter).length - 1;

/** A head file split and comment-scanned once, shared by every hunk and rule that reads it. */
export interface ScannedHead {
  readonly lines: readonly string[];
  /** The comment scan's state before each line, then the state at end of file. */
  readonly starts: readonly ScanState[];
  /** How each line reads; `"string"` is a line that starts inside a string literal. */
  readonly kinds: readonly ("blank" | "code" | "comment" | "string")[];
}

/**
 * Splits and comment-scans `text` once, with `path`'s comment syntax; `undefined` for an extension
 * with none.
 */
export function scanHeadText(path: string, text: string): ScannedHead | undefined {
  const syntax = commentSyntaxOf(path);
  if (syntax === undefined) return undefined;
  const lines = text.split("\n");
  const starts: ScanState[] = [];
  const kinds: ScannedHead["kinds"][number][] = [];
  let state = FILE_START;
  for (const line of lines) {
    starts.push(state);
    const scanned = scanLine(syntax, state, line);
    kinds.push(insideString(state) ? "string" : scanned.kind);
    state = scanned.state;
  }
  starts.push(state);
  return { lines, starts, kinds };
}

const insideString = (state: ScanState) =>
  state.position !== "code" && state.position.kind === "string";
