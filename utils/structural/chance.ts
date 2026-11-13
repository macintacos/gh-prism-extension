/** One side of a diff: for each of its tokens in source order, the line it starts on and its kind. */
export interface DiffSide {
  readonly lines: readonly number[];
  /** A token with a letter, a digit, or an underscore; punctuation is not one. */
  readonly words: readonly boolean[];
  /** A word that is not a keyword, a keyword being a leaf whose node type is its text. */
  readonly names: readonly boolean[];
}

/** One side of a diff: for each of its tokens in source order, the line it starts on and its key. */
export interface KeyedSide {
  readonly lines: readonly number[];
  readonly keys: readonly string[];
}

/** A run of tokens two sides share: `length` tokens from index `first` on one and `second` on the other. */
interface Run {
  readonly first: number;
  readonly second: number;
  readonly length: number;
}

/** One matched token: its index on the first side and on the second. */
type Pair = readonly [first: number, second: number];

/**
 * `matches` without the ones a diff of unrelated code finds by chance, such as a `}` or a shared
 * name in a block that was replaced whole.
 *
 * A line is replaced when it keeps less than half its tokens, or half of them when it is all
 * punctuation. Its main partner is the line of the other side holding the most of its kept
 * tokens, the earlier one on a tie. It vouches for a match with its main partner when it is not
 * replaced and keeps a name. A run of matched tokens is chance when, on a replaced line of either
 * side, a changed run at least as long as it sits before it and another after it, unless its line
 * on the other side vouches for it. After that, a match is chance when either of its lines is
 * replaced and the other does not vouch for it; what each line keeps is counted again after each
 * round of drops, until a round drops none.
 *
 * @param matches - For each token of `first`, the index of the token of `second` it equals, or
 *   -1. The indexes increase.
 * @returns `matches` with -1 for each chance match.
 */
export function withoutChanceMatches(
  matches: readonly number[],
  first: DiffSide,
  second: DiffSide,
): number[] {
  const found = runsOf(matches);
  const runs = outOfSeas(found, [
    { lines: first.lines, kept: keptLines(first, second.lines, pairsOfRuns(found), 0) },
    { lines: second.lines, kept: keptLines(second, first.lines, pairsOfRuns(found), 1) },
  ]);
  const vouched = withoutUnvouched(pairsOfRuns(runs), first, second);
  return matchesOfPairs(vouched, matches.length);
}

/**
 * `matches` with more matches on the line pairs of those it holds. Before and after each match,
 * the unmatched tokens on its own two lines match where their keys are equal, from the start of
 * both, then from the end of what is left.
 *
 * @param matches - As {@link withoutChanceMatches} takes and returns them.
 */
export function rematchedOnLines(
  matches: readonly number[],
  first: KeyedSide,
  second: KeyedSide,
): number[] {
  const result = [...matches];
  const anchors = pairsOf(matches);
  let edge: Pair = [-1, -1];
  anchors.forEach(([i, j], at) => {
    const next = anchors[at + 1] ?? [first.lines.length, second.lines.length];
    matchGap(result, [first, second], {
      first: onLineBefore(first.lines, edge[0] + 1, i),
      second: onLineBefore(second.lines, edge[1] + 1, j),
    });
    const after = matchGap(result, [first, second], {
      first: onLineAfter(first.lines, i, next[0]),
      second: onLineAfter(second.lines, j, next[1]),
    });
    edge = after ?? [i, j];
  });
  return result;
}

/** Token index range `[from, to)`. */
interface Span {
  readonly from: number;
  readonly to: number;
}

/** The tokens in `[from, at)` on `at`'s line. */
function onLineBefore(lines: readonly number[], from: number, at: number): Span {
  let start = at;
  while (start > from && lines[start - 1] === lines[at]) start--;
  return { from: start, to: at };
}

/** The tokens in `(at, to)` on `at`'s line. */
function onLineAfter(lines: readonly number[], at: number, to: number): Span {
  let end = at + 1;
  while (end < to && lines[end] === lines[at]) end++;
  return { from: at + 1, to: end };
}

/**
 * Matches into `result` the equal-keyed tokens that open both spans, then those that close what
 * is left; returns the last pair matched.
 */
function matchGap(
  result: number[],
  [first, second]: readonly [KeyedSide, KeyedSide],
  spans: { readonly first: Span; readonly second: Span },
): Pair | undefined {
  let { from: a, to: aEnd } = spans.first;
  let { from: b, to: bEnd } = spans.second;
  let opening: Pair | undefined;
  while (a < aEnd && b < bEnd && first.keys[a] === second.keys[b]) {
    result[a] = b;
    opening = [a++, b++];
  }

  let closing: Pair | undefined;
  while (aEnd > a && bEnd > b && first.keys[aEnd - 1] === second.keys[bEnd - 1]) {
    result[--aEnd] = --bEnd;
    closing ??= [aEnd, bEnd];
  }
  return closing ?? opening;
}

/** The maximal runs of `matches` that are consecutive on both sides. */
function runsOf(matches: readonly number[]): Run[] {
  const runs: Run[] = [];
  let open: { first: number; second: number; length: number } | undefined;
  matches.forEach((second, first) => {
    if (second === -1) return;
    if (open && open.first + open.length === first && open.second + open.length === second) {
      open.length++;
      return;
    }

    open = { first, second, length: 1 };
    runs.push(open);
  });
  return runs;
}

const pairsOf = (matches: readonly number[]): Pair[] =>
  matches.flatMap((second, first): Pair[] => (second === -1 ? [] : [[first, second]]));

const pairsOfRuns = (runs: readonly Run[]): Pair[] =>
  runs.flatMap((run) =>
    Array.from({ length: run.length }, (_, i): Pair => [run.first + i, run.second + i]),
  );

function matchesOfPairs(pairs: readonly Pair[], length: number): number[] {
  const matches = Array.from({ length }, () => -1);
  for (const [first, second] of pairs) matches[first] = second;
  return matches;
}

/**
 * `pairs` without each one that a replaced line holds and the other line does not vouch for,
 * dropped round by round until none is.
 */
function withoutUnvouched(pairs: readonly Pair[], first: DiffSide, second: DiffSide): Pair[] {
  // ponytail: each round recounts every line, so a cascade of k rounds costs O(k·tokens); a
  // worklist of the lines each drop touches if long cascades show up.
  for (;;) {
    const firstKept = keptLines(first, second.lines, pairs, 0);
    const secondKept = keptLines(second, first.lines, pairs, 1);
    const chance = ([i, j]: Pair) => {
      const [firstLine, secondLine] = [first.lines[i] ?? -1, second.lines[j] ?? -1];
      return (
        (firstKept.replaced.has(firstLine) &&
          secondKept.mainPartner.get(secondLine) !== firstLine) ||
        (secondKept.replaced.has(secondLine) && firstKept.mainPartner.get(firstLine) !== secondLine)
      );
    };
    const real = pairs.filter((pair) => !chance(pair));
    if (real.length === pairs.length) return real;
    pairs = real;
  }
}

/** What one side's lines keep: the replaced ones, and the main partner of each that vouches. */
interface KeptLines {
  readonly replaced: ReadonlySet<number>;
  readonly mainPartner: ReadonlyMap<number, number>;
}

/** What each line of `side` keeps in `pairs`, whose `which` index is on `side`. */
function keptLines(
  { lines, words, names }: DiffSide,
  otherLines: readonly number[],
  pairs: readonly Pair[],
  which: 0 | 1,
): KeptLines {
  const tokens = new Map<number, number>();
  const worded = new Set<number>();
  lines.forEach((line, at) => {
    tokens.set(line, (tokens.get(line) ?? 0) + 1);
    if (words[at]) worded.add(line);
  });

  const partners = new Map<number, Map<number, number>>();
  const named = new Set<number>();
  for (const pair of pairs) {
    const at = pair[which];
    const line = lines[at] ?? -1;
    const counts = partners.get(line) ?? new Map<number, number>();
    partners.set(line, counts);
    const partner = otherLines[pair[which === 0 ? 1 : 0]] ?? -1;
    counts.set(partner, (counts.get(partner) ?? 0) + 1);
    if (names[at]) named.add(line);
  }

  const replaced = new Set<number>();
  const mainPartner = new Map<number, number>();
  for (const [line, count] of tokens) {
    const counts = partners.get(line);
    const twice = sum(counts) * 2;
    if (twice < count || (twice === count && !worded.has(line))) replaced.add(line);
    else if (counts && named.has(line)) mainPartner.set(line, mostHeld(counts));
  }
  return { replaced, mainPartner };
}

const sum = (counts: ReadonlyMap<number, number> | undefined) =>
  [...(counts?.values() ?? [])].reduce((total, count) => total + count, 0);

/** The partner line holding the most tokens; `counts` is in line order, so a tie keeps the earlier. */
function mostHeld(counts: ReadonlyMap<number, number>): number {
  let best = -1;
  let most = 0;
  for (const [line, count] of counts) if (count > most) [best, most] = [line, count];
  return best;
}

interface SeaSide {
  readonly lines: readonly number[];
  readonly kept: KeptLines;
}

/**
 * `runs` without each one in a sea of changes on a replaced line that its other line does not
 * vouch for. A dropped run widens the changes around the run before it, which is then judged
 * again.
 */
function outOfSeas(runs: readonly Run[], [first, second]: readonly [SeaSide, SeaSide]): Run[] {
  const kept: Run[] = [];
  const adrift = (before: Run | undefined, run: Run, after: Run | undefined) => {
    const firstLine = first.lines[run.first] ?? -1;
    const secondLine = second.lines[run.second] ?? -1;
    const inFirstSea =
      first.kept.replaced.has(firstLine) &&
      second.kept.mainPartner.get(secondLine) !== firstLine &&
      inSea(first.lines, run.first, run.length, {
        from: before ? before.first + before.length : 0,
        to: after ? after.first : first.lines.length,
      });
    const inSecondSea =
      second.kept.replaced.has(secondLine) &&
      first.kept.mainPartner.get(firstLine) !== secondLine &&
      inSea(second.lines, run.second, run.length, {
        from: before ? before.second + before.length : 0,
        to: after ? after.second : second.lines.length,
      });
    return inFirstSea || inSecondSea;
  };

  runs.forEach((run, i) => {
    kept.push(run);
    for (let top = kept.at(-1); top && adrift(kept.at(-2), top, runs[i + 1]); top = kept.at(-1))
      kept.pop();
  });
  return kept;
}

/**
 * Whether the `length` tokens from `start` have at least `length` changed tokens on their own line
 * both before and after them. The changed tokens around them are those in `[from, to)`.
 */
function inSea(
  lines: readonly number[],
  start: number,
  length: number,
  { from, to }: { readonly from: number; readonly to: number },
): boolean {
  const end = start + length;
  let before = 0;
  while (before < length && start - before > from && lines[start - before - 1] === lines[start])
    before++;
  let after = 0;
  while (after < length && end + after < to && lines[end + after] === lines[end - 1]) after++;

  return before === length && after === length;
}
