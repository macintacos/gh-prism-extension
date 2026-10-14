import { describe, expect, it } from "vitest";
import {
  parseCommits,
  releaseTagError,
  workflowRunArgs,
} from "../../../../scripts/tasks/release/compute";

describe("parseCommits", () => {
  it("reads one commit per line, taking the PR number from a trailing (#N)", () => {
    const log = "aaa\tfeat: thing (#40)\nbbb\tchore: bump version to 0.0.2\n";
    expect(parseCommits(log)).toEqual([
      { sha: "aaa", subject: "feat: thing (#40)", pr: 40 },
      { sha: "bbb", subject: "chore: bump version to 0.0.2", pr: null },
    ]);
  });

  it("ignores a PR reference that is not at the end of the subject", () => {
    expect(parseCommits("aaa\trevert (#3) partially")).toEqual([
      { sha: "aaa", subject: "revert (#3) partially", pr: null },
    ]);
  });

  it("returns no commits for empty output", () => {
    expect(parseCommits("")).toEqual([]);
  });
});

describe("releaseTagError", () => {
  it("accepts the tag matching the current version", () => {
    expect(releaseTagError("v0.0.1", "0.0.1")).toBeNull();
  });

  it("rejects a missing tag", () => {
    expect(releaseTagError(null, "0.0.1")).toMatch(/no v\* tag/);
  });

  it("rejects a tag that does not match the current version", () => {
    expect(releaseTagError("v0.0.1", "0.0.2")).toMatch(/v0\.0\.2/);
  });
});

describe("workflowRunArgs", () => {
  it("dispatches the release workflow on trunk with the bump", () => {
    expect(workflowRunArgs("minor")).toEqual([
      "workflow",
      "run",
      "release.yml",
      "--ref",
      "trunk",
      "-f",
      "bump=minor",
    ]);
  });

  it("passes the notes file as a field read from disk", () => {
    expect(workflowRunArgs("patch", "/tmp/n.md")).toEqual([
      "workflow",
      "run",
      "release.yml",
      "--ref",
      "trunk",
      "-f",
      "bump=patch",
      "-F",
      "notes=@/tmp/n.md",
    ]);
  });
});
