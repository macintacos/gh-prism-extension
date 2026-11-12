import { describe, expect, it } from "vitest";
import type { PrFileDiff } from "../../../utils/github/pr-diff";
import { baseText } from "../../../utils/structural/base-text";
import { lines } from "../../fixtures/head-scan";

const modified = (patch: string): PrFileDiff => ({
  kind: "text",
  path: "src/a.txt",
  status: "modified",
  patch,
});

const NO_NEWLINE = "\\ No newline at end of file";

describe("baseText", () => {
  it.each([
    {
      name: "several hunks",
      file: modified(
        lines(
          "@@ -1,3 +1,3 @@",
          " l1",
          "-l2",
          "+L2",
          " l3",
          "@@ -10,3 +10,4 @@",
          " l10",
          "-l11",
          "+L11",
          "+extra",
          " l12",
        ),
      ),
      head: "l1\nL2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nL11\nextra\nl12\n",
      old: "l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11\nl12\n",
    },
    {
      name: "a hunk at the first line",
      file: modified(lines("@@ -1,2 +1,2 @@", "-a", "+A", " b")),
      head: "A\nb\nc\n",
      old: "a\nb\nc\n",
    },
    {
      name: "a hunk at the last line",
      file: modified(lines("@@ -2,2 +2,2 @@", " b", "-c", "+C")),
      head: "a\nb\nC\n",
      old: "a\nb\nc\n",
    },
    {
      name: "no newline at end of either text",
      file: modified(lines("@@ -1,2 +1,2 @@", " a", "-b", NO_NEWLINE, "+B", NO_NEWLINE)),
      head: "a\nB",
      old: "a\nb",
    },
    {
      name: "a newline added at end of file",
      file: modified(lines("@@ -1 +1 @@", "-a", NO_NEWLINE, "+a")),
      head: "a\n",
      old: "a",
    },
    {
      name: "a newline removed at end of file",
      file: modified(lines("@@ -1 +1 @@", "-a", "+a", NO_NEWLINE)),
      head: "a",
      old: "a\n",
    },
    {
      name: "an unchanged last line without a newline",
      file: modified(lines("@@ -1,2 +1,3 @@", "+x", " a", " b", NO_NEWLINE)),
      head: "x\na\nb",
      old: "a\nb",
    },
    {
      name: "an untouched last line without a newline, outside every hunk",
      file: modified(lines("@@ -1,2 +1,2 @@", "-a", "+A", " b")),
      head: "A\nb\nc\nd",
      old: "a\nb\nc\nd",
    },
    {
      name: "CRLF line endings",
      file: modified(lines("@@ -1,3 +1,3 @@", " a\r", "-b\r", "+B\r", " c\r")),
      head: "a\r\nB\r\nc\r\n",
      old: "a\r\nb\r\nc\r\n",
    },
    {
      name: "a line converted from LF to CRLF",
      file: modified(lines("@@ -1,2 +1,2 @@", " a", "-b", "+b\r")),
      head: "a\nb\r\n",
      old: "a\nb\n",
    },
    {
      name: "a rename with edits",
      file: {
        kind: "text",
        path: "src/a.txt",
        previousPath: "src/old.txt",
        status: "renamed",
        patch: lines("@@ -1,2 +1,2 @@", "-a", "+A", " b"),
      } satisfies PrFileDiff,
      head: "A\nb\n",
      old: "a\nb\n",
    },
    {
      name: "a pure insertion without context",
      file: modified(lines("@@ -1,0 +2 @@", "+b")),
      head: "a\nb\nc\n",
      old: "a\nc\n",
    },
    {
      name: "a pure deletion without context",
      file: modified(lines("@@ -2 +1,0 @@", "-b")),
      head: "a\nc\n",
      old: "a\nb\nc\n",
    },
    {
      name: "a blank context line written as an empty string",
      file: modified(lines("@@ -1,3 +1,3 @@", " a", "", "-b", "+B")),
      head: "a\n\nB\n",
      old: "a\n\nb\n",
    },
    {
      name: "a file emptied by the change",
      file: modified(lines("@@ -1,2 +0,0 @@", "-a", "-b")),
      head: "",
      old: "a\nb\n",
    },
    {
      name: "a file that was empty before",
      file: modified(lines("@@ -0,0 +1,2 @@", "+a", "+b")),
      head: "a\nb\n",
      old: "",
    },
  ])("rebuilds $name", ({ file, head, old }) => {
    expect(baseText(file, head)).toBe(old);
  });

  it("rebuilds a one-line hunk between long untouched runs", () => {
    const run = "x\n".repeat(200_000);
    const file = modified(lines("@@ -200001 +200001 @@", "-a", "+A"));

    const old = baseText(file, `${run}A\n${run}`);

    expect(old).toBe(`${run}a\n${run}`);
  });

  it.each([
    {
      name: "a context line that differs from head",
      patch: lines("@@ -1,2 +1,2 @@", " a", "-b", "+B"),
      head: "x\nB\n",
    },
    {
      name: "an added line that differs from head",
      patch: lines("@@ -1,2 +1,2 @@", " a", "-b", "+B"),
      head: "a\nZ\n",
    },
    {
      name: "a hunk that starts past the end of head",
      patch: lines("@@ -9,2 +9,2 @@", " a", "-b", "+B"),
      head: "a\nB\n",
    },
    {
      name: "a hunk that runs past the end of head",
      patch: lines("@@ -1,3 +1,3 @@", " a", "-b", "+B", ""),
      head: "a\nB\n",
    },
    {
      name: "an old start that disagrees with the rebuilt text",
      patch: lines("@@ -5,2 +1,2 @@", " a", "-b", "+B"),
      head: "a\nB\n",
    },
    {
      name: "a new count that disagrees with the body",
      patch: lines("@@ -1,2 +1,3 @@", " a", "-b", "+B"),
      head: "a\nB\n",
    },
    {
      name: "an old count that disagrees with the body",
      patch: lines("@@ -1,3 +1,2 @@", " a", "-b", "+B"),
      head: "a\nB\n",
    },
    {
      name: "hunks out of order",
      patch: lines("@@ -3,1 +3,1 @@", "-c", "+C", "@@ -1,1 +1,1 @@", "-a", "+A"),
      head: "A\nb\nC\n",
    },
    {
      name: "a no-newline marker on head's side when head ends with a newline",
      patch: lines("@@ -1 +1 @@", "-a", "+A", NO_NEWLINE),
      head: "A\n",
    },
    {
      name: "a no-newline marker before the end of head",
      patch: lines("@@ -1 +1 @@", "-a", "+A", NO_NEWLINE),
      head: "A\nb",
    },
    {
      name: "a last line without a newline that the patch does not mark",
      patch: lines("@@ -1 +1 @@", "-a", "+A"),
      head: "A",
    },
    {
      name: "a no-newline marker that is not on its side's last line",
      patch: lines("@@ -1,2 +1,2 @@", "-a", NO_NEWLINE, "-b", "+A", "+B"),
      head: "A\nB\n",
    },
    {
      name: "a hunk after a no-newline marker",
      patch: lines("@@ -1 +1 @@", "-a", NO_NEWLINE, "+A", "@@ -3 +3 @@", "-c", "+C"),
      head: "A\nb\nC\n",
    },
    {
      name: "a head without a final newline where the patch says it has one",
      patch: lines("@@ -1 +1 @@", "-a", NO_NEWLINE, "+b"),
      head: "b",
    },
    {
      name: "a no-newline marker that is the first line of its hunk",
      patch: lines("@@ -1 +1 @@", NO_NEWLINE, "-a", "+A"),
      head: "A\n",
    },
    {
      name: "a no-newline marker that follows another",
      patch: lines("@@ -1 +1 @@", "-a", "+A", NO_NEWLINE, NO_NEWLINE),
      head: "A",
    },
    {
      name: "a body line with an unknown prefix",
      patch: lines("@@ -1 +1 @@", "-a", "+A", "?x"),
      head: "A\n",
    },
  ])("refuses $name", ({ patch, head }) => {
    expect(baseText(modified(patch), head)).toBeUndefined();
  });

  it.each([
    {
      name: "a binary file",
      file: { kind: "binary", path: "a.png", status: "modified" },
      head: "a\n",
    },
    {
      name: "an added file",
      file: { kind: "text", path: "a.txt", status: "added", patch: lines("@@ -0,0 +1 @@", "+a") },
      head: "a\n",
    },
    {
      name: "a deleted file",
      file: { kind: "text", path: "a.txt", status: "deleted", patch: lines("@@ -1 +0,0 @@", "-a") },
      head: "",
    },
    {
      name: "a pure rename",
      file: { kind: "text", path: "b.txt", previousPath: "a.txt", status: "renamed", patch: "" },
      head: "a\n",
    },
    {
      name: "a mode-only change",
      file: { kind: "text", path: "a.txt", status: "modified", patch: "" },
      head: "a\n",
    },
  ] satisfies { name: string; file: PrFileDiff; head: string }[])(
    "skips $name",
    ({ file, head }) => {
      expect(baseText(file, head)).toBeUndefined();
    },
  );
});
