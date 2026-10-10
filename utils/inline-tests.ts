import type { ScannedHead } from "./doc-intent";
import { type PrFileDiff, type PrHunk, parsePrHunks } from "./pr-diff";
import { classify } from "./sections";

/**
 * The inline-test rule of changeset.nvim's `test_rule` (`lua/changeset/sections.lua`, at
 * `macintacos/changeset.nvim@2b6115db3a5394a207836afdeaa8237225b8de93`), ported as a line scan of
 * the head file. A hunk that changes only lines inside a test block of a Rust, Python or TypeScript
 * file counts as Tests, and a file whose hunks all count moves to Tests.
 *
 * A test block is a Rust `mod test`/`mod tests` body, a TypeScript `namespace tests` body or a
 * `describe`/`it`/`test` call given a callback, or a Python `class Test*` or non-method
 * `def test_*`, widened over the comments, attributes and decorators directly above it; blank
 * changed lines are neutral.
 *
 * Divergences from upstream: no syntax marks are read (`#[test]`, `#[cfg(test)]`,
 * `import.meta.vitest`); a hunk counts only when every non-blank changed line sits in a block, so a
 * partly overlapping hunk or a mixed file keeps its path section; a renamed file never moves.
 */

// ponytail: a line scan, not a parser. Braces in multi-line strings, template literals, Rust raw
// strings spanning lines, or regex literals miscount; an opener inside a multi-line template literal
// or raw string still opens; a multi-line decorator stops the widening; an unbalanced block is
// dropped rather than guessed; a member call on a local named `it`/`test`/`describe` opens a block;
// a docstring directly above a Python test widens into it; an attribute on the `mod tests` line
// itself is not recognised. Upgrade path: tree-sitter grammars (~3.3 MB of wasm) in the worker.

/**
 * Whether the rule can judge a file: a text Rust, Python or TypeScript file the path rules put in
 * Implementation, neither renamed nor deleted.
 */
export function inlineTestRuleApplies(file: PrFileDiff): boolean {
  return candidateFinder(file) !== undefined;
}

/**
 * Whether the file is one the rule applies to, has a hunk, and every hunk changes a non-blank
 * line, all of them inside the head's test blocks.
 */
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
 * One verdict per non-blank added line and per removed run with a non-blank line: `true` when it
 * sits inside a block. Context and added lines advance the head-line counter; a removed run is
 * judged at the counter's line, which is the line its replacement takes, or else the gap before it.
 */
function changeVerdicts(hunk: PrHunk, blocks: readonly Block[]): boolean[] {
  const runs = runsOf(hunk);
  const verdicts: boolean[] = [];
  let line = hunk.newStart;
  for (const [index, run] of runs.entries()) {
    const changed = run.texts.flatMap((text, offset) =>
      text.trim() === "" ? [] : [line + offset],
    );
    if (run.marker === "+") verdicts.push(...changed.map((at) => containsLine(blocks, at)));
    if (run.marker === "-" && changed.length > 0) {
      const replaced = runs[index + 1]?.marker === "+";
      verdicts.push(replaced ? containsLine(blocks, line) : containsGap(blocks, line));
    }
    if (run.marker !== "-") line += run.texts.length;
  }
  return verdicts;
}

function containsLine(blocks: readonly Block[], line: number): boolean {
  return blocks.some((block) => block.start <= line && line <= block.end);
}

function containsGap(blocks: readonly Block[], line: number): boolean {
  return blocks.some((block) => block.start < line && line <= block.end);
}

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

/** Each row from `index` in `step`'s direction, with its index. */
function* rowsFrom(rows: readonly Row[], index: number, step: 1 | -1): Generator<[number, Row]> {
  for (let at = index; at >= 0 && at < rows.length; at += step) {
    const row = rows[at];
    if (row !== undefined) yield [at, row];
  }
}

/** The 0-based index of the line that returns the brackets opened at `index` to zero, if any. */
function closingLine(rows: readonly Row[], index: number, brackets: Brackets): number | undefined {
  let depth = 0;
  for (const [at, row] of rowsFrom(rows, index, 1)) {
    depth += netDepth(row, brackets);
    if (depth <= 0) return at;
  }
  return undefined;
}

/** A line's code with its literals and comments removed; a line that is not code has none. */
function codeOf(row: Row, literals: RegExp): string {
  return row.kind === "code" ? row.text.replace(literals, "") : "";
}

/** The bracket characters to count, and the literal and comment pattern to strip first. */
interface Brackets {
  readonly literals: RegExp;
  readonly open: string;
  readonly close: string;
}

/** Opening minus closing brackets in a line's code. */
function netDepth(row: Row, { literals, open, close }: Brackets): number {
  let depth = 0;
  for (const char of codeOf(row, literals)) {
    if (open.includes(char)) depth++;
    else if (close.includes(char)) depth--;
  }
  return depth;
}

// Strings, char literals (a lifetime has no closing quote, so it is kept), and comments.
const RUST_LITERALS = /"(?:\\.|[^"\\])*"|'(?:\\.[^']*|[^\\'])'|\/\/.*|\/\*.*?\*\//g;
const RUST_BRACES: Brackets = { literals: RUST_LITERALS, open: "{", close: "}" };
const RUST_TEST_MOD = /^(pub(\([^)]*\))?\s+)?mod\s+tests?\s*\{/;
const RUST_ATTRIBUTE = /^#\[.*\]$/;

const rustTestMod: Opener = (row, index, rows) =>
  RUST_TEST_MOD.test(row.text) ? closingLine(rows, index, RUST_BRACES) : undefined;

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
  // Upstream counts functions, not methods; a Test* class's block already covers its methods.
  if (scope !== undefined && PY_CLASS.test(scope.text)) return undefined;
  return pythonBlockEnd(rows, index, row.indent);
};

/** The def or class a line sits in: the nearest scope header above it with less indentation. */
function enclosingScope(rows: readonly Row[], index: number, indent: number): Row | undefined {
  let limit = indent;
  for (const [, row] of rowsFrom(rows, index - 1, -1)) {
    if (limit === 0) break;
    if (row.kind !== "code" || row.indent >= limit || PY_CLOSER.test(row.text)) continue;
    if (PY_SCOPE.test(row.text)) return row;
    limit = row.indent;
  }
  return undefined;
}

/**
 * The 0-based index of the block's last line: before the first code line indented no deeper than
 * the opener (a line starting `)`, `]` or `}` excepted), the last line that is neither blank nor a
 * comment at the opener's indentation or shallower.
 */
function pythonBlockEnd(rows: readonly Row[], index: number, indent: number): number {
  let end = index;
  for (const [at, row] of rowsFrom(rows, index + 1, 1)) {
    if (row.kind === "code" && row.indent <= indent && !PY_CLOSER.test(row.text)) break;
    if (row.kind !== "blank" && (row.kind !== "comment" || row.indent > indent)) {
      end = at;
    }
  }
  return end;
}

const pythonTestBlocks: BlockFinder = (head) =>
  blocksIn(rowsOf(head), pythonTestBlock, PY_DECORATOR);

// Strings, template literals and comments. TypeScript has no lifetimes, so `'` always quotes.
const TS_LITERALS = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*|\/\*.*?\*\//g;
const TS_BRACES: Brackets = { literals: TS_LITERALS, open: "{", close: "}" };
const TS_BRACKETS: Brackets = { literals: TS_LITERALS, open: "([{", close: ")]}" };
const TS_NAMESPACE = /^(export\s+)?(declare\s+)?(namespace|module)\s+tests?\s*\{/;
const TS_TEST_CALL = /^(describe|it|test)(\.[\w$]+)*\s*\(/;
const TS_CALLBACK = /=>|\bfunction\b/;

const tsTestBlock: Opener = (row, index, rows) =>
  TS_NAMESPACE.test(row.text) ? closingLine(rows, index, TS_BRACES) : tsTestCall(row, index, rows);

/** A test-runner call that takes a callback. A definition named like one opens nothing. */
function tsTestCall(row: Row, index: number, rows: readonly Row[]): number | undefined {
  if (!TS_TEST_CALL.test(row.text)) return undefined;
  const end = closingLine(rows, index, TS_BRACKETS);
  if (end === undefined) return undefined;
  const codeLines = rows.slice(index, end + 1).map((line) => codeOf(line, TS_LITERALS));
  if (definesMethod(codeLines.join("\n"))) return undefined;
  return codeLines.some((line) => TS_CALLBACK.test(line)) ? end : undefined;
}

/** Whether the first parenthesis of the call's code closes and is followed by `{` or `:`. */
function definesMethod(code: string): boolean {
  const close = closingParen(code, code.indexOf("("));
  return close !== undefined && /^\s*[{:]/.test(code.slice(close + 1));
}

/** The index of the `)` closing the `(` at `open`, when the line closes it. */
function closingParen(code: string, open: number): number | undefined {
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
