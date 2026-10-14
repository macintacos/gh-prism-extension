import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Argument, Command } from "@commander-js/extra-typings";
import { parseCommits, releaseTagError, workflowRunArgs } from "./release/compute";
import { BUMP_LEVELS, nextVersion } from "./release/version";

const bumpArgument = () => new Argument("<bump>", "which semver part to bump").choices(BUMP_LEVELS);

const program = new Command("tasks").description("gh-prism's task CLI");

program
  .command("release")
  .description("Dispatch the release workflow on trunk, which bumps, tags, and publishes")
  .addArgument(bumpArgument())
  .option("--notes-file <path>", "release notes for the GitHub Release")
  .action((bump, { notesFile }) => {
    if (notesFile !== undefined && !existsSync(notesFile)) {
      program.error(`notes file not found: ${notesFile}`);
    }
    const { status } = spawnSync("gh", workflowRunArgs(bump, notesFile), { stdio: "inherit" });
    if (status === 0) {
      console.log("Follow it with: gh run watch (or gh run list --workflow release.yml)");
    }
    process.exitCode = status ?? 1;
  });

program
  .command("version")
  .description("Bump package.json's version and print the new one (CI only)")
  .addArgument(bumpArgument())
  .action((bump) => {
    const text = readFileSync("package.json", "utf8");
    const { version } = JSON.parse(text) as { version: string };
    const next = nextVersion(version, bump);
    writeFileSync("package.json", text.replace(`"version": "${version}"`, `"version": "${next}"`));
    console.log(next);
  });

const run = (command: string, args: string[]): string => {
  const { status, stdout, stderr } = spawnSync(command, args, { encoding: "utf8" });
  if (status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
};

program
  .command("compute")
  .description("Print the next release's versions and commits from origin/trunk as JSON")
  .action(() => {
    run("git", ["fetch", "--quiet", "--tags", "origin", "trunk"]);
    const { version } = JSON.parse(run("git", ["show", "origin/trunk:package.json"])) as {
      version: string;
    };
    const described = spawnSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v*", "origin/trunk"],
      { encoding: "utf8" },
    );
    const previousTag = described.status === 0 ? described.stdout.trim() : null;
    const error = releaseTagError(previousTag, version);
    if (error !== null) {
      program.error(error);
    }
    console.log(
      JSON.stringify(
        {
          currentVersion: version,
          next: Object.fromEntries(BUMP_LEVELS.map((bump) => [bump, nextVersion(version, bump)])),
          previousTag,
          trunkSha: run("git", ["rev-parse", "origin/trunk"]),
          repoSlug: run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]),
          commits: parseCommits(
            run("git", ["log", "--format=%H%x09%s", `${previousTag}..origin/trunk`]),
          ),
        },
        null,
        2,
      ),
    );
  });

program.parse();
