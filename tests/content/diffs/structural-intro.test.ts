import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRUCTURAL_DIFFS_DOC } from "../../../entrypoints/content/diffs/structural-intro";

describe("STRUCTURAL_DIFFS_DOC", () => {
  it("names a doc this repository has, so shipped builds' links resolve once it is on main", () => {
    const path = STRUCTURAL_DIFFS_DOC.replace(
      "https://github.com/macintacos/gh-prism-extension/blob/main/",
      "",
    );

    expect(path).not.toBe(STRUCTURAL_DIFFS_DOC);
    expect(existsSync(new URL(`../../../${path}`, import.meta.url))).toBe(true);
  });
});
