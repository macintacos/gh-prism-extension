import { describe, expect, it } from "vitest";
import contentScript from "../entrypoints/content";

describe("content script", () => {
  it("runs only on GitHub pull request pages", () => {
    expect(contentScript.matches).toEqual(["https://github.com/*/*/pull/*"]);
  });
});
