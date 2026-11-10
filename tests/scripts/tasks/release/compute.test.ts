import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  missingSecrets,
  parseCommits,
  releaseTagError,
  STORE_ENVIRONMENT,
  STORE_SECRETS,
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

describe("missingSecrets", () => {
  it("lists the store secrets that are absent, in STORE_SECRETS order", () => {
    const present = new Set(["FIREFOX_JWT_SECRET", "CHROME_EXTENSION_ID", "UNRELATED"]);

    expect(missingSecrets(present)).toEqual([
      "CHROME_PUBLISHER_ID",
      "CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL",
      "CHROME_SERVICE_ACCOUNT_PRIVATE_KEY",
      "FIREFOX_JWT_ISSUER",
    ]);
  });

  it("returns nothing when every store secret is present", () => {
    expect(missingSecrets(new Set(STORE_SECRETS))).toEqual([]);
  });
});

describe("workflowRunArgs", () => {
  it("dispatches the release workflow on main with the bump", () => {
    expect(workflowRunArgs({ bump: "minor" })).toEqual([
      "workflow",
      "run",
      "release.yml",
      "--ref",
      "main",
      "-f",
      "bump=minor",
    ]);
  });

  it("passes the notes file as a field read from disk", () => {
    expect(workflowRunArgs({ bump: "patch" }, "/tmp/n.md")).toEqual([
      "workflow",
      "run",
      "release.yml",
      "--ref",
      "main",
      "-f",
      "bump=patch",
      "-F",
      "notes=@/tmp/n.md",
    ]);
  });

  it("dispatches a Firefox-only run of an existing version", () => {
    expect(workflowRunArgs({ firefoxOnly: "1.2.3" }, "/tmp/n.md")).toEqual([
      "workflow",
      "run",
      "release.yml",
      "--ref",
      "main",
      "-f",
      "firefox-only=1.2.3",
      "-F",
      "notes=@/tmp/n.md",
    ]);
  });
});

describe("the release workflows", () => {
  it("pass every store secret to release.yml's store check", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    for (const name of STORE_SECRETS) {
      expect(workflow).toContain(`${name}: \${{ secrets.${name} }}`);
    }
  });

  it.each(["release.yml", "amo-listing.yml"])("%s runs in the store environment", (file) => {
    expect(readFileSync(`.github/workflows/${file}`, "utf8")).toContain(
      `environment: ${STORE_ENVIRONMENT}`,
    );
  });
});
