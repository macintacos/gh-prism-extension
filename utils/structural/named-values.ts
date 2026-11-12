import type { Token } from "./tokens";
import type { Unit } from "./units";

/** A run of one version's diff tokens: indexes, `to` exclusive. */
export interface TokenRun {
  readonly from: number;
  readonly to: number;
}

/** What the pairing reads of one version: its diff tokens, the line and word of each, and its statements. */
export interface PairingSide {
  readonly text: string;
  readonly tokens: readonly Token[];
  readonly lines: readonly number[];
  readonly words: readonly boolean[];
  /** The text's {@link innermostUnits}; `undefined` for a text with no tree. */
  readonly statements?: readonly Unit[] | undefined;
}

/** The tokens of one version that a window covers. */
export interface Windowed extends TokenRun {
  readonly side: PairingSide;
}

/**
 * A statement of each version that differ only by a value: one holds it, and the other holds the
 * name an earlier statement of its version gives it. `changed` is the value and the name.
 */
export interface NamedValue {
  readonly old: TokenRun;
  readonly new: TokenRun;
  readonly changed: { readonly old: TokenRun; readonly new: TokenRun };
}

/**
 * Each of `units` with no unit inside it, in source order: a statement, or a list whose entries
 * each have one line, since those are no units.
 */
export function innermostUnits(units: readonly Unit[]): Unit[] {
  const outerFirst = units.toSorted((a, b) => a.start - b.start || b.end - a.end);
  return outerFirst.filter((unit, i) => (outerFirst[i + 1]?.start ?? Infinity) >= unit.end);
}

// ponytail: every statement of a window is tried against every one of the other version's, so a
// window past this many pairs is left to the diff alone. Index statements by their first key if
// large windows need the pairing.
const MAX_STATEMENT_PAIRS = 40_000;

/**
 * The named values between two windows, in order, none crossing another: a value extracted into a
 * name, or a name inlined back to its value. Statements are paired a line at a time, then a whole
 * statement at a time where no line of it paired. None when the windows hold the same tokens.
 */
export function namedValues(old: Windowed, new_: Windowed): NamedValue[] {
  if (old.from === old.to || new_.from === new_.to || sameTokens(old, new_)) return [];

  const oldLines = lineCut(old);
  const newLines = lineCut(new_);
  const byLine = pairsBetween(oldLines, newLines);

  const oldStatements = statementCut(old);
  const newStatements = statementCut(new_);
  // A statement is whole lines, so as many statements as lines means each is one line.
  const cutAlike =
    oldStatements.runs.length === oldLines.runs.length &&
    newStatements.runs.length === newLines.runs.length;
  const byStatement = cutAlike
    ? []
    : pairsBetween(oldStatements, newStatements).filter((pair) =>
        byLine.every((other) => inOrder(pair, other)),
      );

  const pairs = [...byLine, ...byStatement].sort((a, b) => a.old.from - b.old.from);
  return pairs.filter((pair) => pairs.every((other) => other === pair || inOrder(pair, other)));
}

function sameTokens(a: Windowed, b: Windowed): boolean {
  if (a.to - a.from !== b.to - b.from) return false;
  for (let i = 0; a.from + i < a.to; i++)
    if (a.side.tokens[a.from + i]?.key !== b.side.tokens[b.from + i]?.key) return false;
  return true;
}

/** Whether one of two pairs sits wholly before the other in both versions. */
const inOrder = (a: NamedValue, b: NamedValue) =>
  (a.old.to <= b.old.from && a.new.to <= b.new.from) ||
  (b.old.to <= a.old.from && b.new.to <= a.new.from);

/** A window's tokens cut into runs that follow one another. */
interface Cut {
  readonly side: PairingSide;
  readonly runs: readonly TokenRun[];
}

/** `window` cut before each token that `opens` holds for. */
function cut(window: Windowed, opens: (at: number) => boolean): Cut {
  const runs: { from: number; to: number }[] = [];
  for (let at = window.from; at < window.to; at++) {
    const open = runs.at(-1);
    const opensRun = opens(at);
    if (open && !opensRun) open.to = at + 1;
    else runs.push({ from: at, to: at + 1 });
  }
  return { side: window.side, runs };
}

const lineCut = (window: Windowed): Cut =>
  cut(window, (at) => window.side.lines[at] !== window.side.lines[at - 1]);

/**
 * `window` cut into its statements: each innermost unit, and each line outside one. Into its
 * lines for a text with no tree.
 */
function statementCut(window: Windowed): Cut {
  const { tokens, lines, statements } = window.side;
  if (!statements) return lineCut(window);

  const startOf = (at: number) => tokens[at]?.start ?? 0;
  let unitAt = firstEndingAfter(statements, startOf(window.from));
  let last: Unit | number | undefined;
  return cut(window, (at) => {
    while ((statements[unitAt]?.end ?? Infinity) <= startOf(at)) unitAt++;
    const unit = statements[unitAt];
    const statement = unit && unit.start <= startOf(at) ? unit : lines[at];
    const opens = statement !== last;
    last = statement;
    return opens;
  });
}

/** The index of the first of `units`, sorted and disjoint, that ends after `offset`. */
function firstEndingAfter(units: readonly Unit[], offset: number): number {
  let low = 0;
  let high = units.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((units[mid]?.end ?? Infinity) > offset) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** The named values between two cuts, in either direction. */
function pairsBetween(old: Cut, new_: Cut): NamedValue[] {
  if (old.runs.length * new_.runs.length > MAX_STATEMENT_PAIRS) return [];

  const extracted = namedFrom(old, new_).map(
    ({ holder, user, value, name }): NamedValue => ({
      old: holder,
      new: user,
      changed: { old: value, new: name },
    }),
  );
  const inlined = namedFrom(new_, old).map(
    ({ holder, user, value, name }): NamedValue => ({
      old: user,
      new: holder,
      changed: { old: name, new: value },
    }),
  );
  return [...extracted, ...inlined];
}

/** A run of `a` that holds a value, the first run of `b` that uses a name in its place, and the two. */
interface Naming {
  readonly holder: TokenRun;
  readonly user: TokenRun;
  readonly value: TokenRun;
  readonly name: TokenRun;
}

/** Each run of `a` whose value a run of `b` names, where an earlier run of `b` gives it that name. */
function namedFrom(a: Cut, b: Cut): Naming[] {
  const found: Naming[] = [];
  // A name needs a run that defines it and a later one that uses it.
  if (b.runs.length < 2) return found;

  const key = (side: PairingSide, at: number) => side.tokens[at]?.key;
  const ends = b.runs.map((run) => [key(b.side, run.from), key(b.side, run.to - 1)] as const);
  const isDefined = definitionsIn(b);
  for (const holder of a.runs) {
    const first = key(a.side, holder.from);
    const last = key(a.side, holder.to - 1);
    for (const [i, user] of b.runs.entries()) {
      // Most runs share neither end with the holder, so this spares their comparison.
      if (ends[i]?.[0] !== first && ends[i]?.[1] !== last) continue;
      const swap = swapBetween(a.side, holder, b.side, user);
      if (!swap || !isNames(b.side, swap.name)) continue;
      const definition = { value: textsOf(a.side, swap.value), names: wordsOf(b.side, swap.name) };
      if (!isDefined(definition, user.from)) continue;

      found.push({ holder, user, ...swap });
      break;
    }
  }
  return found;
}

const textOf = ({ text, tokens }: PairingSide, at: number): string => {
  const token = tokens[at];
  return token ? text.slice(token.start, token.end) : "";
};

/**
 * The one stretch two runs differ by, when `long` is `short` with a longer stretch in place of a
 * shorter one that is not empty, and they share a token before or after it. Tokens compare by key,
 * so a statement at another depth is another statement.
 */
function swapBetween(
  a: PairingSide,
  long: TokenRun,
  b: PairingSide,
  short: TokenRun,
): { value: TokenRun; name: TokenRun } | undefined {
  const length = short.to - short.from;
  if (long.to - long.from <= length) return undefined;

  const key = (side: PairingSide, at: number) => side.tokens[at]?.key;
  let before = 0;
  while (before < length - 1 && key(a, long.from + before) === key(b, short.from + before))
    before++;
  let after = 0;
  while (
    before + after < length - 1 &&
    key(a, long.to - 1 - after) === key(b, short.to - 1 - after)
  )
    after++;
  if (before + after === 0) return undefined;

  return {
    value: { from: long.from + before, to: long.to - after },
    name: { from: short.from + before, to: short.to - after },
  };
}

const textsOf = (side: PairingSide, run: TokenRun): string[] =>
  side.tokens.slice(run.from, run.to).map((token) => side.text.slice(token.start, token.end));

const SEPARATOR = ",";

const wordsOf = (side: PairingSide, run: TokenRun): string[] => {
  const words: string[] = [];
  for (let at = run.from; at < run.to; at++) if (side.words[at]) words.push(textOf(side, at));
  return words;
};

const isSeparator = ({ text, tokens }: PairingSide, at: number): boolean => {
  const token = tokens[at];
  return token !== undefined && token.end - token.start === 1 && text[token.start] === SEPARATOR;
};

/** Whether `run` is names alone: words with commas between them, or one word after a sigil, as in `$v`. */
function isNames(side: PairingSide, run: TokenRun): boolean {
  const length = run.to - run.from;
  let words = 0;
  let commas = 0;
  for (let at = run.from; at < run.to; at++) {
    if (side.words[at]) words++;
    else if (isSeparator(side, at)) commas++;
  }
  if (words + commas === length) return words > 0;

  return length === 2 && side.words[run.from + 1] === true && !side.words[run.from];
}

/** A value as its tokens' texts, and the words that name it. */
interface Definition {
  readonly value: readonly string[];
  readonly names: readonly string[];
}

/**
 * Answers whether a run of a cut that ends at or before a token index defines a value's names: it
 * holds the value's tokens in a row, and each name outside them. The value compares by text, since
 * its first token's key may carry the depth of the line it opened.
 */
function definitionsIn({ side, runs }: Cut): (definition: Definition, before: number) => boolean {
  // Where each text sits, read on the first question: most windows never ask one.
  let places: Map<string, { at: number; run: TokenRun }[]> | undefined;
  const placesOf = (text: string) => {
    places ??= Map.groupBy(
      runs.flatMap((run) => textsOf(side, run).map((text, i) => ({ text, at: run.from + i, run }))),
      (place) => place.text,
    );
    return places.get(text) ?? [];
  };

  return ({ value, names }, before) => {
    // The value's rarest token has the fewest places to look at; `<` or `(` may have hundreds.
    let rarest = 0;
    let fewest = Infinity;
    for (const [i, text] of value.entries()) {
      const count = placesOf(text).length;
      if (count === 0) return false;
      if (count < fewest) [rarest, fewest] = [i, count];
    }

    return placesOf(value[rarest] ?? "").some(({ at: rarestAt, run }) => {
      const at = rarestAt - rarest;
      const end = at + value.length;
      if (run.to > before || at < run.from || end > run.to) return false;

      const holdsOutside = (name: string) => {
        for (let i = run.from; i < run.to; i++)
          if ((i < at || i >= end) && textOf(side, i) === name) return true;
        return false;
      };
      return value.every((text, i) => textOf(side, at + i) === text) && names.every(holdsOutside);
    });
  };
}
