import { describe, expect, it } from "vitest";
import { grammarOf } from "../../../utils/structural/grammar";

describe("grammarOf", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["a.d.ts", "typescript"],
    ["a.mts", "typescript"],
    ["a.cts", "typescript"],
    ["App.tsx", "tsx"],
    ["a.js", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.jsx", "javascript"],
    [".eslintrc.js", "javascript"],
    ["a.py", "python"],
    ["a.pyi", "python"],
    ["Makefile", undefined],
    ["a.go", undefined],
    ["a.yaml", undefined],
    ["x.TSX", undefined],
  ])("maps %s to %s", (path, id) => {
    expect(grammarOf(path)?.id).toBe(id);
  });

  it("marks only python as indentation-sensitive", () => {
    const sensitive = ["a.ts", "a.tsx", "a.js", "a.py"].filter(
      (path) => grammarOf(path)?.indentationSensitive,
    );
    expect(sensitive).toEqual(["a.py"]);
  });
});
