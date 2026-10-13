import { describe, expect, it } from "vitest";
import { MatchPattern } from "wxt/utils/match-patterns";
import contentScript from "../../entrypoints/content";

const runsOn = (url: string) => {
  const { matches } = contentScript;
  return (
    Array.isArray(matches) && matches.some((pattern) => new MatchPattern(pattern).includes(url))
  );
};

describe("content script", () => {
  it.each([
    "https://github.com/o/r",
    "https://github.com/o/r/pull/1/changes",
    "https://github.com/o/r/pulls",
  ])("runs on GitHub page %s", (url) => expect(runsOn(url)).toBe(true));

  it("skips other hosts", () => expect(runsOn("https://gist.github.com/o/1")).toBe(false));

  it("starts with the document, to catch GitHub's tree before it is painted", () =>
    expect(contentScript.runAt).toBe("document_start"));
});
