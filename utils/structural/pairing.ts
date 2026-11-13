import type { LineMatch } from "./changes";

/** One row of a re-paired block: an old line, a new line, or both. */
export interface PairedRow {
  readonly old?: number;
  readonly new?: number;
}

/** Fewest matched tokens two lines must share to count as a match. */
export const MIN_SHARED_TOKENS = 2;

/** Least share of the shorter line's tokens two lines must share to count as a match. */
export const MIN_SHARED_FRACTION = 0.5;

// ponytail: O(olds × news) table per block; past this the block keeps GitHub's pairing.
/** Most old × new line pairs one block may hold. */
export const MAX_PAIRING_CELLS = 10_000;

/** Most rows a re-paired block may add beyond GitHub's own `githubRows`. */
export function maxAddedRows(githubRows: number): number {
  return Math.max(2, Math.floor(githubRows / 2));
}

/**
 * The rows a changed block should show, or undefined when it keeps GitHub's own pairing.
 *
 * @remarks Two lines match when they share at least MIN_SHARED_TOKENS tokens and
 * MIN_SHARED_FRACTION of the shorter line's tokens. Pairs the order-preserving set of matches
 * with the largest total count; ties go to the pairing whose first differing pair has the
 * smaller old line, then the smaller new line. Each pair then moves up to the first line of a
 * split or join it heads, and unpaired lines share rows as `rowsOf` lays them.
 */
export function pairedRows(
  olds: readonly number[],
  news: readonly number[],
  matches: readonly LineMatch[],
): readonly PairedRow[] | undefined {
  if (olds.length === 0 || news.length === 0 || olds.length * news.length > MAX_PAIRING_CELLS)
    return undefined;

  const weights = weightTable(olds, news, matches);
  const pairs = splitStarts(weights, bestPairs(weights, olds.length, news.length));
  if (pairs.length === 0) return undefined;
  const rows = rowsOf(olds, news, pairs);

  const githubRows = Math.max(olds.length, news.length);
  if (rows.length - githubRows > maxAddedRows(githubRows)) return undefined;
  if (
    rows.length === githubRows &&
    rows.every((row, i) => row.old === olds[i] && row.new === news[i])
  ) {
    return undefined;
  }
  return rows;
}

/** Whether a match shares enough tokens to pair its two lines. */
function pairs({ count, shorter }: LineMatch): boolean {
  return count >= MIN_SHARED_TOKENS && count >= shorter * MIN_SHARED_FRACTION;
}

/** `weights[i][j]`: tokens olds[i] shares with news[j], or 0 when the two do not pair. */
function weightTable(
  olds: readonly number[],
  news: readonly number[],
  matches: readonly LineMatch[],
): number[][] {
  const weights = olds.map(() => news.map(() => 0));
  const oldIndex = new Map(olds.map((line, i) => [line, i]));
  const newIndex = new Map(news.map((line, j) => [line, j]));

  for (const match of matches) {
    const i = oldIndex.get(match.old);
    const j = newIndex.get(match.new);
    const row = i === undefined ? undefined : weights[i];
    if (row === undefined || j === undefined || !pairs(match)) continue;
    row[j] = Math.max(row[j] ?? 0, match.count);
  }
  return weights;
}

/** Index pairs of the heaviest order-preserving pairing, lexicographically smallest on ties. */
function bestPairs(
  weights: readonly (readonly number[])[],
  oldCount: number,
  newCount: number,
): [number, number][] {
  // best[i][j]: the largest total reachable from olds[i..] and news[j..].
  const best = Array.from({ length: oldCount + 1 }, () => new Array<number>(newCount + 1).fill(0));
  const at = (i: number, j: number) => best[i]?.[j] ?? 0;
  const weight = (i: number, j: number) => weights[i]?.[j] ?? 0;
  for (let i = oldCount - 1; i >= 0; i--) {
    const row = best[i];
    if (!row) continue;
    for (let j = newCount - 1; j >= 0; j--) {
      const paired = weight(i, j) > 0 ? weight(i, j) + at(i + 1, j + 1) : 0;
      row[j] = Math.max(paired, at(i + 1, j), at(i, j + 1));
    }
  }

  /**
   * The smallest (old, new) pair from (i, j) on that still reaches the best total. Each call
   * starts past the previous pair, so the scans across all calls stay linear in the table.
   */
  const firstPairOnBestPath = (i: number, j: number): [number, number] => {
    for (let a = i; a < oldCount; a++) {
      for (let b = j; b < newCount; b++) {
        if (weight(a, b) > 0 && weight(a, b) + at(a + 1, b + 1) === at(i, j)) return [a, b];
      }
    }
    throw new Error("a positive best total has a pair on its path");
  };

  const pairs: [number, number][] = [];
  let [i, j] = [0, 0];
  while (at(i, j) > 0) {
    const next = firstPairOnBestPath(i, j);
    pairs.push(next);
    [i, j] = [next[0] + 1, next[1] + 1];
  }
  return pairs;
}

/**
 * `pairs` with each moved up to the first line of the split or join it heads: onto the unpaired
 * line just above it that also pairs with its other line, on the new side or else the old side.
 */
function splitStarts(
  weights: readonly (readonly number[])[],
  pairs: readonly [number, number][],
): [number, number][] {
  const pairsWith = (i: number, j: number) => (weights[i]?.[j] ?? 0) > 0;
  let [lastOld, lastNew] = [-1, -1];
  return pairs.map(([i, j]): [number, number] => {
    let [a, b] = [i, j];
    while (b - 1 > lastNew && pairsWith(a, b - 1)) b--;
    if (b === j) while (a - 1 > lastOld && pairsWith(a - 1, b)) a--;
    [lastOld, lastNew] = [a, b];
    return [a, b];
  });
}

/**
 * Rows in file order: pairs share a row, and between them unpaired old and new lines share rows,
 * the longer side running on alone. Before the first pair they end at it, so the longer side's
 * extra lines come first; after a pair they fill from the top.
 */
function rowsOf(
  olds: readonly number[],
  news: readonly number[],
  pairs: readonly [number, number][],
): PairedRow[] {
  const rows: PairedRow[] = [];
  let [i, j] = [0, 0];
  // A sentinel past both ends flushes the lines after the last pair.
  for (const [a, b] of [...pairs, [olds.length, news.length] as const]) {
    const gap = sideBySide(olds.slice(i, a), news.slice(j, b));
    rows.push(...(rows.length === 0 && a < olds.length ? gap.alignedToEnd : gap.alignedToStart));
    if (a < olds.length && b < news.length) rows.push({ old: olds[a], new: news[b] });
    [i, j] = [a + 1, b + 1];
  }
  return rows;
}

/** Unpaired old and new lines one of each per row, aligned to the start or to the end. */
function sideBySide(olds: readonly number[], news: readonly number[]) {
  const length = Math.max(olds.length, news.length);
  const row = (old: number | undefined, line: number | undefined): PairedRow => ({
    ...(old === undefined ? {} : { old }),
    ...(line === undefined ? {} : { new: line }),
  });
  const extraOlds = length - olds.length;
  const extraNews = length - news.length;
  return {
    alignedToStart: Array.from({ length }, (_, k) => row(olds[k], news[k])),
    alignedToEnd: Array.from({ length }, (_, k) => row(olds[k - extraOlds], news[k - extraNews])),
  };
}
