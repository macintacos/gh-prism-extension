import { describe, expect, it } from "vitest";
import {
  isFilesPath,
  ownerOf,
  readFilesRoute,
  readHeaderTabPr,
  withOwner,
  withViewerOwner,
} from "../../../utils/github/files-route";

describe("isFilesPath", () => {
  it.each([
    "/o/r/pull/1/changes",
    "/o/r/pull/1/changes/",
    "/o/r/pull/1/changes/04bb63f",
    "/o/r/pull/1/changes/aaa..bbb",
    "/o/r/pull/1/files",
    "/o/r/pull/1/commits/04bb63f",
    `/o/r/pull/1/commits/${"a".repeat(40)}`,
    "/o/r/commit/dd95cdc",
    `/o/r/commit/${"a".repeat(40)}`,
    "/o/r/commit/dd95cdc/",
  ])("accepts %s", (path) => expect(isFilesPath(path)).toBe(true));

  it.each([
    "/o/r/pull/1",
    "/o/r/pull/1/commits",
    "/o/r/pull/1/commits/main",
    "/o/r/pulls",
    "/o/r/blob/main/pull/1/changes",
    "/o/r/pull/x/changes",
    "/o/r/pull/1/changesets",
    "/o/r/tree/pull/1/changes/x",
    "/o/r/commit/main",
    "/o/r/commit/abc",
    "/o/r/commit/dd95cdc.diff",
    "/o/r/commits/dd95cdc",
    `/o/r/commit/${"a".repeat(41)}`,
  ])("rejects %s", (path) => expect(isFilesPath(path)).toBe(false));
});

describe("readFilesRoute", () => {
  const pr = { kind: "pr", owner: "o", repo: "r", number: 3 };

  it.each(["/o/r/pull/3/changes", "/o/r/pull/3/changes/", "/o/r/pull/3/files"])(
    "reads the whole pull request from %s",
    (path) => expect(readFilesRoute(path)).toEqual({ diff: pr, commitFiltered: false }),
  );

  it.each([
    "/o/r/pull/3/changes/04bb63f",
    "/o/r/pull/3/changes/aaa..bbb",
    `/o/r/pull/3/commits/${"a".repeat(40)}`,
  ])("reads a commit filter from %s", (path) =>
    expect(readFilesRoute(path)).toEqual({ diff: pr, commitFiltered: true }),
  );

  it.each(["/o/r/pull/3", "/o/r/issues/3"])("is undefined off the Files changed tab: %s", (path) =>
    expect(readFilesRoute(path)).toBeUndefined(),
  );

  it("reads a single commit, whose diff is never filtered", () =>
    expect(readFilesRoute("/o/r/commit/dd95cdc")).toEqual({
      diff: { kind: "commit", owner: "o", repo: "r", headSha: "dd95cdc" },
      commitFiltered: false,
    }));

  it("is undefined for a commit SHA shorter than seven characters", () =>
    expect(readFilesRoute("/o/r/commit/dd95cd")).toBeUndefined());
});

describe("readHeaderTabPr", () => {
  const pr = { kind: "pr", owner: "o", repo: "r", number: 3 };

  it.each([
    "/o/r/pull/3",
    "/o/r/pull/3/",
    "/o/r/pull/3/commits",
    "/o/r/pull/3/commits/",
    "/o/r/pull/3/checks",
    "/o/r/pull/3/checks/",
  ])("reads the pull request from %s", (path) => expect(readHeaderTabPr(path)).toEqual(pr));

  it.each([
    "/o/r/pull/3/changes",
    "/o/r/pull/3/files",
    "/o/r/pull/3/commits/04bb63f",
    "/o/r/pull/3/checks/x",
    "/o/r/pull/x",
    "/o/r/issues/3",
    "/o/r/commit/dd95cdc",
  ])("is undefined for %s", (path) => expect(readHeaderTabPr(path)).toBeUndefined());
});

describe("ownerOf", () => {
  it.each(["", "?gh-prism-owner=", "?gh-prism-owner=%20"])("is undefined for %j", (search) =>
    expect(ownerOf(search)).toBeUndefined(),
  );

  it.each([
    ["?gh-prism-owner=excessive-dev/frontend", "@excessive-dev/frontend"],
    ["?gh-prism-owner=excessive-dev%2Ffrontend", "@excessive-dev/frontend"],
    ["?gh-prism-owner=%40sandbox-user", "@sandbox-user"],
    ["?gh-prism-owner=octocat&owned-by%5B%5D=octocat", "@octocat"],
    ["?gh-prism-owner=octocat&gh-prism-owner=hubot", "@octocat"],
    ["?gh-prism-owner=dev@example.com", "dev@example.com"],
  ])("reads %s as %s", (search, token) => expect(ownerOf(search)).toBe(token));
});

describe("withOwner", () => {
  const changes = "https://github.com/o/r/pull/1/changes";

  it("sets the owner and drops GitHub's owner filter, keeping other parameters", () => {
    const result = withOwner(`${changes}?owned-by%5B%5D=me&file-filters%5B%5D=.ts#top`, "@o/team");

    expect(result).not.toContain("owned-by");
    expect(result).toContain("file-filters%5B%5D=.ts");
    expect(result).toMatch(/#top$/);
    expect(ownerOf(new URL(result).search)).toBe("@o/team");
  });

  it("clears the owner when given none", () => {
    expect(withOwner(`${changes}?gh-prism-owner=o%2Fteam`, undefined)).not.toContain(
      "gh-prism-owner",
    );
  });

  it("round-trips a user through ownerOf", () => {
    expect(ownerOf(new URL(withOwner(changes, "@user")).search)).toBe("@user");
  });
});

describe("withViewerOwner", () => {
  it("sets GitHub's owner filter to the login and drops the owner", () => {
    const result = withViewerOwner(
      "https://github.com/o/r/pull/1/changes?gh-prism-owner=o%2Fteam&file-filters%5B%5D=.ts",
      "me",
    );

    expect(result).toContain("owned-by%5B%5D=me");
    expect(result).toContain("file-filters%5B%5D=.ts");
    expect(ownerOf(new URL(result).search)).toBeUndefined();
  });
});
