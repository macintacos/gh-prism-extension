import { type ChangeObject, diffArrays } from "diff";
import type { Parser } from "web-tree-sitter";
import type { StructuralChanges, TokenSpan } from "./changes";
import type { Grammar } from "./grammar";
import { keyedByIndentation, leafTokens, lineStarts, type Token } from "./tokens";

/** Why the engine returned no changes. */
export type EngineRefusal = "unsupported" | "too-large" | "failed";

export type EngineResult =
  | { readonly ok: true; readonly changes: StructuralChanges }
  | { readonly ok: false; readonly reason: EngineRefusal };

/**
 * One changed run of lines: 1-based line numbers of each version, `End` exclusive. A side with
 * nothing in the run has `Start === End`, at the line the change sits before.
 */
export interface ChangedRegion {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
}

/** A grammar and a parser its caller has loaded with that grammar's language. */
export interface LoadedGrammar {
  readonly grammar: Grammar;
  readonly parser: Parser;
}

export interface EngineLimits {
  readonly maxTextLength: number;
  readonly maxParseMs: number;
  readonly maxTokens: number;
  readonly maxEditLength: number;
  readonly maxDiffMs: number;
}

export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** UTF-16 units per side: about 1.5 times the largest file the spike measured. */
  maxTextLength: 256_000,
  /** Per side: one parse is one uninterruptible stage; the slowest warm parse seen was about 70 ms. */
  maxParseMs: 100,
  /** Per side: the leaf walk costs about as much as the parse; the largest file seen had 12,483. */
  maxTokens: 20_000,
  /** Per region: giving up at 1,000 costs about 46 ms on two unrelated 3,000-token sides. */
  maxEditLength: 1_000,
  /** Across all regions, checked between them, so with one region's worst case the stage stays near 100 ms. */
  maxDiffMs: 50,
});

export interface EngineInput {
  readonly oldText: string;
  readonly newText: string;
  /** `undefined` when `grammarOf` found no grammar for the file. */
  readonly language: LoadedGrammar | undefined;
  /** The file's changed runs in order; tokens outside them are taken as unchanged. */
  readonly regions: readonly ChangedRegion[];
  readonly limits: EngineLimits;
  readonly signal: AbortSignal;
  /** A millisecond clock, such as `performance.now`. */
  readonly now: () => number;
  /** Yields to the host so an abort can land: a macrotask, not a resolved promise. */
  readonly pause: () => Promise<void>;
}

/**
 * The tokens each version of a file changed, or why they can't be had: `unsupported` without a
 * grammar, `too-large` past a limit, `failed` when either text does not parse. Rejects with
 * `signal.reason` once `signal` aborts.
 */
export async function structuralChanges(input: EngineInput): Promise<EngineResult> {
  const { oldText, newText, language, regions, limits, signal, now, pause } = input;
  if (signal.aborted) throw signal.reason;
  if (language === undefined) return refuse("unsupported");
  if (Math.max(oldText.length, newText.length) > limits.maxTextLength) return refuse("too-large");

  const oldTokens = tokensOf(oldText, language, limits, now);
  if (!Array.isArray(oldTokens)) return refuse(oldTokens);
  await pause();
  if (signal.aborted) throw signal.reason;

  const newTokens = tokensOf(newText, language, limits, now);
  if (!Array.isArray(newTokens)) return refuse(newTokens);
  await pause();
  if (signal.aborted) throw signal.reason;

  const changed = changedTokens({ oldText, newText, oldTokens, newTokens, regions }, limits, now);
  if (changed === undefined) return refuse("too-large");

  return {
    ok: true,
    changes: { old: spansOf(oldText, changed.old), new: spansOf(newText, changed.new) },
  };
}

const refuse = (reason: EngineRefusal): EngineResult => ({ ok: false, reason });

/** `text`'s diff tokens, or why it has none. */
function tokensOf(
  text: string,
  { grammar, parser }: LoadedGrammar,
  limits: EngineLimits,
  now: () => number,
): Token[] | EngineRefusal {
  // A parse cancelled earlier would otherwise resume on this text.
  parser.reset();
  const deadline = now() + limits.maxParseMs;
  const tree = parser.parse(text, null, { progressCallback: () => now() > deadline });
  if (tree === null) return "too-large";

  try {
    if (tree.rootNode.hasError) return "failed";
    const tokens = leafTokens(tree, text, limits.maxTokens);
    if (tokens === undefined) return "too-large";
    return grammar.indentationSensitive ? keyedByIndentation(tokens, text) : tokens;
  } finally {
    tree.delete();
  }
}

interface TokenPair {
  readonly oldText: string;
  readonly newText: string;
  readonly oldTokens: readonly Token[];
  readonly newTokens: readonly Token[];
  readonly regions: readonly ChangedRegion[];
}

interface ChangedTokens {
  readonly old: Token[];
  readonly new: Token[];
}

/** The tokens one Myers diff per region finds changed; `undefined` past the diff caps. */
function changedTokens(
  { oldText, newText, oldTokens, newTokens, regions }: TokenPair,
  limits: EngineLimits,
  now: () => number,
): ChangedTokens | undefined {
  const deadline = now() + limits.maxDiffMs;
  const oldStarts = lineStarts(oldText);
  const newStarts = lineStarts(newText);
  const offset = (starts: number[], text: string, line: number) => starts[line - 1] ?? text.length;
  const ranges = regions.map((region) => ({
    oldStart: offset(oldStarts, oldText, region.oldStart),
    oldEnd: offset(oldStarts, oldText, region.oldEnd),
    newStart: offset(newStarts, newText, region.newStart),
    newEnd: offset(newStarts, newText, region.newEnd),
  }));

  const changed: ChangedTokens = { old: [], new: [] };
  for (const span of tokenSpans(ranges, oldTokens, newTokens)) {
    if (now() > deadline) return undefined;
    const part = spanChanges(
      oldTokens.slice(span.oldFrom, span.oldTo),
      newTokens.slice(span.newFrom, span.newTo),
      limits.maxEditLength,
    );
    if (part === undefined) return undefined;
    changed.old.push(...part.old);
    changed.new.push(...part.new);
  }
  return changed;
}

/** A changed region as character offsets, `End` exclusive. */
interface OffsetRegion {
  readonly oldStart: number;
  readonly oldEnd: number;
  readonly newStart: number;
  readonly newEnd: number;
}

interface Span {
  oldFrom: number;
  oldTo: number;
  newFrom: number;
  newTo: number;
}

/** The first index in sorted, disjoint `tokens` for which `past` holds. */
function firstIndex(tokens: readonly Token[], past: (token: Token) => boolean): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (past(tokens[mid] as Token)) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** The token index range `[from, to)` overlapping `[start, end)`; for an empty range, the token straddling it. */
const tokenSpan = (tokens: readonly Token[], start: number, end: number) => ({
  from: firstIndex(tokens, (token) => token.end > start),
  to: firstIndex(tokens, (token) => token.start >= end),
});

const sameKeys = (a: readonly Token[], b: readonly Token[]) =>
  a.length === b.length && a.every((token, i) => token.key === b[i]?.key);

/**
 * Each region as token index spans, merged until the tokens between spans (and before the first
 * and after the last) match one for one, so a token straddling a region boundary never leaves the
 * unchanged runs disagreeing.
 */
function tokenSpans(
  regions: readonly OffsetRegion[],
  oldTokens: readonly Token[],
  newTokens: readonly Token[],
): Span[] {
  const spans: Span[] = [];
  const unchangedMatch = (oldFrom: number, oldTo: number, newFrom: number, newTo: number) =>
    oldTo >= oldFrom &&
    newTo >= newFrom &&
    sameKeys(oldTokens.slice(oldFrom, oldTo), newTokens.slice(newFrom, newTo));

  for (const region of regions) {
    const old = tokenSpan(oldTokens, region.oldStart, region.oldEnd);
    const added = tokenSpan(newTokens, region.newStart, region.newEnd);
    const span = { oldFrom: old.from, oldTo: old.to, newFrom: added.from, newTo: added.to };
    const last = spans.at(-1);
    const before = last ?? { oldTo: 0, newTo: 0 };
    if (unchangedMatch(before.oldTo, span.oldFrom, before.newTo, span.newFrom)) spans.push(span);
    else if (last) Object.assign(last, { oldTo: span.oldTo, newTo: span.newTo });
    else spans.push({ ...span, oldFrom: 0, newFrom: 0 });
  }

  const last = spans.at(-1);
  if (last && !unchangedMatch(last.oldTo, oldTokens.length, last.newTo, newTokens.length))
    Object.assign(last, { oldTo: oldTokens.length, newTo: newTokens.length });
  return spans;
}

/**
 * The tokens one span changed, `undefined` past `maxEditLength`. The diff runs in a canonical
 * order of the two key lists, because Myers breaks ties by direction and swapping old and new
 * must only swap the sides.
 */
function spanChanges(
  oldTokens: Token[],
  newTokens: Token[],
  maxEditLength: number,
): ChangedTokens | undefined {
  const oldKeys = oldTokens.map((token) => token.key);
  const newKeys = newTokens.map((token) => token.key);
  const flipped = inCanonicalOrder(newKeys, oldKeys) && !inCanonicalOrder(oldKeys, newKeys);

  const parts = flipped
    ? diffArrays(newKeys, oldKeys, { maxEditLength })
    : diffArrays(oldKeys, newKeys, { maxEditLength });
  if (parts === undefined) return undefined;

  const [removed, added] = flipped
    ? changesOf(parts, newTokens, oldTokens)
    : changesOf(parts, oldTokens, newTokens);
  return flipped ? { old: added, new: removed } : { old: removed, new: added };
}

/** Whether `a` sorts at or before `b`: shorter first, then by the first differing key. */
function inCanonicalOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  const i = a.findIndex((key, at) => key !== b[at]);
  return i === -1 || (a[i] as string) < (b[i] as string);
}

/** The tokens `parts` removed from `first` and added from `second`. */
function changesOf(
  parts: readonly ChangeObject<string[]>[],
  first: readonly Token[],
  second: readonly Token[],
): [Token[], Token[]] {
  const removed: Token[] = [];
  const added: Token[] = [];
  let firstAt = 0;
  let secondAt = 0;
  for (const part of parts) {
    if (part.removed) removed.push(...first.slice(firstAt, firstAt + part.count));
    if (part.added) added.push(...second.slice(secondAt, secondAt + part.count));
    if (!part.added) firstAt += part.count;
    if (!part.removed) secondAt += part.count;
  }
  return [removed, added];
}

/** One span per line each of `tokens` touches, without line terminators; `tokens` in source order. */
function spansOf(text: string, tokens: readonly Token[]): TokenSpan[] {
  const starts = lineStarts(text);
  const spans: TokenSpan[] = [];
  let line = 0;
  for (const token of tokens) {
    for (let at = token.start; at < token.end; ) {
      while ((starts[line + 1] ?? Infinity) <= at) line++;
      const lineStart = starts[line] ?? 0;
      const newline = text.indexOf("\n", at);
      const lineEnd = newline === -1 ? text.length : newline;
      const pieceEnd = Math.min(token.end, lineEnd);
      const end = pieceEnd === newline && text[pieceEnd - 1] === "\r" ? pieceEnd - 1 : pieceEnd;
      if (end > at)
        spans.push({ line: line + 1, startCol: at - lineStart, endCol: end - lineStart });
      at = lineEnd + 1;
    }
  }
  return spans;
}
