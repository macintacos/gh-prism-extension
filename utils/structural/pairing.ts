import type { LineMatch } from "./changes";

/** One row of a re-paired block: an old line, a new line, or both. */
export interface PairedRow {
  readonly old?: number;
  readonly new?: number;
}

/** Fewest matched tokens two lines must share to count as a match. */
export const MIN_SHARED_TOKENS = 2;

/** ponytail: O(olds × news) table per block; past this the block keeps GitHub's pairing. */
export const MAX_PAIRING_CELLS = 10_000;

/** Most rows a re-paired block may add beyond GitHub's own `githubRows`. */
export function maxAddedRows(githubRows: number): number {
  return Math.max(2, Math.floor(githubRows / 2));
}

/**
 * The rows a changed block should show, or undefined when it keeps
 * GitHub's own pairing.
 *
 * @remarks Pairs the order-preserving set of matches with the largest
 * total count; ties go to the pairing whose first differing pair has the
 * smaller old line, then the smaller new line.
 */
export function pairedRows(
  olds: readonly number[],
  news: readonly number[],
  matches: readonly LineMatch[],
): readonly PairedRow[] | undefined {
  if (olds.length === 0 || news.length === 0 || olds.length * news.length > MAX_PAIRING_CELLS)
    return undefined;

  const weights = weightTable(olds, news, matches);
  const pairs = bestPairs(weights, olds.length, news.length);
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

/** `weights[i][j]`: tokens olds[i] shares with news[j], or 0 below MIN_SHARED_TOKENS. */
function weightTable(
  olds: readonly number[],
  news: readonly number[],
  matches: readonly LineMatch[],
): number[][] {
  const weights = olds.map(() => news.map(() => 0));
  const oldIndex = new Map(olds.map((line, i) => [line, i]));
  const newIndex = new Map(news.map((line, j) => [line, j]));

  for (const { old, new: newLine, count } of matches) {
    const i = oldIndex.get(old);
    const j = newIndex.get(newLine);
    const row = i === undefined ? undefined : weights[i];
    if (row === undefined || j === undefined || count < MIN_SHARED_TOKENS) continue;
    row[j] = Math.max(row[j] ?? 0, count);
  }
  return weights;
}

/** Index pairs of the heaviest order-preserving pairing, lexicographically smallest on ties. */
function bestPairs(
  weights: readonly (readonly number[])[],
  n: number,
  m: number,
): [number, number][] {
  // best[i][j]: the largest total reachable from olds[i..] and news[j..].
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const at = (i: number, j: number) => best[i]?.[j] ?? 0;
  const weight = (i: number, j: number) => weights[i]?.[j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const paired = weight(i, j) > 0 ? weight(i, j) + at(i + 1, j + 1) : 0;
      (best[i] as number[])[j] = Math.max(paired, at(i + 1, j), at(i, j + 1));
    }
  }

  const pairs: [number, number][] = [];
  let [i, j] = [0, 0];
  while (at(i, j) > 0) {
    const next = firstPairOnBestPath(i, j, n, m, weight, at);
    pairs.push(next);
    [i, j] = [next[0] + 1, next[1] + 1];
  }
  return pairs;
}

/** The smallest (old, new) pair from (i, j) on that still reaches the best total. */
function firstPairOnBestPath(
  i: number,
  j: number,
  n: number,
  m: number,
  weight: (i: number, j: number) => number,
  at: (i: number, j: number) => number,
): [number, number] {
  for (let a = i; a < n; a++) {
    for (let b = j; b < m; b++) {
      if (weight(a, b) > 0 && weight(a, b) + at(a + 1, b + 1) === at(i, j)) return [a, b];
    }
  }
  throw new Error("a positive best total has a pair on its path");
}

/** Rows in file order: pairs share a row; between pairs, unpaired old lines come before unpaired new lines. */
function rowsOf(
  olds: readonly number[],
  news: readonly number[],
  pairs: readonly [number, number][],
): PairedRow[] {
  const rows: PairedRow[] = [];
  let [i, j] = [0, 0];
  for (const [a, b] of [...pairs, [olds.length, news.length] as const]) {
    for (; i < a; i++) rows.push({ old: olds[i] });
    for (; j < b; j++) rows.push({ new: news[j] });
    if (a < olds.length && b < news.length) rows.push({ old: olds[a], new: news[b] });
    [i, j] = [a + 1, b + 1];
  }
  return rows;
}
