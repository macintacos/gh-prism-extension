import { describe, expect, it } from "vitest";
import type { LineAnnotation, StructuralFile } from "../../../utils/structural/changes";
import { movedLines } from "../../../utils/structural/moved";

const CHANGED: LineAnnotation = { quiet: false, ranges: [] };
const QUIET: LineAnnotation = { quiet: true };

type Line = readonly [number, string, LineAnnotation?];

/** A file from `[line, text, annotation?]` triples per side; lines are changed unless said quiet. */
const fileOf = (old: readonly Line[], added: readonly Line[]): StructuralFile => {
  const side = (lines: readonly Line[]) => ({
    text: Object.fromEntries(lines.map(([line, text]) => [line, text])),
    annotations: Object.fromEntries(lines.map(([line, , note]) => [line, note ?? CHANGED])),
  });
  const before = side(old);
  const after = side(added);

  return {
    annotations: { old: before.annotations, new: after.annotations },
    text: { old: before.text, new: after.text },
  };
};

const NONE = { old: new Set(), new: new Set() };

describe("movedLines", () => {
  it("pairs a removed line with an added line of the same trimmed text", () => {
    const file = fileOf([[1, "a()"]], [[2, "    a()"]]);

    expect(movedLines(file)).toEqual({ old: new Set([1]), new: new Set([2]) });
  });

  it("does not call a blank line moved", () => {
    const file = fileOf([[1, ""]], [[2, "  "]]);

    expect(movedLines(file)).toEqual(NONE);
  });

  it("does not call a quiet line moved", () => {
    const bothQuiet = fileOf([[1, "a()", QUIET]], [[1, "  a()", QUIET]]);
    const oldQuiet = fileOf([[1, "a()", QUIET]], [[2, "a()"]]);
    const newQuiet = fileOf([[1, "a()"]], [[2, "a()", QUIET]]);

    expect(movedLines(bothQuiet)).toEqual(NONE);
    expect(movedLines(oldQuiet)).toEqual(NONE);
    expect(movedLines(newQuiet)).toEqual(NONE);
  });

  it("pairs a repeated line once per copy, in line order", () => {
    const file = fileOf(
      [
        [1, "}"],
        [2, "}"],
        [3, "}"],
      ],
      [[9, "}"]],
    );

    expect(movedLines(file)).toEqual({ old: new Set([1]), new: new Set([9]) });
  });

  it("leaves a line with no partner unmarked", () => {
    const file = fileOf([[1, "a()"]], [[2, "b()"]]);

    expect(movedLines(file)).toEqual(NONE);
  });

  it("takes line order from the line numbers, not from key insertion order", () => {
    const file = fileOf(
      [
        [3, "}"],
        [1, "}"],
      ],
      [[9, "}"]],
    );

    expect(movedLines(file).old).toEqual(new Set([1]));
  });
});
