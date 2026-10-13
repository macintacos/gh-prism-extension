import { describe, expect, it } from "vitest";
import { isFilesPath, readFilesRoute } from "../../../utils/github/files-route";

describe("isFilesPath", () => {
  it.each([
    "/o/r/pull/1/changes",
    "/o/r/pull/1/changes/",
    "/o/r/pull/1/changes/04bb63f",
    "/o/r/pull/1/changes/aaa..bbb",
    "/o/r/pull/1/files",
    "/o/r/commit/dd95cdc",
    `/o/r/commit/${"a".repeat(40)}`,
    "/o/r/commit/dd95cdc/",
  ])("accepts %s", (path) => expect(isFilesPath(path)).toBe(true));

  it.each([
    "/o/r/pull/1",
    "/o/r/pull/1/commits",
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

  it.each(["/o/r/pull/3/changes/04bb63f", "/o/r/pull/3/changes/aaa..bbb"])(
    "reads a commit filter from %s",
    (path) => expect(readFilesRoute(path)).toEqual({ diff: pr, commitFiltered: true }),
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
