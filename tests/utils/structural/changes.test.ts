import { describe, expect, it } from "vitest";
import { parsePrHunks } from "../../../utils/github/pr-diff";
import {
  annotateLines,
  type LineAnnotations,
  type StructuralChanges,
  structuralFile,
} from "../../../utils/structural/changes";
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
    expected: LineAnnotations;
  }>([
    {
      name: "a reindented block gives quiet rows",
      patch: lines("@@ -10,3 +10,3 @@", " if (a) {", "-b();", "+  b();", " }"),
      changes: { old: [], new: [] },
      expected: {
        old: { 10: QUIET, 11: QUIET, 12: QUIET },
        new: { 10: QUIET, 11: QUIET, 12: QUIET },
      },
    },
    {
      name: "a renamed identifier gives only that token's range",
      patch: RENAME,
      changes: {
        old: [{ line: 2, startCol: 9, endCol: 14 }],
        new: [{ line: 2, startCol: 9, endCol: 14 }],
      },
      expected: {
        old: { 1: QUIET, 2: RENAMED, 3: QUIET },
        new: { 1: QUIET, 2: RENAMED, 3: QUIET },
      },
    },
    {
      name: "a token on a context line is kept on its own side",
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
      expected: {
        old: { 1: QUIET, 2: RENAMED, 3: { quiet: false, ranges: [{ startCol: 0, endCol: 1 }] } },
        new: { 1: { quiet: false, ranges: [{ startCol: 9, endCol: 10 }] }, 2: RENAMED, 3: QUIET },
      },
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
        old: { 4: QUIET, 5: { quiet: false, ranges: [{ startCol: 10, endCol: 13 }] } },
        new: {
          4: QUIET,
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
        old: { 1: QUIET, 2: QUIET, 3: QUIET },
        new: {
          1: QUIET,
          2: {
            quiet: false,
            ranges: [
              { startCol: 2, endCol: 8 },
              { startCol: 9, endCol: 14 },
            ],
          },
          3: QUIET,
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
        old: { 1: QUIET, 2: QUIET, 20: QUIET, 21: QUIET },
        new: { 1: QUIET, 2: QUIET, 30: QUIET, 31: QUIET, 32: QUIET },
      },
    },
    {
      name: "an added file numbers its new lines from 1",
      patch: lines("@@ -0,0 +1,2 @@", "+a", "+b"),
      changes: { old: [], new: [] },
      expected: { old: {}, new: { 1: QUIET, 2: QUIET } },
    },
    {
      name: "a pure insertion numbers from its new start",
      patch: lines("@@ -3,0 +4,1 @@", "+x"),
      changes: { old: [], new: [] },
      expected: { old: {}, new: { 4: QUIET } },
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

describe("structuralFile", () => {
  it("gives the text of every hunk line, a context line's on both sides", () => {
    const file = structuralFile({ old: [], new: [] }, parsePrHunks(RENAME));

    expect(file?.text).toEqual({
      old: { 1: "function f() {", 2: "  return count;", 3: "}" },
      new: { 1: "function f() {", 2: "  return total;", 3: "}" },
    });
  });

  it("numbers a context line by each side's own count", () => {
    const hunks = parsePrHunks(lines("@@ -5,2 +5,3 @@", "+x", " a", " b"));

    const file = structuralFile({ old: [], new: [] }, hunks);

    expect(file?.text).toEqual({ old: { 5: "a", 6: "b" }, new: { 5: "x", 6: "a", 7: "b" } });
  });

  it("numbers each hunk's text from its own header", () => {
    const hunks = parsePrHunks(
      lines("@@ -1,2 +1,2 @@", " a", "-b", "+B", "@@ -20,2 +30,3 @@", " t", "-u", "+U", "+v"),
    );

    const file = structuralFile({ old: [], new: [] }, hunks);

    expect(file?.text).toEqual({
      old: { 1: "a", 2: "b", 20: "t", 21: "u" },
      new: { 1: "a", 2: "B", 30: "t", 31: "U", 32: "v" },
    });
  });

  it("keeps the whole text of a final line with no newline", () => {
    const hunks = parsePrHunks(
      lines("@@ -1,1 +1,1 @@", "-old", "+new", "\\ No newline at end of file"),
    );

    const file = structuralFile({ old: [], new: [] }, hunks);

    expect(file?.text).toEqual({ old: { 1: "old" }, new: { 1: "new" } });
  });

  it("gives undefined for an unreadable hunk", () => {
    const hunks = parsePrHunks(lines("@@ -1,1 +1,1 @@", "?x"));

    expect(structuralFile({ old: [], new: [] }, hunks)).toBeUndefined();
  });

  it("annotates the lines as annotateLines does", () => {
    const changes = {
      old: [{ line: 2, startCol: 9, endCol: 14 }],
      new: [{ line: 2, startCol: 9, endCol: 14 }],
    };
    const hunks = parsePrHunks(RENAME);

    const file = structuralFile(changes, hunks);

    expect(file?.annotations).toEqual(annotateLines(changes, hunks));
  });
});
