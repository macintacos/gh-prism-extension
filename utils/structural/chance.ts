/** One side of a diff: for each of its tokens in source order, the line it starts on and whether it is a word. */
export interface DiffSide {
  readonly lines: readonly number[];
  /** A token with a letter, a digit, or an underscore; punctuation is not one. */
  readonly words: readonly boolean[];
}

/** A run of tokens two sides share: `length` tokens from index `first` on one and `second` on the other. */
interface Run {
  readonly first: number;
  readonly second: number;
  readonly length: number;
}

/**
 * `matches` without the ones a diff of unrelated code finds by chance, such as a `}` or a shared
 * name in a block that was replaced whole.
 *
 * A line is replaced when it keeps less than half its tokens, or half of them when it is all
 * punctuation. It vouches for its matches when it is not replaced and keeps a word. A run of
 * matched tokens is chance when, on a replaced line of either side, a changed run at least as
 * long as it sits before it and another after it, unless its line on the other side vouches for
 * it. After that, any match between two replaced lines is chance.
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
    { lines: first.lines, kept: keptLines(first, found, "first") },
    { lines: second.lines, kept: keptLines(second, found, "second") },
  ]);
  const firstKept = keptLines(first, runs, "first");
  const secondKept = keptLines(second, runs, "second");

  const real = matches.map(() => -1);
  for (const run of runs) {
    for (let i = 0; i < run.length; i++) {
      const replaced =
        firstKept.replaced.has(first.lines[run.first + i] as number) &&
        secondKept.replaced.has(second.lines[run.second + i] as number);
      if (!replaced) real[run.first + i] = run.second + i;
    }
  }
  return real;
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

/** What one side's lines keep: the replaced ones, and those that vouch for their matches. */
interface KeptLines {
  readonly replaced: ReadonlySet<number>;
  readonly vouching: ReadonlySet<number>;
}

/** What each line of `side` keeps in `runs`. */
function keptLines(
  { lines, words }: DiffSide,
  runs: readonly Run[],
  which: "first" | "second",
): KeptLines {
  const tokens = new Map<number, number>();
  const worded = new Set<number>();
  lines.forEach((line, at) => {
    tokens.set(line, (tokens.get(line) ?? 0) + 1);
    if (words[at]) worded.add(line);
  });

  const kept = new Map<number, number>();
  const withWord = new Set<number>();
  for (const run of runs) {
    for (let at = run[which]; at < run[which] + run.length; at++) {
      const line = lines[at] as number;
      kept.set(line, (kept.get(line) ?? 0) + 1);
      if (words[at]) withWord.add(line);
    }
  }

  const replaced = new Set<number>();
  const vouching = new Set<number>();
  for (const [line, count] of tokens) {
    const twice = (kept.get(line) ?? 0) * 2;
    if (twice < count || (twice === count && !worded.has(line))) replaced.add(line);
    else if (withWord.has(line)) vouching.add(line);
  }
  return { replaced, vouching };
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
    const firstLine = first.lines[run.first] as number;
    const secondLine = second.lines[run.second] as number;
    const inFirstSea =
      first.kept.replaced.has(firstLine) &&
      !second.kept.vouching.has(secondLine) &&
      inSea(first.lines, run.first, run.length, {
        from: before ? before.first + before.length : 0,
        to: after ? after.first : first.lines.length,
      });
    const inSecondSea =
      second.kept.replaced.has(secondLine) &&
      !first.kept.vouching.has(firstLine) &&
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
