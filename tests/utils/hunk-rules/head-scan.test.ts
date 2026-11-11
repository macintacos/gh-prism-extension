import { describe, expect, it } from "vitest";
import {
  type CommentSyntax,
  commentSyntaxOf,
  extensionOf,
  headFromOutline,
  isDirective,
  scanHeadText,
} from "../../../utils/hunk-rules/head-scan";
import type { HeadOutline } from "../../../utils/structural/outline";
import { lines } from "../../fixtures/head-scan";

describe("isDirective", () => {
  it.each([
    ["api/a.go", true],
    ["src/a.ts", false],
  ])("reads //go:build as a directive in %s: %s", (path, directive) =>
    expect(isDirective(commentSyntaxOf(path) as CommentSyntax, "  //go:build linux")).toBe(
      directive,
    ),
  );
});

describe("extensionOf", () => {
  it.each([
    ["src/app.ts", "ts"],
    ["src/app.test.ts", "ts"],
  ])("takes the text after the last dot of %s", (path, extension) =>
    expect(extensionOf(path)).toBe(extension),
  );

  it.each(["Makefile", "a.b/c"])("is empty for %s, whose file name has no dot", (path) =>
    expect(extensionOf(path)).toBe(""),
  );
});

describe("scanHeadText", () => {
  it("Python: a line that starts inside a triple-quoted string reads as a string", () => {
    const head = scanHeadText("src/app.py", lines('x = """', "column zero", '"""', "y = 1"));
    expect(head?.kinds).toEqual(["code", "string", "string", "code"]);
  });

  it.each(["README.md", "Makefile"])(
    "has no scan for %s, whose extension has no comment syntax",
    (path) => expect(scanHeadText(path, "# Title")).toBeUndefined(),
  );
});

describe("headFromOutline", () => {
  const empty: HeadOutline = { spans: [], testBlocks: [] };

  it("with an empty outline, reads a text with no multi-line literal as the line scan does", () => {
    const text = lines("// note", "const a = 1;", "", "/* one line */", "");

    const head = headFromOutline("src/app.ts", text, empty);

    const scanned = scanHeadText("src/app.ts", text);
    expect(head && { lines: head.lines, starts: head.starts, kinds: head.kinds }).toEqual(scanned);
  });

  it("reads a // line inside a string span as string, and starts the line after it in code", () => {
    const text = lines("const a = `", "// not a comment", "`;", "const b = 1;");
    const outline: HeadOutline = {
      spans: [{ kind: "string", startLine: 1, endLine: 3, closer: "`" }],
      testBlocks: [],
    };

    const head = headFromOutline("src/app.ts", text, outline);

    expect(head?.kinds).toEqual(["code", "string", "string", "code"]);
    expect(head?.starts[3]?.position).toBe("code");
  });

  it("starts the lines inside a comment span inside that comment", () => {
    const text = lines("const a = 1; /* opens", "still comment", "*/");
    const outline: HeadOutline = {
      spans: [{ kind: "comment", startLine: 1, endLine: 3, closer: "*/" }],
      testBlocks: [],
    };

    const head = headFromOutline("src/app.ts", text, outline);

    expect(head?.kinds).toEqual(["code", "comment", "comment"]);
    expect(head?.starts[1]?.position).toEqual({ kind: "comment", closer: "*/" });
  });

  it("lets the later-starting of two nested spans set a line's start state", () => {
    const text = lines("const a = `", "${f(`", "inner", "`)}", "`;");
    const outline: HeadOutline = {
      spans: [
        { kind: "string", startLine: 2, endLine: 4, closer: "'" },
        { kind: "string", startLine: 1, endLine: 5, closer: "`" },
      ],
      testBlocks: [],
    };

    const head = headFromOutline("src/app.ts", text, outline);

    expect(head?.starts[2]?.position).toEqual({ kind: "string", closer: "'" });
    expect(head?.starts[4]?.position).toEqual({ kind: "string", closer: "`" });
  });

  it("ignores a span and a test block past the end of the text", () => {
    const text = lines("const a = 1;", "// note");
    const outline: HeadOutline = {
      spans: [{ kind: "string", startLine: 1, endLine: 9, closer: "`" }],
      testBlocks: [{ start: 2, end: 9 }],
    };

    const head = headFromOutline("src/app.ts", text, outline);

    expect(head?.kinds).toEqual(["code", "comment"]);
    expect(head?.testBlocks).toEqual([]);
  });

  it("carries the outline's test blocks", () => {
    const outline: HeadOutline = { spans: [], testBlocks: [{ start: 1, end: 2 }] };

    const head = headFromOutline("src/app.ts", lines("it('a', () => {", "});"), outline);

    expect(head?.testBlocks).toEqual([{ start: 1, end: 2 }]);
  });

  it("has no head for an extension with no comment syntax", () => {
    expect(headFromOutline("README.md", "# Title", empty)).toBeUndefined();
  });
});
