import type { ScannedHead } from "./doc-intent";
import { type PrFileDiff, type PrHunk, parsePrHunks } from "./pr-diff";
import { classify } from "./sections";

/**
 * The inline-test rule of changeset.nvim's `test_rule` (`lua/changeset/sections.lua`, at commit
 * 2b6115d), ported as a line scan of the head file. A hunk that changes only lines inside a test
 * block of a Rust, Python or TypeScript file counts as Tests, and a file whose hunks all count
 * moves to Tests.
 *
 * Divergences from upstream: no syntax marks are read (`#[test]`, `#[cfg(test)]`,
 * `import.meta.vitest`); a hunk counts only when every non-blank changed line sits in a block, so a
 * partly overlapping hunk or a mixed file keeps its path section; a renamed file never moves.
 */

// ponytail: a line scan, not a parser. Braces in multi-line strings, template literals, Rust raw
// strings spanning lines, or regex literals miscount; an opener inside a multi-line template literal
// or raw string still opens; a multi-line decorator stops the widening; an unbalanced block is
// dropped rather than guessed. Upgrade path: tree-sitter grammars (~3.3 MB of wasm) in the worker.

/** Whether the rule can judge a file: a current Rust, Python or TypeScript implementation file. */
export function inlineTestRuleApplies(file: PrFileDiff): boolean {
  return candidateFinder(file) !== undefined;
}

/** Whether every hunk changes only lines inside its test blocks, judged from the head scan. */
export function changesOnlyInlineTests(file: PrFileDiff, head: ScannedHead): boolean {
  const findBlocks = candidateFinder(file);
  if (findBlocks === undefined || file.kind !== "text") return false;
  const hunks = parsePrHunks(file.patch);
  const blocks = findBlocks(head);
  return hunks.length > 0 && hunks.every((hunk) => hunkIsInTests(hunk, blocks));
}

function candidateFinder(file: PrFileDiff): BlockFinder | undefined {
  if (file.kind !== "text" || file.previousPath !== undefined || file.status === "deleted") {
    return undefined;
  }
  if (classify(file.path) !== "implementation") return undefined;
  return FINDERS_BY_EXTENSION.get(extensionOf(file.path));
}

const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1] ?? "";

/** A test block in head-file lines: 1-based and inclusive, like {@link PrHunk.newStart}. */
interface Block {
  readonly start: number;
  readonly end: number;
}

type Kind = ScannedHead["kinds"][number];

/** A head line: its trimmed text, its indentation, and how the comment scan read it. */
interface Row {
  readonly text: string;
  readonly indent: number;
  readonly kind: Kind;
}

/** The 0-based index of a block's last line when `row` opens one, else `undefined`. */
type Opener = (row: Row, index: number, rows: readonly Row[]) => number | undefined;

type BlockFinder = (head: ScannedHead) => Block[];

function hunkIsInTests(hunk: PrHunk, blocks: readonly Block[]): boolean {
  const verdicts = changeVerdicts(hunk, blocks);
  return verdicts.length > 0 && verdicts.every((verdict) => verdict);
}

interface Run {
  readonly marker: string;
  readonly texts: readonly string[];
}

/** Groups a hunk's body into runs of one marker: context (` `), added (`+`) or removed (`-`). */
function runsOf(hunk: PrHunk): Run[] {
  const runs: { marker: string; texts: string[] }[] = [];
  for (const line of hunk.lines) {
    if (line.startsWith("\\")) continue;
    const marker = line.charAt(0);
    const text = line.slice(1);
    const last = runs.at(-1);
    if (last?.marker === marker) last.texts.push(text);
    else runs.push({ marker, texts: [text] });
  }
  return runs;
}

/**
 * One verdict per non-blank changed line: `true` when it sits inside a block. Context and added
 * lines advance the head-line counter; a removed run is judged at the counter's line, which is the
 * line its replacement takes, or else the gap before it.
 */
function changeVerdicts(hunk: PrHunk, blocks: readonly Block[]): boolean[] {
  const runs = runsOf(hunk);
  const verdicts: boolean[] = [];
  let line = hunk.newStart;
  for (const [index, run] of runs.entries()) {
    const removedIn = runs[index + 1]?.marker === "+" ? containsLine : containsGap;
    verdicts.push(...runVerdicts(run, line, removedIn, blocks));
    if (run.marker !== "-") line += run.texts.length;
  }
  return verdicts;
}

type Membership = (blocks: readonly Block[], line: number) => boolean;

function runVerdicts(
  run: Run,
  line: number,
  removedIn: Membership,
  blocks: readonly Block[],
): boolean[] {
  return run.texts.flatMap((text, offset) => {
    if (text.trim() === "") return [];
    if (run.marker === "+") return [containsLine(blocks, line + offset)];
    if (run.marker === "-") return [removedIn(blocks, line)];
    return [];
  });
}

const containsLine: Membership = (blocks, line) =>
  blocks.some((block) => block.start <= line && line <= block.end);

const containsGap: Membership = (blocks, line) =>
  blocks.some((block) => block.start < line && line <= block.end);

function rowsOf(head: ScannedHead): Row[] {
  return head.lines.map((line, index) => ({
    text: line.trim(),
    indent: line.length - line.trimStart().length,
    // `kinds` has one entry per line, so the fallback never applies.
    kind: head.kinds[index] ?? "code",
  }));
}

/** Scans for openers at code lines, resuming after each block so nested openers add nothing. */
function blocksIn(rows: readonly Row[], opener: Opener, leader?: RegExp): Block[] {
  const blocks: Block[] = [];
  let resume = 0;
  for (const [index, row] of rows.entries()) {
    if (index < resume || row.kind !== "code") continue;
    const end = opener(row, index, rows);
    if (end === undefined) continue;
    blocks.push({ start: widenedStart(rows, index, leader) + 1, end: end + 1 });
    resume = end + 1;
  }
  return blocks;
}

/** Extends a block's start over the comments and leader lines directly above its opener. */
function widenedStart(rows: readonly Row[], index: number, leader?: RegExp): number {
  let start = index;
  while (leads(rows[start - 1], leader)) start--;
  return start;
}

function leads(row: Row | undefined, leader?: RegExp): boolean {
  if (row === undefined) return false;
  return row.kind === "comment" || (row.kind === "code" && leader?.test(row.text) === true);
}

/** The 0-based index of the line that returns the brackets opened at `index` to zero, if any. */
function closingLine(
  rows: readonly Row[],
  index: number,
  depthOf: (row: Row) => number,
): number | undefined {
  let depth = 0;
  for (const [offset, row] of rows.slice(index).entries()) {
    depth += depthOf(row);
    if (depth <= 0) return index + offset;
  }
  return undefined;
}

/** A line's code with its literals and comments removed; a line that is not code has none. */
function codeOf(row: Row, literals: RegExp): string {
  return row.kind === "code" ? row.text.replace(literals, "") : "";
}

/** Opening minus closing brackets in a line's code. */
function netDepth(row: Row, literals: RegExp, open: string, close: string): number {
  let depth = 0;
  for (const char of codeOf(row, literals)) {
    if (open.includes(char)) depth++;
    else if (close.includes(char)) depth--;
  }
  return depth;
}

// Strings, char literals (a lifetime has no closing quote, so it is kept), and comments.
const RUST_LITERALS = /"(?:\\.|[^"\\])*"|'(?:\\.[^']*|[^\\'])'|\/\/.*|\/\*.*?\*\//g;
const RUST_TEST_MOD = /^(pub(\([^)]*\))?\s+)?mod\s+tests?\s*\{/;
const RUST_ATTRIBUTE = /^#\[.*\]$/;

const rustTestMod: Opener = (row, index, rows) =>
  RUST_TEST_MOD.test(row.text)
    ? closingLine(rows, index, (line) => netDepth(line, RUST_LITERALS, "{", "}"))
    : undefined;

const rustTestBlocks: BlockFinder = (head) => blocksIn(rowsOf(head), rustTestMod, RUST_ATTRIBUTE);

const PY_TEST_CLASS = /^class\s+Test\w*\s*[(:]/;
const PY_TEST_DEF = /^(async\s+)?def\s+test_\w*\s*\(/;
const PY_CLASS = /^class\s/;
const PY_SCOPE = /^(async\s+)?(def|class)\s/;
const PY_CLOSER = /^[)\]}]/;
const PY_DECORATOR = /^@/;

const pythonTestBlock: Opener = (row, index, rows) => {
  if (PY_TEST_CLASS.test(row.text)) return pythonBlockEnd(rows, index, row.indent);
  if (!PY_TEST_DEF.test(row.text)) return undefined;
  const scope = enclosingScope(rows, index, row.indent);
  if (scope !== undefined && PY_CLASS.test(scope.text)) return undefined;
  return pythonBlockEnd(rows, index, row.indent);
};

/** The def or class a line sits in: the nearest scope header above it with less indentation. */
function enclosingScope(rows: readonly Row[], index: number, indent: number): Row | undefined {
  let limit = indent;
  for (const row of rows.slice(0, index).reverse()) {
    if (row.kind !== "code" || row.indent >= limit || PY_CLOSER.test(row.text)) continue;
    if (PY_SCOPE.test(row.text)) return row;
    limit = row.indent;
  }
  return undefined;
}

/**
 * Ends at the last line before the first code line at or above the opener's indentation, which
 * is not a closing bracket. Blank lines and comments at that indentation belong to what follows.
 */
function pythonBlockEnd(rows: readonly Row[], index: number, indent: number): number {
  let end = index;
  for (const [offset, row] of rows.slice(index + 1).entries()) {
    if (row.kind === "code" && row.indent <= indent && !PY_CLOSER.test(row.text)) break;
    if (row.kind !== "blank" && (row.kind !== "comment" || row.indent > indent)) {
      end = index + 1 + offset;
    }
  }
  return end;
}

const pythonTestBlocks: BlockFinder = (head) =>
  blocksIn(rowsOf(head), pythonTestBlock, PY_DECORATOR);

// Strings, template literals and comments. TypeScript has no lifetimes, so `'` always quotes.
const TS_LITERALS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*|\/\*.*?\*\//g;
const TS_NAMESPACE = /^(export\s+)?(declare\s+)?(namespace|module)\s+tests?\s*\{/;
const TS_TEST_CALL = /^(describe|it|test)(\.[\w$]+)*\s*\(/;
const TS_CALLBACK = /=>|\bfunction\b/;

const tsTestBlock: Opener = (row, index, rows) =>
  TS_NAMESPACE.test(row.text)
    ? closingLine(rows, index, (line) => netDepth(line, TS_LITERALS, "{", "}"))
    : tsTestCall(row, index, rows);

/** A test-runner call that takes a callback. A definition named like one opens nothing. */
function tsTestCall(row: Row, index: number, rows: readonly Row[]): number | undefined {
  if (!TS_TEST_CALL.test(row.text) || definesMethod(codeOf(row, TS_LITERALS))) return undefined;
  const end = closingLine(rows, index, (line) => netDepth(line, TS_LITERALS, "([{", ")]}"));
  if (end === undefined) return undefined;
  const takesCallback = rows
    .slice(index, end + 1)
    .some((line) => TS_CALLBACK.test(codeOf(line, TS_LITERALS)));
  return takesCallback ? end : undefined;
}

/** Whether the call's first parenthesis closes on this line and is followed by `{` or `:`. */
function definesMethod(code: string): boolean {
  const close = closeOf(code, code.indexOf("("));
  return close !== undefined && /^\s*[{:]/.test(code.slice(close + 1));
}

/** The index of the `)` closing the `(` at `open`, when the line closes it. */
function closeOf(code: string, open: number): number | undefined {
  let depth = 0;
  for (let at = open; at < code.length; at++) {
    const char = code.charAt(at);
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return at;
    }
  }
  return undefined;
}

const tsTestBlocks: BlockFinder = (head) => blocksIn(rowsOf(head), tsTestBlock);

const FINDERS_BY_EXTENSION = new Map<string, BlockFinder>([
  ["rs", rustTestBlocks],
  ["py", pythonTestBlocks],
  ["ts", tsTestBlocks],
  ["tsx", tsTestBlocks],
  ["mts", tsTestBlocks],
  ["cts", tsTestBlocks],
]);
