import { type PrFileDiff, type PrHunk, parsePrHunks } from "./pr-diff";

/**
 * Judges whether a diff changes only comments and docstrings, by scanning lines rather than
 * tokens. Block openers count only at line start, so a mid-line `/*` is code. A Python triple
 * quote opens a docstring only at file start or after a line ending in `:`; otherwise it opens a
 * string. A patch hides the state a hunk starts in, so each hunk is judged from every start its
 * lines make plausible, and reads the head text only when those starts disagree. Prose with no
 * delimiter or gutter in view has only the code start, so it stays "path" without a read, by
 * design. A renamed file is never "docs": moving a module can break its imports.
 */

/**
 * - `"docs"`: every change is a comment or docstring.
 * - `"path"`: keep the path section.
 * - `"needs-content"`: only the head file's text can tell.
 */
export type DocVerdict = "docs" | "path" | "needs-content";

/**
 * Judges one hunk. Without head text, every start state the hunk could begin in must agree; with
 * head text, the start state is read from the head file's lines above the hunk. The extension of
 * `path` picks the comment syntax, and an unsupported extension is `"path"`.
 */
export function docHunkVerdict(path: string, hunk: PrHunk): DocVerdict;
export function docHunkVerdict(path: string, hunk: PrHunk, headText: string): "docs" | "path";
export function docHunkVerdict(path: string, hunk: PrHunk, headText?: string): DocVerdict {
  const syntax = syntaxFor(path);
  if (syntax === undefined) return "path";
  if (headText !== undefined) {
    return hunkVerdictFrom(syntax, hunk, stateAbove(syntax, headText, hunk.newStart));
  }
  const verdicts = new Set(
    plausibleStarts(syntax, hunk).map((start) => hunkVerdictFrom(syntax, hunk, start)),
  );
  if (verdicts.size > 1) return "needs-content";
  return verdicts.has("docs") ? "docs" : "path";
}

/**
 * "docs" only when the file has at least one hunk and every hunk is "docs". With head text, the
 * hunks that need content are resolved against it.
 */
export function docFileVerdict(file: PrFileDiff): DocVerdict;
export function docFileVerdict(file: PrFileDiff, headText: string): "docs" | "path";
export function docFileVerdict(file: PrFileDiff, headText?: string): DocVerdict {
  if (file.kind === "binary" || file.previousPath !== undefined) return "path";
  const hunks = parsePrHunks(file.patch);
  const verdicts = hunks.map((hunk) => docHunkVerdict(file.path, hunk));
  if (hunks.length === 0 || verdicts.includes("path")) return "path";
  if (verdicts.every((verdict) => verdict === "docs")) return "docs";
  if (headText === undefined) return "needs-content";
  const docsWithHead = hunks.every(
    (hunk, i) => verdicts[i] === "docs" || docHunkVerdict(file.path, hunk, headText) === "docs",
  );
  return docsWithHead ? "docs" : "path";
}

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

interface Syntax {
  readonly lineMarker: string;
  readonly blocks: readonly Block[];
  /** Comment prefixes of compiler directives. They change what compiles, so they read as code. */
  readonly directives?: readonly string[];
}

// ponytail: a line scan, not a tokenizer. It misreads `//` or `/*` inside a template literal or Go
// raw string, Rust's nested `/* /* */ */`, and Lua's level-n `--[==[` brackets. A `#` or `//` line
// inside any string whose delimiters are out of view also reads as a comment. Upgrade path: a real
// tokenizer per language.
const C_LIKE: Syntax = { lineMarker: "//", blocks: [{ opener: "/*", closer: "*/", gutter: "*" }] };
const GO: Syntax = { ...C_LIKE, directives: ["//go:", "// +build"] };
const PYTHON: Syntax = {
  lineMarker: "#",
  blocks: [
    { opener: '"""', closer: '"""', delimitsStrings: true },
    { opener: "'''", closer: "'''", delimitsStrings: true },
  ],
};
const LUA: Syntax = { lineMarker: "--", blocks: [{ opener: "--[[", closer: "]]" }] };

const SYNTAX_BY_EXTENSION = new Map<string, Syntax>([
  ...["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "rs"].map(
    (ext) => [ext, C_LIKE] as const,
  ),
  ["go", GO],
  ...["py", "pyi"].map((ext) => [ext, PYTHON] as const),
  ["lua", LUA],
]);

function syntaxFor(path: string): Syntax | undefined {
  const extension = /\.([^./]+)$/.exec(path)?.[1];
  return extension === undefined ? undefined : SYNTAX_BY_EXTENSION.get(extension);
}

/** A comment or string block the scan is inside, carried from one line to the next. */
interface Inside {
  readonly closer: string;
  readonly kind: "comment" | "string";
}

/** Where a line leaves the scan: in code, or inside a block awaiting its closer. */
type Position = "code" | Inside;

/** What one side's scan knows between two lines. */
interface ScanState {
  readonly position: Position;
  /** Whether a line-start `"""` here opens a docstring rather than a string. */
  readonly docstringMayOpen: boolean;
}

const FILE_START: ScanState = { position: "code", docstringMayOpen: true };

type LineKind = "blank" | "code" | "comment";

/** How one line reads, and where it leaves the scan before the docstring fact is updated. */
interface Step {
  readonly kind: LineKind;
  readonly position: Position;
}

interface Scanned {
  readonly kind: LineKind;
  readonly state: ScanState;
}

function scanLine(syntax: Syntax, state: ScanState, rawLine: string): Scanned {
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

function scanCode(syntax: Syntax, docstringMayOpen: boolean, line: string): Step {
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

interface HunkLine {
  readonly marker: string;
  readonly text: string;
}

function bodyOf(hunk: PrHunk): HunkLine[] {
  return hunk.lines
    .filter((line) => !line.startsWith("\\"))
    .map((line) => ({ marker: line.charAt(0), text: line.slice(1) }));
}

/**
 * Scans both sides of the hunk from `start`. A context line that reads differently on the two
 * sides, with code on either, means the change altered its block: "path".
 */
function hunkVerdictFrom(syntax: Syntax, hunk: PrHunk, start: ScanState): "docs" | "path" {
  // The old side reuses the head's start state: only the head file can be read.
  let before = start;
  let after = start;
  const changed: LineKind[] = [];
  for (const { marker, text } of bodyOf(hunk)) {
    if (marker === "-") {
      const scanned = scanLine(syntax, before, text);
      before = scanned.state;
      changed.push(scanned.kind);
    } else if (marker === "+") {
      const scanned = scanLine(syntax, after, text);
      after = scanned.state;
      changed.push(scanned.kind);
    } else {
      const old = scanLine(syntax, before, text);
      const now = scanLine(syntax, after, text);
      before = old.state;
      after = now.state;
      if (old.kind !== now.kind && (old.kind === "code" || now.kind === "code")) return "path";
    }
  }
  return changed.includes("code") || !changed.includes("comment") ? "path" : "docs";
}

/**
 * The start states a hunk could begin in, judged from its patch alone. Whether a line-start
 * triple quote opens a docstring depends on the unseen start, so every position is tried both
 * ways.
 */
function plausibleStarts(syntax: Syntax, hunk: PrHunk): ScanState[] {
  if (hunk.newStart <= 1) return [FILE_START];
  const body = bodyOf(hunk);
  const positions: Position[] = ["code"];
  for (const block of syntax.blocks) {
    if (!body.some(({ text }) => text.includes(block.closer))) continue;
    positions.push({ closer: block.closer, kind: "comment" });
    if (block.delimitsStrings) positions.push({ closer: block.closer, kind: "string" });
  }
  const gutterBlock = syntax.blocks.find(
    (block) => block.gutter !== undefined && isGutterRun(body, block.gutter),
  );
  if (gutterBlock !== undefined) positions.push({ closer: gutterBlock.closer, kind: "comment" });
  return positions.flatMap((position) => [
    { position, docstringMayOpen: true },
    { position, docstringMayOpen: false },
  ]);
}

/** Whether every non-blank line starts with `gutter`: a block's middle with no delimiter in view. */
function isGutterRun(body: readonly HunkLine[], gutter: string): boolean {
  const nonBlankLines = body.map(({ text }) => text.trim()).filter((text) => text !== "");
  return nonBlankLines.length > 0 && nonBlankLines.every((text) => text.startsWith(gutter));
}

function stateAbove(syntax: Syntax, headText: string, newStart: number): ScanState {
  let state = FILE_START;
  for (const line of headText.split("\n").slice(0, Math.max(newStart - 1, 0))) {
    state = scanLine(syntax, state, line).state;
  }
  return state;
}
