import type { PrFileDiff, PrHunk } from "./pr-diff";
import { parsePrHunks } from "./pr-diff";

/**
 * "docs": every change is a comment or docstring. "path": keep the path section. "needs-content":
 * only the head file's text can tell.
 */
export type DocVerdict = "docs" | "path" | "needs-content";

/**
 * Judges one hunk. Without head text, every start state the hunk could begin in must agree; with
 * head text, the start state is read from the head file's lines above the hunk.
 */
export function docHunkVerdict(path: string, hunk: PrHunk): DocVerdict;
export function docHunkVerdict(path: string, hunk: PrHunk, headText: string): "docs" | "path";
export function docHunkVerdict(path: string, hunk: PrHunk, headText?: string): DocVerdict {
  const syntax = syntaxFor(path);
  if (syntax === undefined) return "path";
  if (headText !== undefined) {
    return hunkKind(syntax, hunk, stateAbove(syntax, headText, hunk.newStart));
  }
  const kinds = new Set(
    plausibleStarts(syntax, hunk).map((start) => hunkKind(syntax, hunk, start)),
  );
  if (kinds.size > 1) return "needs-content";
  return kinds.has("docs") ? "docs" : "path";
}

/**
 * "docs" only when the file has at least one hunk and every hunk is "docs". With head text, the
 * hunks that need content are resolved against it.
 */
export function docFileVerdict(file: PrFileDiff): DocVerdict;
export function docFileVerdict(file: PrFileDiff, headText: string): "docs" | "path";
export function docFileVerdict(file: PrFileDiff, headText?: string): DocVerdict {
  if (file.kind === "binary") return "path";
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
  /** Also opens a string when it appears mid-line with an odd count, as Python's triple quotes do. */
  readonly symmetric?: boolean;
}

interface Syntax {
  readonly lineMarker: string;
  readonly blocks: readonly Block[];
}

// ponytail: a line scan, not a tokenizer. It misreads `//` or `/*` inside a template literal or Go
// raw string, Rust's nested `/* /* */ */`, and Lua's level-n `--[==[` brackets. Upgrade path: a real
// tokenizer per language.
const C_LIKE: Syntax = { lineMarker: "//", blocks: [{ opener: "/*", closer: "*/", gutter: "*" }] };
const PYTHON: Syntax = {
  lineMarker: "#",
  blocks: [
    { opener: '"""', closer: '"""', symmetric: true },
    { opener: "'''", closer: "'''", symmetric: true },
  ],
};
const LUA: Syntax = { lineMarker: "--", blocks: [{ opener: "--[[", closer: "]]" }] };

const SYNTAX_BY_EXTENSION = new Map<string, Syntax>([
  ...["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "go", "rs"].map(
    (ext) => [ext, C_LIKE] as const,
  ),
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

type LineKind = "blank" | "code" | "comment";

interface Scanned {
  readonly kind: LineKind;
  readonly inside: Inside | undefined;
}

function scanLine(syntax: Syntax, inside: Inside | undefined, rawLine: string): Scanned {
  const line = rawLine.trim();
  if (inside !== undefined) return scanInside(inside, line);
  if (line === "") return { kind: "blank", inside: undefined };
  const opened = syntax.blocks.find((block) => line.startsWith(block.opener));
  if (opened !== undefined) {
    return scanInside({ closer: opened.closer, kind: "comment" }, line.slice(opened.opener.length));
  }
  if (line.startsWith(syntax.lineMarker)) return { kind: "comment", inside: undefined };
  const quoted = syntax.blocks.find(
    (block) => block.symmetric && countOf(line, block.closer) % 2 === 1,
  );
  if (quoted !== undefined) {
    return { kind: "code", inside: { closer: quoted.closer, kind: "string" } };
  }
  return { kind: "code", inside: undefined };
}

/** A line that starts inside a block. Its closer ends the block; text after the closer makes it code. */
function scanInside(inside: Inside, line: string): Scanned {
  const at = line.indexOf(inside.closer);
  if (at === -1) return { kind: inside.kind === "comment" ? "comment" : "code", inside };
  const trailing = line.slice(at + inside.closer.length).trim();
  const comment = inside.kind === "comment" && trailing === "";
  return { kind: comment ? "comment" : "code", inside: undefined };
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

function hunkKind(syntax: Syntax, hunk: PrHunk, start: Inside | undefined): "docs" | "path" {
  const body = bodyOf(hunk);
  const kinds = [
    ...changedKinds(syntax, body, start, "-"),
    ...changedKinds(syntax, body, start, "+"),
  ];
  return kinds.includes("code") || !kinds.includes("comment") ? "path" : "docs";
}

/** The kinds of one side's changed lines, scanning that side's context and changes from `start`. */
function changedKinds(
  syntax: Syntax,
  body: readonly HunkLine[],
  start: Inside | undefined,
  side: "+" | "-",
): LineKind[] {
  const otherSide = side === "+" ? "-" : "+";
  const kinds: LineKind[] = [];
  let inside = start;
  for (const { marker, text } of body) {
    if (marker === otherSide) continue;
    const scanned = scanLine(syntax, inside, text);
    inside = scanned.inside;
    if (marker === side) kinds.push(scanned.kind);
  }
  return kinds;
}

/** The start states a hunk could begin in, judged from its patch alone. `undefined` is code. */
function plausibleStarts(syntax: Syntax, hunk: PrHunk): (Inside | undefined)[] {
  if (hunk.newStart <= 1) return [undefined];
  const body = bodyOf(hunk);
  const starts: (Inside | undefined)[] = [undefined];
  for (const block of syntax.blocks) {
    if (!body.some(({ text }) => text.includes(block.closer))) continue;
    starts.push({ closer: block.closer, kind: "comment" });
    if (block.symmetric) starts.push({ closer: block.closer, kind: "string" });
  }
  const gutterBlock = syntax.blocks.find(
    (block) => block.gutter !== undefined && isGutterRun(body, block.gutter),
  );
  if (gutterBlock !== undefined) starts.push({ closer: gutterBlock.closer, kind: "comment" });
  return starts;
}

/** Whether every non-blank line starts with `gutter`: a block's middle with no delimiter in view. */
function isGutterRun(body: readonly HunkLine[], gutter: string): boolean {
  const content = body.map(({ text }) => text.trim()).filter((text) => text !== "");
  return content.length > 0 && content.every((text) => text.startsWith(gutter));
}

function stateAbove(syntax: Syntax, headText: string, newStart: number): Inside | undefined {
  let inside: Inside | undefined;
  for (const line of headText.split("\n").slice(0, Math.max(newStart - 1, 0))) {
    inside = scanLine(syntax, inside, line).inside;
  }
  return inside;
}
