import semver from "semver";

export const BUMP_LEVELS = ["patch", "minor", "major"] as const;

export type BumpLevel = (typeof BUMP_LEVELS)[number];

/** The next version for `bump` applied to `current`. Throws if `current` is not valid semver. */
export function nextVersion(current: string, bump: BumpLevel): string {
  const next = semver.inc(current, bump);
  if (next === null) {
    throw new Error(`cannot bump invalid version ${JSON.stringify(current)}`);
  }
  return next;
}
