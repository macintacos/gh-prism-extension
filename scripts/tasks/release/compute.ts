import type { BumpLevel } from "./version";

export interface Commit {
  sha: string;
  subject: string;
  pr: number | null;
}

/** Commits from `git log --format=%H%x09%s` output, in the order given. */
export function parseCommits(log: string): Commit[] {
  return log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [sha, subject] = line.split("\t", 2) as [string, string];
      const match = /\(#(\d+)\)$/.exec(subject);
      return { sha, subject, pr: match ? Number(match[1]) : null };
    });
}

/** Why `previousTag` can't anchor a release of `currentVersion`, or null when it can. */
export function releaseTagError(previousTag: string | null, currentVersion: string): string | null {
  if (previousTag === null) {
    return "no v* tag is reachable from origin/trunk; tag the last release first";
  }
  if (previousTag !== `v${currentVersion}`) {
    return `latest tag ${previousTag} does not match origin/trunk's version; expected v${currentVersion}`;
  }
  return null;
}

/** `gh` arguments that dispatch the release workflow on trunk. */
export function workflowRunArgs(bump: BumpLevel, notesFile?: string): string[] {
  const args = ["workflow", "run", "release.yml", "--ref", "trunk", "-f", `bump=${bump}`];
  return notesFile === undefined ? args : [...args, "-F", `notes=@${notesFile}`];
}
