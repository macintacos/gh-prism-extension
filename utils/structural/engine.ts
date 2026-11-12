import { type ChangeObject, diffArrays } from "diff";
import type { Parser } from "web-tree-sitter";
import { type DiffSide, withoutChanceMatches } from "./chance";
import type { StructuralChanges, TokenSpan } from "./changes";
import type { Grammar } from "./grammar";
import { PLAIN_TEXT, type PlainText, plainTextTokens } from "./plain-text";
import { keyedByIndentation, leafTokens, lineStarts, type Token } from "./tokens";

/** Why the engine returned no changes. */
export type EngineRefusal = "unsupported" | "too-large" | "too-slow" | "failed";

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

export { DEFAULT_LIMITS } from "./limits";

export interface EngineInput {
  readonly oldText: string;
  readonly newText: string;
  /** `undefined` when the file is not plain text and `grammarOf` found no grammar for it. */
  readonly language: LoadedGrammar | PlainText | undefined;
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
 * language, `too-large` past a size limit, `too-slow` when a parse or the diff passes its deadline,
 * `failed` when either text of an indentation-sensitive language parses with errors. Any other
 * language's text is compared with its errors. Rejects with `signal.reason` if `signal` has
 * aborted at the start or after either parse.
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
  if (typeof changed === "string") return refuse(changed);

  return {
    ok: true,
    changes: {
      old: spansOf(oldSource, withLayout(oldSource, changed.old)),
      new: spansOf(newSource, withLayout(newSource, changed.new)),
    },
  };
}

const refuse = (reason: EngineRefusal): EngineResult => ({ ok: false, reason });

/** `text`'s diff tokens, or why it has none. */
function tokensOf(
  text: string,
  language: LoadedGrammar | PlainText,
  limits: EngineLimits,
  now: () => number,
): Token[] | EngineRefusal {
  if (language === PLAIN_TEXT) return plainTextTokens(text, limits.maxTokens) ?? "too-large";

  const { grammar, parser } = language;
  // A parse cancelled earlier would otherwise resume on this text.
  parser.reset();
  const deadline = now() + limits.maxParseMs;
  const tree = parser.parse(text, null, { progressCallback: () => now() > deadline });
  if (tree === null) return "too-slow";

  try {
    // A tree with errors still gives every non-blank character a token, so its diff marks only
    // text that differs. A line's depth is read from the tree's brackets, which an error unbalances.
    if (tree.rootNode.hasError && grammar.indentationSensitive) return "failed";
    const tokens = leafTokens(tree, text, limits.maxTokens);
    if (tokens === undefined) return "too-large";
    return grammar.indentationSensitive ? keyedByIndentation(tokens, text) : tokens;
  } finally {
    tree.delete();
  }
}

/**
 * A text with the offset of each of its lines, the tokens the diff compares, the 0-based line each
 * of those starts on and whether it is a word, and its layout tokens.
 */
interface Source extends DiffSide {
  readonly text: string;
  readonly starts: readonly number[];
  readonly tokens: readonly Token[];
  readonly layout: readonly Token[];
}

const WORD = /[\p{L}\p{N}_]/u;

function sourceOf(text: string, all: readonly Token[]): Source {
  const starts = lineStarts(text);
  const tokens = all.filter((token) => !token.layout);
  let line = 0;
  const lines = tokens.map((token) => {
    while ((starts[line + 1] ?? Infinity) <= token.start) line++;
    return line;
  });

  const words = tokens.map((token) => WORD.test(token.key));

  return { text, starts, tokens, lines, words, layout: all.filter((token) => token.layout) };
}

/** The offset where 1-based `line` starts, or the text's end past its last line. */
const offsetOf = ({ text, starts }: Source, line: number) => starts[line - 1] ?? text.length;

interface ChangedTokens {
  readonly old: readonly Token[];
  readonly new: readonly Token[];
}

/** The tokens one Myers diff per region finds changed, or why the diff stage gave up. */
function changedTokens(
  regions: readonly ChangedRegion[],
  oldSource: Source,
  newSource: Source,
  limits: EngineLimits,
  now: () => number,
): ChangedTokens | "too-large" | "too-slow" {
  const deadline = now() + limits.maxDiffMs;
  const parts: ChangedTokens[] = [];
  for (const window of diffWindows(regions, oldSource, newSource)) {
    if (now() > deadline) return "too-slow";
    const part = windowChanges(
      sideOf(oldSource, window.oldFrom, window.oldTo),
      sideOf(newSource, window.newFrom, window.newTo),
      limits.maxEditLength,
    );
    if (part === undefined) return "too-large";
    parts.push(part);
  }

  return { old: parts.flatMap((part) => part.old), new: parts.flatMap((part) => part.new) };
}

/** One version's tokens in a window. */
interface WindowSide extends DiffSide {
  readonly tokens: readonly Token[];
}

const sideOf = ({ tokens, lines, words }: Source, from: number, to: number): WindowSide => ({
  tokens: tokens.slice(from, to),
  lines: lines.slice(from, to),
  words: words.slice(from, to),
});

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
 * The tokens one window changed, `undefined` past `maxEditLength`: those the diff leaves
 * unmatched, and those it matches only by chance. A side with no tokens leaves the other changed
 * whole. The diff runs in a canonical order of the two key lists, because Myers breaks ties by
 * direction and swapping old and new must only swap the sides.
 */
function windowChanges(
  oldSide: WindowSide,
  newSide: WindowSide,
  maxEditLength: number,
): ChangedTokens | undefined {
  if (oldSide.tokens.length === 0 || newSide.tokens.length === 0)
    return { old: oldSide.tokens, new: newSide.tokens };

  const oldKeys = oldSide.tokens.map((token) => token.key);
  const newKeys = newSide.tokens.map((token) => token.key);
  const flipped = inCanonicalOrder(newKeys, oldKeys) && !inCanonicalOrder(oldKeys, newKeys);
  const [[first, firstKeys], [second, secondKeys]] = flipped
    ? ([
        [newSide, newKeys],
        [oldSide, oldKeys],
      ] as const)
    : ([
        [oldSide, oldKeys],
        [newSide, newKeys],
      ] as const);

  const parts = diffArrays(firstKeys, secondKeys, { maxEditLength });
  if (parts === undefined) return undefined;

  const matches = withoutChanceMatches(matchesOf(parts), first, second);
  const matched = new Set(matches);
  const removed = first.tokens.filter((_, i) => matches[i] === -1);
  const added = second.tokens.filter((_, i) => !matched.has(i));
  return flipped ? { old: added, new: removed } : { old: removed, new: added };
}

/** Whether `a` sorts at or before `b`: shorter first, then by the first differing key. */
function inCanonicalOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  const i = a.findIndex((key, at) => key !== b[at]);
  return i === -1 || (a[i] as string) < (b[i] as string);
}

/** For each token of the diff's first side, the index of the second side's token `parts` matched it to, or -1. */
function matchesOf(parts: readonly ChangeObject<string[]>[]): number[] {
  const matches: number[] = [];
  let secondAt = 0;
  for (const part of parts) {
    for (let i = 0; i < part.count; i++) {
      if (part.removed) matches.push(-1);
      else if (!part.added) matches.push(secondAt + i);
    }
    if (!part.removed) secondAt += part.count;
  }
  return matches;
}

/**
 * `changed` in source order with each layout token whose line changed in full: every token after
 * it on its line, or the tokens around it when it has the line to itself.
 */
function withLayout({ text, tokens, layout }: Source, changed: readonly Token[]): readonly Token[] {
  if (layout.length === 0) return changed;

  const isChanged = new Set(changed);
  const inFull = layout.filter((leader) => {
    const lineBreak = text.indexOf("\n", leader.end);
    const { from, to } = tokenRange(tokens, leader.end, lineBreak === -1 ? text.length : lineBreak);
    const rest = from < to ? tokens.slice(from, to) : [tokens[from - 1], tokens[from]];
    return rest.every((token) => token === undefined || isChanged.has(token));
  });

  return [...changed, ...inFull].sort((a, b) => a.start - b.start);
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
