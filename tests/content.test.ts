import { describe, expect, it } from "vitest";
import { MatchPattern } from "wxt/utils/match-patterns";
import contentScript from "../entrypoints/content";

const runsOn = (url: string) => {
  const { matches } = contentScript;
  return Array.isArray(matches) && matches.some((m) => new MatchPattern(m).includes(url));
};

describe("content script", () => {
  it.each(["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/1/files"])(
    "runs on pull request page %s",
    (url) => expect(runsOn(url)).toBe(true),
  );

  it.each([
    "https://github.com/o/r/pulls",
    "https://github.com/o/r/issues/1",
    "https://github.com/o/r",
  ])("skips non-pull-request page %s", (url) => expect(runsOn(url)).toBe(false));
});
