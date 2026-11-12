import { describe, expect, it } from "vitest";
import { type Spacing, wordTokens } from "../../../utils/structural/words";

const keys = (text: string, spacing: Spacing) =>
  wordTokens(text, { start: 0, end: text.length }, "text", spacing).map((token) => token.key);

describe("wordTokens", () => {
  it("gives each word and each other character its own token", () => {
    expect(keys("copies that  group,\n divider (x_1).", "ignored")).toEqual([
      "copies",
      "that",
      "group",
      ",",
      "divider",
      "(",
      "x_1",
      ")",
      ".",
    ]);
  });

  it("keeps an apostrophe inside a word", () => {
    expect(keys("that menu's 'own' don’t", "ignored")).toEqual([
      "that",
      "menu's",
      "'",
      "own",
      "'",
      "don’t",
    ]);
  });

  it("keeps an astral character whole", () => {
    expect(keys("a 😀 b", "ignored")).toEqual(["a", "😀", "b"]);
  });

  it("places each token at its word, within the given range", () => {
    const text = "skip one  two skip";

    const tokens = wordTokens(text, { start: 5, end: 13 }, "comment", "exact");

    expect(tokens).toEqual([
      { start: 5, end: 8, key: "one", type: "comment" },
      { start: 10, end: 13, key: "  two", type: "comment" },
    ]);
  });

  it("keys a word with the exact spacing around it", () => {
    expect(keys(" a  b,\n c ", "exact")).toEqual([" a", "  b", ",", "\n c "]);
  });

  it("keys a word with one space for any spacing around it", () => {
    expect(keys(" a  b,\n c ", "collapsed")).toEqual([" a", " b", ",", " c "]);
  });

  it.each(["exact", "collapsed"] as const)(
    "gives spacing with no word one token when spacing is %s",
    (spacing) => {
      const text = "  ";

      expect(wordTokens(text, { start: 0, end: 2 }, "text", spacing)).toEqual([
        { start: 0, end: 2, key: spacing === "exact" ? "  " : " ", type: "text" },
      ]);
    },
  );

  it("gives ignored spacing with no word no token", () => {
    expect(keys(" \n ", "ignored")).toEqual([]);
  });
});
