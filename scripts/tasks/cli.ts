import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Argument, Command } from "@commander-js/extra-typings";
import { FETCHED_WASM } from "../../utils/structural/packaged";
import { ADDON_GUID, AMO_PAGE, addonStatus, amoFetch, checkAmo } from "./amo/api";
import {
  createListing,
  licenseSlug,
  listingPayload,
  readmeDescription,
  readmeScreenshots,
} from "./amo/listing";
import { sourcesZipProblems } from "./amo/sources";
import { downloaded, FETCHED_DIR, fetchGrammars } from "./grammars";
import {
  missingSecrets,
  parseCommits,
  releaseTagError,
  STORE_ENVIRONMENT,
  STORE_SECRETS,
  workflowRunArgs,
} from "./release/compute";
import { BUMP_LEVELS, nextVersion } from "./release/version";

const bumpArgument = <Name extends "<bump>" | "[bump]">(name: Name) =>
  new Argument(name, "which semver part to bump").choices(BUMP_LEVELS);

const program = new Command("tasks").description("gh-prism's task CLI");

// Deletes the AMO keys from process.env once read, so no process spawned later inherits them.
const amoFromEnv = () => {
  const { FIREFOX_JWT_ISSUER: issuer, FIREFOX_JWT_SECRET: secret } = process.env;
  if (!issuer || !secret) {
    return program.error("missing FIREFOX_JWT_ISSUER or FIREFOX_JWT_SECRET");
  }
  delete process.env.FIREFOX_JWT_ISSUER;
  delete process.env.FIREFOX_JWT_SECRET;
  return amoFetch(
    { issuer, secret },
    fetch,
    () => Math.floor(Date.now() / 1000),
    () => crypto.randomUUID(),
  );
};

program
  .command("release")
  .description(
    "Dispatch the release workflow on main, which bumps, tags, and publishes to both stores, or finishes a version's Firefox submit",
  )
  .addArgument(bumpArgument("[bump]"))
  .option(
    "--firefox-only <version>",
    "an existing version whose Chrome submit went through; submit only it to AMO, then create its GitHub Release",
  )
  .option("--notes-file <path>", "release notes for the GitHub Release")
  .action((bump, { firefoxOnly, notesFile }) => {
    const usage = "give either a bump or --firefox-only <version>";
    if (bump !== undefined && firefoxOnly !== undefined) {
      program.error(usage);
    }
    const target =
      bump !== undefined
        ? { bump }
        : firefoxOnly !== undefined
          ? { firefoxOnly }
          : program.error(usage);
    if (notesFile !== undefined && !existsSync(notesFile)) {
      program.error(`notes file not found: ${notesFile}`);
    }
    const { status } = spawnSync("gh", workflowRunArgs(target, notesFile), { stdio: "inherit" });
    if (status === 0) {
      console.log("Follow it with: gh run watch (or gh run list --workflow release.yml)");
    }
    process.exitCode = status ?? 1;
  });

program
  .command("version")
  .description("Bump package.json's version and print the new one (CI only)")
  .addArgument(bumpArgument("<bump>"))
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
    const problem = await checkAmo(amoFromEnv(), firefoxOnly);
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

const environmentSecrets = () =>
  new Set(
    lines(
      run("gh", ["secret", "list", "--env", STORE_ENVIRONMENT, "--json", "name", "-q", ".[].name"]),
    ),
  );

const rebuildDiffers = (zip: string): boolean => {
  const dir = mkdtempSync(join(tmpdir(), "gh-prism-sources-"));
  try {
    run("unzip", ["-q", zip, "-d", dir]);
    run("bun", ["install", "--frozen-lockfile"], dir);
    run("bun", ["run", "build"], dir);
    const { status } = spawnSync(
      "diff",
      ["-r", join(dir, ".output/firefox-mv3"), ".output/firefox-mv3"],
      { stdio: "inherit" },
    );
    return status !== 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const checkSources = () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const zip = `.output/gh-prism-${version}-sources.zip`;
  const problems = sourcesZipProblems(
    lines(run("unzip", ["-Z1", zip])),
    lines(run("git", ["-c", "core.quotePath=false", "ls-files"])),
  );
  if (problems.length > 0) {
    program.error(problems.join("\n"));
  }
  if (rebuildDiffers(zip)) {
    program.error("rebuilding from the sources zip gives a different .output/firefox-mv3");
  }
  // stderr keeps create-amo-listing --dry-run's stdout pure JSON.
  console.error(`${zip} rebuilds .output/firefox-mv3 identically`);
};

program
  .command("fetch-grammars")
  .description("Download the grammar files no npm package carries (bun install runs this)")
  .action(() => fetchGrammars(FETCHED_WASM, FETCHED_DIR, downloaded));

program
  .command("check-sources")
  .description("Check the Firefox sources zip rebuilds .output/firefox-mv3 (CI only)")
  .action(checkSources);

const listingInputs = () => {
  run("bunx", ["wxt", "zip", "-b", "firefox"]);
  checkSources();
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    description: string;
    homepage: string;
    bugs: { url: string };
    version: string;
  };
  const manifest = JSON.parse(readFileSync(".output/firefox-mv3/manifest.json", "utf8")) as {
    name: string;
  };
  const readme = readFileSync("README.md", "utf8");
  return {
    version: pkg.version,
    xpi: `.output/gh-prism-${pkg.version}-firefox.zip`,
    sourcesZip: `.output/gh-prism-${pkg.version}-sources.zip`,
    screenshots: readmeScreenshots(readme),
    fields: {
      manifestName: manifest.name,
      summary: pkg.description,
      description: readmeDescription(readme, pkg.homepage),
      homepage: pkg.homepage,
      supportUrl: pkg.bugs.url,
      license: licenseSlug(readFileSync("LICENSE", "utf8")),
    },
  };
};

program
  .command("create-amo-listing")
  .description("Create gh-prism's AMO listing with its first version, once (CI only)")
  .option("--dry-run", "build and print the listing's payload without contacting AMO")
  .action(async ({ dryRun }) => {
    if (dryRun) {
      const { fields, sourcesZip, xpi, screenshots } = listingInputs();
      const payload = listingPayload({ ...fields, uploadUuid: "<upload uuid>" });
      console.log(JSON.stringify({ payload, sourcesZip, xpi, screenshots }, null, 2));
      return;
    }

    const amo = amoFromEnv();
    const addon = await addonStatus(amo);
    if ("problem" in addon) {
      return program.error(addon.problem);
    }
    if (addon.listed) {
      console.log(`${ADDON_GUID} already exists on AMO: ${AMO_PAGE}; nothing changed`);
      return;
    }
    await createListing({
      ...listingInputs(),
      amo,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      readFile: (path) => readFileSync(path),
      log: console.log,
    });
  });

program
  .command("compute")
  .description("Print the next release's versions and commits from origin/main as JSON")
  .action(() => {
    run("git", ["fetch", "--quiet", "--tags", "origin", "main"]);
    const { version } = JSON.parse(run("git", ["show", "origin/main:package.json"])) as {
      version: string;
    };
    const described = spawnSync(
      "git",
      ["describe", "--tags", "--abbrev=0", "--match", "v*", "origin/main"],
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
          mainSha: run("git", ["rev-parse", "origin/main"]),
          repoSlug: run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]),
          commits: parseCommits(
            run("git", ["log", "--format=%H%x09%s", `${previousTag}..origin/main`]),
          ),
          missingSecrets: missingSecrets(environmentSecrets()),
        },
        null,
        2,
      ),
    );
  });

await program.parseAsync();
