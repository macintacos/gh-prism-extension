/**
 * The commits whose message the user hid, as a list of keys, newest last, kept short so the
 * stored list never grows past `HIDDEN_KEPT`.
 */

import type { CommitHead } from "./github/pr-ref";

const HIDDEN_KEPT = 100;
const KEY = /^[^@]+\/[^@]+@[0-9a-f]{7,40}$/;

/** `commit`'s key: `owner/repo@sha`, in lowercase, with the SHA as its route names it. */
export const hiddenKeyOf = ({ owner, repo, headSha }: CommitHead): string =>
  `${owner}/${repo}@${headSha}`.toLowerCase();

/** Whether `key`'s commit is in `keys`, whether either names it by its full SHA or a prefix. */
export const isHidden = (keys: readonly string[], key: string): boolean =>
  keys.some((hidden) => sameCommit(hidden, key));

/** `keys` with `key`'s commit hidden, as the newest, or shown, keeping the newest `HIDDEN_KEPT`. */
export function withHidden(keys: readonly string[], key: string, hidden: boolean): string[] {
  const others = keys.filter((other) => !sameCommit(other, key));
  return hidden ? [...others, key].slice(-HIDDEN_KEPT) : others;
}

/** The stored list's well-formed keys; anything but a list reads as none. */
export const hiddenKeysOf = (saved: unknown): string[] =>
  Array.isArray(saved)
    ? saved.filter((key): key is string => typeof key === "string" && KEY.test(key))
    : [];

function sameCommit(a: string, b: string): boolean {
  const [repoA, shaA = ""] = a.split("@");
  const [repoB, shaB = ""] = b.split("@");
  return repoA === repoB && (shaA.startsWith(shaB) || shaB.startsWith(shaA));
}
