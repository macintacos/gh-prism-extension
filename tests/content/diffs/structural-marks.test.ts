import { describe, expect, it } from "vitest";
import { lineBoxes, markRanges, maskOf } from "../../../entrypoints/content/diffs/structural-marks";

/** The ranges of `tokens` in `text`, each found after the one before it. */
function rangesOf(text: string, ...tokens: string[]) {
  let from = 0;
  return tokens.map((token) => {
    const startCol = text.indexOf(token, from);
    if (startCol < 0) throw new Error(`no ${token}`);
    from = startCol + token.length;
    return { startCol, endCol: from };
  });
}

const textsOf = (text: string, ranges: readonly { startCol: number; endCol: number }[]) =>
  ranges.map(({ startCol, endCol }) => text.slice(startCol, endCol));

describe("markRanges", () => {
  it.each([
    ["tokens a space apart", "  return a + b - c;", ["a", "+", "b"], ["a + b"]],
    ["tokens that touch", "  call(first, second);", ["first", ",", "second"], ["first, second"]],
    ["tokens a tab apart", "x\ty = 1;", ["x", "y"], ["x\ty"]],
  ])("joins %s into one mark", (_, text, tokens, want) => {
    expect(textsOf(text, markRanges(text, rangesOf(text, ...tokens)))).toEqual(want);
  });

  it("marks a line changed in full when it changed inside a unit that remains", () => {
    const text = "  ENGINE_GLOBAL,";

    const marks = markRanges(text, rangesOf(text, "ENGINE_GLOBAL", ","), "mark");

    expect(textsOf(text, marks)).toEqual(["ENGINE_GLOBAL,"]);
  });

  it("joins ranges that overlap into one mark", () => {
    const text = "  abcdef;";

    const marks = markRanges(text, [
      { startCol: 2, endCol: 6 },
      { startCol: 4, endCol: 8 },
    ]);

    expect(textsOf(text, marks)).toEqual(["abcdef"]);
  });

  it("keeps marks apart across a token that didn't change", () => {
    const text = "  const total = sum(a, b);";

    const marks = markRanges(text, rangesOf(text, "total", "sum", "b"));

    expect(textsOf(text, marks)).toEqual(["total", "sum", "b"]);
  });

  it.each([
    [
      "every token changed",
      "    const changed = cells();",
      ["const", "changed", "=", "cells", "(", ")", ";"],
    ],
    ["one range covers the code", "\tdone();  ", ["done();"]],
  ])("gives a line no mark when %s", (_, text, tokens) => {
    expect(markRanges(text, rangesOf(text, ...tokens))).toEqual([]);
  });

  it("marks a line whose last token alone didn't change", () => {
    const text = "  call(first);";

    const marks = markRanges(text, rangesOf(text, "call", "(", "first", ")"));

    expect(textsOf(text, marks)).toEqual(["call(first)"]);
  });

  it("drops an empty, an inverted, and an overrunning range", () => {
    const text = "ab cd;";

    const marks = markRanges(text, [
      { startCol: 1, endCol: 1 },
      { startCol: 2, endCol: 1 },
      { startCol: -1, endCol: 2 },
      { startCol: 3, endCol: 5 },
      { startCol: 0, endCol: 99 },
    ]);

    expect(textsOf(text, marks)).toEqual(["cd"]);
  });
});

const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe("lineBoxes", () => {
  it("joins one line's rects, one per syntax span, into one box from the origin", () => {
    const boxes = lineBoxes({ left: 100, top: 50 }, [
      rect(110, 54, 130, 66),
      rect(130, 54, 137, 66),
      rect(137, 54, 160, 66),
    ]);

    expect(boxes).toEqual([{ x: 10, y: 4, width: 50, height: 12 }]);
  });

  it("gives a mark that wraps one box per visual line", () => {
    const boxes = lineBoxes({ left: 0, top: 0 }, [rect(200, 4, 300, 16), rect(0, 24, 40, 36)]);

    expect(boxes).toEqual([
      { x: 200, y: 4, width: 100, height: 12 },
      { x: 0, y: 24, width: 40, height: 12 },
    ]);
  });

  it("skips a rect with no width", () => {
    expect(lineBoxes({ left: 0, top: 0 }, [rect(8, 4, 8, 16)])).toEqual([]);
  });
});

/** The `x y width height rx` of each rect in `mask`'s image. */
function rectsIn(mask: string | undefined): number[][] {
  const svg = decodeURIComponent(
    /^url\("data:image\/svg\+xml,(.*)"\)$/.exec(mask ?? "")?.[1] ?? "",
  );
  return [
    ...svg.matchAll(/<rect x='(.+?)' y='(.+?)' width='(.+?)' height='(.+?)' rx='(.+?)'\/>/g),
  ].map((match) => match.slice(1).map(Number));
}

describe("maskOf", () => {
  it("draws each box 2px larger on every side, with a 3px corner", () => {
    const mask = maskOf([
      { x: 10, y: 4, width: 50, height: 12 },
      { x: 80, y: 24, width: 7, height: 12 },
    ]);

    expect(rectsIn(mask)).toEqual([
      [8, 2, 54, 16, 3],
      [78, 22, 11, 16, 3],
    ]);
  });

  it("keeps a box at the text's first column inside the text's box", () => {
    expect(rectsIn(maskOf([{ x: 0, y: 4, width: 20, height: 12 }]))).toEqual([[0, 2, 22, 16, 3]]);
  });

  it("sizes its image to reach the last box's far corner", () => {
    const mask = maskOf([{ x: 10, y: 24, width: 50, height: 12 }]);

    expect(decodeURIComponent(mask ?? "")).toContain("width='62' height='38'");
  });

  it("is undefined for no boxes", () => {
    expect(maskOf([])).toBeUndefined();
  });
});
