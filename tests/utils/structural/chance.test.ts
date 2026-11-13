import { describe, expect, it } from "vitest";
import {
  type DiffSide,
  rematchedOnLines,
  withoutChanceMatches,
} from "../../../utils/structural/chance";

const KEYWORDS = new Set(["if", "return", "const"]);

/**
 * A side from `tokens`, each `[line, text]`; a token is a word when its text has a letter, and a
 * name when that word is not one of {@link KEYWORDS}.
 */
const sideOf = (...tokens: readonly (readonly [number, string])[]): DiffSide => ({
  lines: tokens.map(([line]) => line),
  words: tokens.map(([, text]) => /\w/.test(text)),
  names: tokens.map(([, text]) => /\w/.test(text) && !KEYWORDS.has(text)),
});

/** A side's lines and keys from `tokens`, each `[line, key]`. */
const keyedOf = (...tokens: readonly (readonly [number, string])[]) => ({
  lines: tokens.map(([line]) => line),
  keys: tokens.map(([, key]) => key),
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
    {
      name: "drops a replaced line's match with a line that keeps only a keyword",
      matches: [0, -1, -1, -1],
      first: sideOf([0, "if"], [0, "a"], [0, "b"], [0, "c"]),
      second: sideOf([0, "if"], [0, "("]),
      expected: [-1, -1, -1, -1],
    },
    {
      name: "drops a replaced line's match with a line whose main partner is another line",
      matches: [0, 4, 5],
      first: sideOf([0, "a"], [0, "b"], [0, "c"]),
      second: sideOf([0, "a"], [0, "x"], [0, "y"], [0, "z"], [1, "b"], [1, "c"]),
      expected: [-1, 4, 5],
    },
    {
      name: "drops the matches of a line that the dropped matches leave replaced",
      matches: [0, 3, 4, -1, -1, 5, 6, 7],
      first: sideOf([0, "a"], [0, "b"], [0, "c"], [0, "n"], [0, "m"], [1, "e"], [1, "f"], [1, "h"]),
      second: sideOf(
        [0, "a"],
        [0, "x"],
        [0, "y"],
        [1, "b"],
        [1, "c"],
        [1, "e"],
        [1, "f"],
        [1, "h"],
      ),
      expected: [-1, -1, -1, -1, -1, 5, 6, 7],
    },
    {
      name: "keeps the keyword and punctuation two lines that differ by a name share",
      matches: [0, -1, 2],
      first: sideOf([0, "return"], [0, "x"], [0, ";"]),
      second: sideOf([0, "return"], [0, "y"], [0, ";"]),
      expected: [0, -1, 2],
    },
    {
      name: "keeps a short line's matches when it survives whole inside a long replaced line",
      matches: [4, 5, 6, 7],
      first: sideOf([0, "f"], [0, "("], [0, "x"], [0, ")"]),
      second: sideOf(
        [0, "p"],
        [0, "q"],
        [0, "r"],
        [0, "s"],
        [0, "f"],
        [0, "("],
        [0, "x"],
        [0, ")"],
        [0, "t"],
        [0, "u"],
        [0, "v"],
        [0, "w"],
        [0, "y"],
      ),
      expected: [4, 5, 6, 7],
    },
    {
      name: "keeps a re-wrapped line's matches on the two lines its words land on",
      matches: [0, 1, 2, 4, 5, 6],
      first: sideOf([0, "a"], [0, "b"], [0, "c"], [0, "d"], [0, "e"], [0, "f"]),
      second: sideOf([0, "a"], [0, "b"], [0, "c"], [0, "g"], [1, "d"], [1, "e"], [1, "f"]),
      expected: [0, 1, 2, 4, 5, 6],
    },
  ])("$name", ({ matches, first, second, expected }) => {
    expect(withoutChanceMatches(matches, first, second)).toEqual(expected);
  });
});

describe("rematchedOnLines", () => {
  it.each<{
    name: string;
    matches: number[];
    first: ReturnType<typeof keyedOf>;
    second: ReturnType<typeof keyedOf>;
    expected: number[];
  }>([
    {
      name: "matches the equal tokens that open a matched token's line pair",
      matches: [-1, -1, -1, -1, 4],
      first: keyedOf([0, "test"], [0, "("], [0, '"'], [0, "a"], [0, "b"]),
      second: keyedOf([0, "test"], [0, "("], [0, '"'], [0, "c"], [0, "b"]),
      expected: [0, 1, 2, -1, 4],
    },
    {
      name: "matches the equal tokens that close a matched token's line pair",
      matches: [0, -1, -1],
      first: keyedOf([0, "b"], [0, "q"], [0, ")"]),
      second: keyedOf([0, "b"], [0, "r"], [0, ")"]),
      expected: [0, -1, 2],
    },
    {
      name: "matches nothing on a line other than the matched token's",
      matches: [-1, 1],
      first: keyedOf([0, "x"], [1, "b"]),
      second: keyedOf([0, "x"], [1, "b"]),
      expected: [-1, 1],
    },
  ])("$name", ({ matches, first, second, expected }) => {
    expect(rematchedOnLines(matches, first, second)).toEqual(expected);
  });
});
