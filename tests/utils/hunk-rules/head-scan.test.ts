import { describe, expect, it } from "vitest";
import {
  type CommentSyntax,
  commentSyntaxOf,
  extensionOf,
  isDirective,
  scanHeadText,
} from "../../../utils/hunk-rules/head-scan";
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
