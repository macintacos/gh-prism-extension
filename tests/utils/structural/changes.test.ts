import { describe, expect, it } from "vitest";
import { parsePrHunks } from "../../../utils/github/pr-diff";
import { annotateLines, type StructuralChanges } from "../../../utils/structural/changes";
import { lines } from "../../fixtures/head-scan";

const RENAME = lines(
  "@@ -1,3 +1,3 @@",
  " function f() {",
  "-  return count;",
  "+  return total;",
  " }",
);
const RENAMED = {
  quiet: false,
  ranges: [{ startCol: 9, endCol: 14 }],
} as const;
const QUIET = { quiet: true } as const;

describe("annotateLines", () => {
  it.each<{
    name: string;
    patch: string;
    changes: StructuralChanges;
    expected: unknown;
  }>([
    {
      name: "a reindented block gives quiet rows",
      patch: lines("@@ -10,3 +10,3 @@", " if (a) {", "-b();", "+  b();", " }"),
      changes: { old: [], new: [] },
      expected: { old: { 11: QUIET }, new: { 11: QUIET } },
    },
    {
      name: "a renamed identifier gives only that token's range",
      patch: RENAME,
      changes: {
        old: [{ line: 2, startCol: 9, endCol: 14 }],
        new: [{ line: 2, startCol: 9, endCol: 14 }],
      },
      expected: { old: { 2: RENAMED }, new: { 2: RENAMED } },
    },
    {
      name: "a token on a context line is dropped",
      patch: RENAME,
      changes: {
        old: [
          { line: 2, startCol: 9, endCol: 14 },
          { line: 3, startCol: 0, endCol: 1 },
        ],
        new: [
          { line: 2, startCol: 9, endCol: 14 },
          { line: 1, startCol: 9, endCol: 10 },
        ],
      },
      expected: { old: { 2: RENAMED }, new: { 2: RENAMED } },
    },
    {
      name: "a token spanning lines splits per line",
      patch: lines("@@ -4,2 +4,3 @@", " const a = 1;", "-const s = `x`;", "+const s = `x", "+y`;"),
      changes: {
        old: [{ line: 5, startCol: 10, endCol: 13 }],
        new: [
          { line: 5, startCol: 10, endCol: 12 },
          { line: 6, startCol: 0, endCol: 2 },
        ],
      },
      expected: {
        old: { 5: { quiet: false, ranges: [{ startCol: 10, endCol: 13 }] } },
        new: {
          5: { quiet: false, ranges: [{ startCol: 10, endCol: 12 }] },
          6: { quiet: false, ranges: [{ startCol: 0, endCol: 2 }] },
        },
      },
    },
    {
      name: "several tokens on one line come back in column order",
      patch: RENAME,
      changes: {
        old: [],
        new: [
          { line: 2, startCol: 9, endCol: 14 },
          { line: 2, startCol: 2, endCol: 8 },
        ],
      },
      expected: {
        old: { 2: QUIET },
        new: {
          2: {
            quiet: false,
            ranges: [
              { startCol: 2, endCol: 8 },
              { startCol: 9, endCol: 14 },
            ],
          },
        },
      },
    },
    {
      name: "a second hunk numbers from its own header, and a no-newline marker takes no number",
      patch: lines(
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        "+B",
        "@@ -20,2 +30,3 @@",
        " t",
        "-u",
        "\\ No newline at end of file",
        "+U",
        "+v",
      ),
      changes: { old: [], new: [] },
      expected: {
        old: { 2: QUIET, 21: QUIET },
        new: { 2: QUIET, 31: QUIET, 32: QUIET },
      },
    },
  ])("$name", ({ patch, changes, expected }) => {
    const hunks = parsePrHunks(patch);

    const annotations = annotateLines(changes, hunks);

    expect(annotations).toEqual(expected);
  });

  it("gives undefined for an unreadable hunk", () => {
    const hunks = parsePrHunks(lines("@@ -1,1 +1,1 @@", "?x"));

    const annotations = annotateLines({ old: [], new: [] }, hunks);

    expect(annotations).toBeUndefined();
  });
});
