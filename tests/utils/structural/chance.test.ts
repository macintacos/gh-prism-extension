import { describe, expect, it } from "vitest";
import { type DiffSide, withoutChanceMatches } from "../../../utils/structural/chance";

/** A side from `tokens`, each `[line, text]`; a token is a word when its text has a letter. */
const sideOf = (...tokens: readonly (readonly [number, string])[]): DiffSide => ({
  lines: tokens.map(([line]) => line),
  words: tokens.map(([, text]) => /\w/.test(text)),
});

describe("withoutChanceMatches", () => {
  it.each<{
    name: string;
    matches: number[];
    first: DiffSide;
    second: DiffSide;
    expected: number[];
  }>([
    {
      name: "keeps a match on a line with a word that keeps half its tokens",
      matches: [0, -1],
      first: sideOf([0, "a"], [0, "b"]),
      second: sideOf([0, "a"], [0, "c"]),
      expected: [0, -1],
    },
    {
      name: "drops a match between punctuation-only lines that keep half their tokens",
      matches: [0, -1],
      first: sideOf([0, "("], [0, ")"]),
      second: sideOf([0, "("], [0, "]"]),
      expected: [-1, -1],
    },
    {
      name: "drops a match between lines that keep less than half their tokens",
      matches: [0, -1, -1],
      first: sideOf([0, "x"], [0, "y"], [0, "z"]),
      second: sideOf([0, "x"], [0, "p"], [0, "q"]),
      expected: [-1, -1, -1],
    },
    {
      name: "drops a match with changes on both sides of it on a replaced line",
      matches: [-1, -1, 0, -1, -1],
      first: sideOf([0, "p"], [0, "q"], [0, ","], [0, "r"], [0, "s"]),
      second: sideOf([0, ","]),
      expected: [-1, -1, -1, -1, -1],
    },
    {
      name: "keeps such a match when its line on the other side vouches for it",
      matches: [-1, -1, 0, -1, -1, 1],
      first: sideOf([0, "p"], [0, "q"], [0, ","], [0, "r"], [0, "s"], [1, "k"]),
      second: sideOf([0, ","], [0, "k"]),
      expected: [-1, -1, 0, -1, -1, 1],
    },
  ])("$name", ({ matches, first, second, expected }) => {
    expect(withoutChanceMatches(matches, first, second)).toEqual(expected);
  });
});
