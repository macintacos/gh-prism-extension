import { describe, expect, it } from "vitest";
import { extensionOf, scanHeadText } from "../utils/head-scan";

const lines = (...text: string[]) => text.join("\n");

describe("extensionOf", () => {
  it.each([
    ["src/app.ts", "ts"],
    ["src/app.test.ts", "ts"],
    ["Makefile", ""],
    ["a.b/c", ""],
  ])("%s → %j", (path, extension) => {
    expect(extensionOf(path)).toBe(extension);
  });
});

describe("scanHeadText", () => {
  it("Python: a line that starts inside a triple-quoted string reads as a string", () => {
    const head = scanHeadText("src/app.py", lines('x = """', "column zero", '"""', "y = 1"));
    expect(head?.kinds).toEqual(["code", "string", "string", "code"]);
  });

  it("has no scan for an extension without comment syntax", () => {
    expect(scanHeadText("README.md", "# Title")).toBeUndefined();
  });
});
