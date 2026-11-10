import { type ChangeObject, diffArrays } from "diff";
import type { Parser } from "web-tree-sitter";
import type { StructuralChanges, TokenSpan } from "./changes";
import type { Grammar } from "./grammar";
import { keyedByIndentation, leafTokens, lineStarts, type Token } from "./tokens";

/** Why the engine returned no changes. */
export type EngineRefusal = "unsupported" | "too-large" | "failed";

/** The engine's answer for one file: its changes, or a refusal. Never partial. */
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

/**
 * A grammar and a parser its caller has loaded with that grammar's language; the engine does not
 * check the pairing.
 */
export interface LoadedGrammar {
  readonly grammar: Grammar;
  readonly parser: Parser;
}

export interface EngineLimits {
  /** UTF-16 units, per side. */
  readonly maxTextLength: number;
  /** Milliseconds, per side's parse. */
  readonly maxParseMs: number;
  /** Per side. */
  readonly maxTokens: number;
  /** Edits one region's diff may reach. */
  readonly maxEditLength: number;
  /** Milliseconds across all regions, checked between them. */
  readonly maxDiffMs: number;
}

export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** About 1.5 times the largest file measured (170,549 bytes). */
  maxTextLength: 256_000,
  /** One parse is one uninterruptible stage; the slowest warm parse seen was about 70 ms. */
  maxParseMs: 100,
  /** The leaf walk costs about as much as the parse; the largest file seen had 12,483. */
  maxTokens: 20_000,
  /** Giving up at 1,000 costs about 46 ms on two unrelated 3,000-token sides. */
  maxEditLength: 1_000,
  /** With one region's worst case, keeps the diff stage near 100 ms. */
  maxDiffMs: 50,
});

export interface EngineInput {
  readonly oldText: string;
  readonly newText: string;
  /** `undefined` when `grammarOf` found no grammar for the file. */
  readonly language: LoadedGrammar | undefined;
  /**
   * The file's changed runs in order, in 1-based lines of these exact texts, split on `\n` only;
   * tokens outside them are taken as unchanged.
   */
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
 * `signal.reason` if `signal` has aborted at the start or after either parse.
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

  const oldSource = sourceOf(oldText, oldTokens);
  const newSource = sourceOf(newText, newTokens);
  const changed = changedTokens(regions, oldSource, newSource, limits, now);
  if (changed === undefined) return refuse("too-large");

  return {
    ok: true,
    changes: { old: spansOf(oldSource, changed.old), new: spansOf(newSource, changed.new) },
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

/** A text with the offset of each of its lines, and its tokens. */
interface Source {
  readonly text: string;
  readonly starts: readonly number[];
  readonly tokens: readonly Token[];
}

const sourceOf = (text: string, tokens: readonly Token[]): Source => ({
  text,
  starts: lineStarts(text),
  tokens,
});

/** The offset where 1-based `line` starts, or the text's end past its last line. */
const offsetOf = ({ text, starts }: Source, line: number) => starts[line - 1] ?? text.length;

interface ChangedTokens {
  readonly old: readonly Token[];
  readonly new: readonly Token[];
}

/** The tokens one Myers diff per region finds changed; `undefined` past the diff caps. */
function changedTokens(
  regions: readonly ChangedRegion[],
  oldSource: Source,
  newSource: Source,
  limits: EngineLimits,
  now: () => number,
): ChangedTokens | undefined {
  const deadline = now() + limits.maxDiffMs;
  const parts: ChangedTokens[] = [];
  for (const window of diffWindows(regions, oldSource, newSource)) {
    if (now() > deadline) return undefined;
    const part = windowChanges(
      oldSource.tokens.slice(window.oldFrom, window.oldTo),
      newSource.tokens.slice(window.newFrom, window.newTo),
      limits.maxEditLength,
    );
    if (part === undefined) return undefined;
    parts.push(part);
  }

  return { old: parts.flatMap((part) => part.old), new: parts.flatMap((part) => part.new) };
}

/** The old and new token index ranges one Myers diff covers, `To` exclusive. */
interface TokenWindow {
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

/**
 * The token index range `[from, to)` overlapping `[start, end)`; an empty range yields the token
 * straddling it, or none.
 */
const tokenRange = (tokens: readonly Token[], start: number, end: number) => ({
  from: firstIndex(tokens, (token) => token.end > start),
  to: firstIndex(tokens, (token) => token.start >= end),
});

const sameKeys = (a: readonly Token[], b: readonly Token[]) =>
  a.length === b.length && a.every((token, i) => token.key === b[i]?.key);

/**
 * Each region as a token window, merged until the tokens between windows (and before the first
 * and after the last) match one for one, so a token straddling a region boundary never leaves the
 * unchanged runs disagreeing; a mismatch before the first or after the last widens that window to
 * the file's edge.
 */
function diffWindows(
  regions: readonly ChangedRegion[],
  oldSource: Source,
  newSource: Source,
): TokenWindow[] {
  const windows: TokenWindow[] = [];
  const unchangedMatch = (oldFrom: number, oldTo: number, newFrom: number, newTo: number) =>
    oldTo >= oldFrom &&
    newTo >= newFrom &&
    sameKeys(oldSource.tokens.slice(oldFrom, oldTo), newSource.tokens.slice(newFrom, newTo));

  for (const region of regions) {
    const oldRange = tokenRange(
      oldSource.tokens,
      offsetOf(oldSource, region.oldStart),
      offsetOf(oldSource, region.oldEnd),
    );
    const newRange = tokenRange(
      newSource.tokens,
      offsetOf(newSource, region.newStart),
      offsetOf(newSource, region.newEnd),
    );
    const window = {
      oldFrom: oldRange.from,
      oldTo: oldRange.to,
      newFrom: newRange.from,
      newTo: newRange.to,
    };
    const last = windows.at(-1);
    const before = last ?? { oldTo: 0, newTo: 0 };
    if (unchangedMatch(before.oldTo, window.oldFrom, before.newTo, window.newFrom))
      windows.push(window);
    else if (last) Object.assign(last, { oldTo: window.oldTo, newTo: window.newTo });
    else windows.push({ ...window, oldFrom: 0, newFrom: 0 });
  }

  const last = windows.at(-1);
  if (
    last &&
    !unchangedMatch(last.oldTo, oldSource.tokens.length, last.newTo, newSource.tokens.length)
  )
    Object.assign(last, { oldTo: oldSource.tokens.length, newTo: newSource.tokens.length });
  return windows;
}

/**
 * The tokens one window changed, `undefined` past `maxEditLength`. A side with no tokens leaves
 * the other changed whole. The diff runs in a canonical order of the two key lists, because
 * Myers breaks ties by direction and swapping old and new must only swap the sides.
 */
function windowChanges(
  oldTokens: readonly Token[],
  newTokens: readonly Token[],
  maxEditLength: number,
): ChangedTokens | undefined {
  if (oldTokens.length === 0 || newTokens.length === 0) return { old: oldTokens, new: newTokens };

  const oldKeys = oldTokens.map((token) => token.key);
  const newKeys = newTokens.map((token) => token.key);
  const flipped = inCanonicalOrder(newKeys, oldKeys) && !inCanonicalOrder(oldKeys, newKeys);
  const [[first, firstKeys], [second, secondKeys]] = flipped
    ? ([
        [newTokens, newKeys],
        [oldTokens, oldKeys],
      ] as const)
    : ([
        [oldTokens, oldKeys],
        [newTokens, newKeys],
      ] as const);

  const parts = diffArrays(firstKeys, secondKeys, { maxEditLength });
  if (parts === undefined) return undefined;

  const [removed, added] = changesOf(parts, first, second);
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
    for (let i = 0; i < part.count; i++) {
      if (part.removed) removed.push(first[firstAt + i] as Token);
      if (part.added) added.push(second[secondAt + i] as Token);
    }
    if (!part.added) firstAt += part.count;
    if (!part.removed) secondAt += part.count;
  }

  return [removed, added];
}

/**
 * One span per line each of `tokens` touches, without line terminators; `tokens` in source
 * order.
 */
function spansOf({ text, starts }: Source, tokens: readonly Token[]): TokenSpan[] {
  const textEnd = text.endsWith("\n") ? text.length - 1 : text.length;
  const spans: TokenSpan[] = [];
  let line = 0;

  for (const token of tokens) {
    for (let at = token.start; at < token.end; ) {
      while ((starts[line + 1] ?? Infinity) <= at) line++;
      const lineStart = starts[line] ?? 0;
      const lineEnd = (starts[line + 1] ?? textEnd + 1) - 1;

      const pieceEnd = Math.min(token.end, lineEnd);
      const end = pieceEnd === lineEnd && text[pieceEnd - 1] === "\r" ? pieceEnd - 1 : pieceEnd;
      if (end > at)
        spans.push({ line: line + 1, startCol: at - lineStart, endCol: end - lineStart });
      at = lineEnd + 1;
    }
  }

  return spans;
}
