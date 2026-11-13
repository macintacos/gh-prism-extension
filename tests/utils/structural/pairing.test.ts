import { describe, expect, it } from "vitest";
import type { LineMatch } from "../../../utils/structural/changes";
import {
  MAX_PAIRING_CELLS,
  MIN_SHARED_TOKENS,
  maxAddedRows,
  pairedRows,
} from "../../../utils/structural/pairing";

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
const match = (
  old: number,
  new_: number,
  count = MIN_SHARED_TOKENS,
  shorter = count,
): LineMatch => ({
  old,
  new: new_,
  count,
  shorter,
});

describe("a changed block whose lines face unrelated lines", () => {
  it("moves each line opposite the line it shares tokens with", () => {
    expect(pairedRows([120, 121], [138], [match(121, 138, 4)])).toEqual([
      { old: 120 },
      { old: 121, new: 138 },
    ]);
  });

  it("lays unpaired lines after a pair side by side from the top", () => {
    expect(pairedRows([1, 2, 3], [10, 11, 12, 13], [match(1, 11)])).toEqual([
      { new: 10 },
      { old: 1, new: 11 },
      { old: 2, new: 12 },
      { old: 3, new: 13 },
    ]);
  });

  it("ends unpaired lines before the first pair against it, the longer side's extras first", () => {
    expect(pairedRows([1, 2, 3], [10, 11], [match(3, 11)])).toEqual([
      { old: 1 },
      { old: 2, new: 10 },
      { old: 3, new: 11 },
    ]);
  });

  it("lays unpaired lines between two pairs side by side", () => {
    expect(pairedRows([1, 2, 3, 4], [10, 11, 12], [match(1, 10), match(4, 12)])).toEqual([
      { old: 1, new: 10 },
      { old: 2, new: 11 },
      { old: 3 },
      { old: 4, new: 12 },
    ]);
  });

  it("ignores matches naming lines outside the block", () => {
    const matches = [match(121, 138, 4), match(122, 138, 9), match(121, 140, 9)];
    expect(pairedRows([120, 121], [138], matches)).toEqual([{ old: 120 }, { old: 121, new: 138 }]);
  });
});

describe("matches that cannot all hold", () => {
  it("keeps file order and the largest total when matches cross", () => {
    const matches = [match(1, 12, 5), match(2, 10, 3), match(3, 11, 3)];
    expect(pairedRows([1, 2, 3], [10, 11, 12], matches)).toEqual([
      { old: 1 },
      { old: 2, new: 10 },
      { old: 3, new: 11 },
      { new: 12 },
    ]);
  });

  it("gives a line wanted by two lines to the one sharing more tokens", () => {
    expect(pairedRows([1, 2], [10], [match(1, 10, 2, 5), match(2, 10, 4)])).toEqual([
      { old: 1 },
      { old: 2, new: 10 },
    ]);
  });

  it("breaks a tie toward the pairing whose first pair has the smaller old line", () => {
    const matches = [match(2, 10, 3), match(1, 11, 3)];
    const rows = pairedRows([1, 2], [10, 11], matches);

    expect(rows).toEqual([{ new: 10 }, { old: 1, new: 11 }, { old: 2 }]);
    expect(pairedRows([1, 2], [10, 11], matches.toReversed())).toEqual(rows);
  });

  it("breaks a tie on the old line toward the smaller new line", () => {
    expect(pairedRows([0, 1], [10, 11], [match(1, 11, 3), match(1, 10, 3)])).toEqual([
      { old: 0 },
      { old: 1, new: 10 },
      { new: 11 },
    ]);
  });
});

describe("a line split across several lines", () => {
  it("sits beside the first of them though a later one shares more", () => {
    const rustSignature = [
      match(2, 10, 4, 5),
      match(2, 11, 4, 5),
      match(2, 12, 4, 5),
      match(2, 13, 4, 5),
      match(2, 14, 5, 5),
    ];
    expect(pairedRows([1, 2], range(10, 5), rustSignature)).toEqual([
      { old: 1 },
      { old: 2, new: 10 },
      { new: 11 },
      { new: 12 },
      { new: 13 },
      { new: 14 },
    ]);
  });

  it("joined from several old lines sits beside the first of them", () => {
    expect(
      pairedRows(range(1, 3), [9, 10], [match(1, 10, 3), match(2, 10, 3), match(3, 10, 4)]),
    ).toEqual([{ new: 9 }, { old: 1, new: 10 }, { old: 2 }, { old: 3 }]);
  });

  it("does not move past the pair before it", () => {
    const matches = [match(1, 10, 4), match(3, 10, 3), match(3, 11, 2), match(3, 12, 4)];
    expect(pairedRows([1, 2, 3], [10, 11, 12], matches)).toEqual([
      { old: 1, new: 10 },
      { old: 2 },
      { old: 3, new: 11 },
      { new: 12 },
    ]);
  });

  it("does not move onto a line sharing less than half its own tokens", () => {
    expect(pairedRows([2], [10, 11], [match(2, 10, 2, 5), match(2, 11, 4)])).toEqual([
      { new: 10 },
      { old: 2, new: 11 },
    ]);
  });
});

describe("a match", () => {
  it("needs at least MIN_SHARED_TOKENS shared tokens", () => {
    expect(pairedRows([120, 121], [138], [match(121, 138, MIN_SHARED_TOKENS - 1)])).toBeUndefined();
    expect(pairedRows([120, 121], [138], [match(121, 138, MIN_SHARED_TOKENS)])).toEqual([
      { old: 120 },
      { old: 121, new: 138 },
    ]);
  });

  it("needs at least half the shorter line's tokens", () => {
    expect(pairedRows([120, 121], [138], [match(121, 138, 3, 7)])).toBeUndefined();
    expect(pairedRows([120, 121], [138], [match(121, 138, 3, 6)])).toEqual([
      { old: 120 },
      { old: 121, new: 138 },
    ]);
  });
});

describe("a block that keeps GitHub's pairing", () => {
  it("has lines on one side only", () => {
    expect(pairedRows([1, 2], [], [])).toBeUndefined();
    expect(pairedRows([], [1, 2], [])).toBeUndefined();
  });

  it("has no match", () => {
    expect(pairedRows([1, 2], [10], [])).toBeUndefined();
  });

  it("would re-pair to GitHub's own rows", () => {
    expect(pairedRows([1, 2], [10, 11], [match(1, 10), match(2, 11)])).toBeUndefined();
  });

  it("would add more rows than maxAddedRows allows", () => {
    const olds = range(1, 10);
    const allowed = maxAddedRows(olds.length);
    const lastToFirst = [match(10, 100)];

    expect(pairedRows(olds, range(100, allowed + 1), lastToFirst)).toHaveLength(
      olds.length + allowed,
    );
    expect(pairedRows(olds, range(100, allowed + 2), lastToFirst)).toBeUndefined();
  });

  it("holds more than MAX_PAIRING_CELLS line pairs", () => {
    const olds = range(1, 100);
    const news = range(1000, MAX_PAIRING_CELLS / 100 + 1);
    const shiftedByOne = olds.slice(1).map((old, i) => match(old, news[i] ?? 0));

    expect(pairedRows(olds, news.slice(0, -1), shiftedByOne)).toBeDefined();
    expect(pairedRows(olds, news, shiftedByOne)).toBeUndefined();
  });
});
