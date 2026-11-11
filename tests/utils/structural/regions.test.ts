import { createTwoFilesPatch } from "diff";
import { describe, expect, it } from "vitest";
import { type PrHunk, parsePrHunks } from "../../../utils/github/pr-diff";
import type { GrammarId } from "../../../utils/structural/grammar";
import { changedRegions } from "../../../utils/structural/regions";
import { readPair, regionsOf } from "../../fixtures/structural";

const hunk = (header: [number, number, number, number], ...lines: string[]): PrHunk => {
  const [oldStart, oldCount, newStart, newCount] = header;
  return { oldStart, oldCount, newStart, newCount, lines };
};

describe("changedRegions", () => {
  it.each([
    {
      name: "one replaced line",
      hunks: [hunk([1, 3, 1, 3], " a", "-b", "+B", " c")],
      regions: [{ oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 }],
    },
    {
      name: "two separate runs in one hunk",
      hunks: [hunk([1, 5, 1, 5], "-a", "+A", " b", " c", "-d", "+D", " e")],
      regions: [
        { oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 },
        { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 5 },
      ],
    },
    {
      name: "runs in two hunks",
      hunks: [hunk([2, 1, 2, 1], "-b", "+B"), hunk([10, 2, 10, 3], " j", "+x", " k")],
      regions: [
        { oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 },
        { oldStart: 11, oldEnd: 11, newStart: 11, newEnd: 12 },
      ],
    },
    {
      name: "a pure deletion",
      hunks: [hunk([3, 3, 3, 1], "-c", "-d", " e")],
      regions: [{ oldStart: 3, oldEnd: 5, newStart: 3, newEnd: 3 }],
    },
    {
      name: "a zero-count old side, numbering the line the change sits before",
      hunks: [hunk([5, 0, 6, 2], "+x", "+y")],
      regions: [{ oldStart: 6, oldEnd: 6, newStart: 6, newEnd: 8 }],
    },
    {
      name: "a no-newline marker",
      hunks: [hunk([1, 1, 1, 1], "-a", "\\ No newline at end of file", "+a")],
      regions: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 }],
    },
  ])("reads $name", ({ hunks, regions }) => {
    expect(changedRegions(hunks)).toEqual(regions);
  });

  it("gives undefined when a hunk's body cannot be read", () => {
    expect(changedRegions([hunk([1, 1, 1, 1], "?a")])).toBeUndefined();
  });

  const pairs: [GrammarId, string][] = (
    ["typescript", "tsx", "javascript", "python"] as const
  ).flatMap((grammar) =>
    ["added-argument", "parse-error", "reindent", "rename", "rewrap"].map(
      (name): [GrammarId, string] => [grammar, name],
    ),
  );
  pairs.push(["python", "moved-out-of-block"]);

  it.each(pairs)("agrees with diffLines on %s %s", (grammar, name) => {
    const { oldText, newText } = readPair(grammar, name);
    const patch = createTwoFilesPatch("a", "b", oldText, newText, "", "", { context: 3 });
    const hunks = parsePrHunks(patch.slice(patch.indexOf("@@")));

    expect(changedRegions(hunks)).toEqual(regionsOf(oldText, newText));
  });
});
