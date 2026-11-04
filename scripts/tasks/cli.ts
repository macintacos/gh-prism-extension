import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Argument, Command } from "@commander-js/extra-typings";
import { amoFetch, checkAmo } from "./amo/api";
import { sourcesZipProblems } from "./amo/sources";
import {
  missingSecrets,
  parseCommits,
  releaseTagError,
  STORE_ENVIRONMENT,
  STORE_SECRETS,
  workflowRunArgs,
} from "./release/compute";
import { BUMP_LEVELS, nextVersion } from "./release/version";

const bumpArgument = () => new Argument("<bump>", "which semver part to bump").choices(BUMP_LEVELS);

const program = new Command("tasks").description("gh-prism's task CLI");

program
  .command("release")
  .description("Dispatch the release workflow on trunk, which bumps, tags, and publishes")
  .addArgument(new Argument("[bump]", "which semver part to bump").choices(BUMP_LEVELS))
  .option(
    "--firefox-only <version>",
    "an existing version whose Chrome submit went through; submit only it to AMO, then create its GitHub Release",
  )
  .option("--notes-file <path>", "release notes for the GitHub Release")
  .action((bump, { firefoxOnly, notesFile }) => {
    if ((bump === undefined) === (firefoxOnly === undefined)) {
      program.error("give either a bump or --firefox-only <version>");
    }
    if (notesFile !== undefined && !existsSync(notesFile)) {
      program.error(`notes file not found: ${notesFile}`);
    }
    const run = bump === undefined ? { firefoxOnly: firefoxOnly as string } : { bump };
    const { status } = spawnSync("gh", workflowRunArgs(run, notesFile), { stdio: "inherit" });
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

program
  .command("check-stores")
  .description("Check the store secrets and AMO before a release (CI only)")
  .option("--firefox-only <version>", "the version a Firefox-only run would submit")
  .action(async ({ firefoxOnly }) => {
    const missing = missingSecrets(new Set(STORE_SECRETS.filter((name) => process.env[name])));
    if (missing.length > 0) {
      program.error(
        `missing store secrets in the ${STORE_ENVIRONMENT} environment: ${missing.join(", ")}`,
      );
    }
    const credentials = {
      issuer: process.env.FIREFOX_JWT_ISSUER ?? "",
      secret: process.env.FIREFOX_JWT_SECRET ?? "",
    };
    const amo = amoFetch(
      credentials,
      fetch,
      () => Math.floor(Date.now() / 1000),
      () => crypto.randomUUID(),
    );
    const problem = await checkAmo(amo, firefoxOnly);
    if (problem !== null) {
      program.error(problem);
    }
  });

const run = (command: string, args: string[], cwd?: string): string => {
  const { status, stdout, stderr } = spawnSync(command, args, { encoding: "utf8", cwd });
  if (status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr.trim()}`);
  }
  return stdout.trim();
};

const lines = (text: string) => text.split("\n").filter(Boolean);

const checkSources = () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const zip = `.output/gh-prism-${version}-sources.zip`;
  const problems = sourcesZipProblems(
    lines(run("unzip", ["-Z1", zip])),
    lines(run("git", ["ls-files"])),
  );
  if (problems.length > 0) {
    program.error(problems.join("\n"));
  }

  const dir = mkdtempSync(join(tmpdir(), "gh-prism-sources-"));
  run("unzip", ["-q", zip, "-d", dir]);
  run("bun", ["install", "--frozen-lockfile"], dir);
  run("bun", ["run", "build"], dir);

  const { status } = spawnSync(
    "diff",
    ["-r", join(dir, ".output/firefox-mv3"), ".output/firefox-mv3"],
    {
      stdio: "inherit",
    },
  );
  if (status !== 0) {
    program.error("rebuilding from the sources zip gives a different .output/firefox-mv3");
  }
  console.log(`${zip} rebuilds .output/firefox-mv3 identically`);
};

program
  .command("check-sources")
  .description("Check the Firefox sources zip rebuilds .output/firefox-mv3 (CI only)")
  .action(checkSources);

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
          missingSecrets: missingSecrets(
            new Set(
              run("gh", [
                "secret",
                "list",
                "--env",
                STORE_ENVIRONMENT,
                "--json",
                "name",
                "-q",
                ".[].name",
              ])
                .split("\n")
                .filter(Boolean),
            ),
          ),
        },
        null,
        2,
      ),
    );
  });

await program.parseAsync();
