/**
 * Reads the commit that follows another, which no commit records, from the JSON github.com's own
 * pages read with the viewer's session: commit search, the branches holding a commit, and a
 * branch's commits list. A read takes at most three requests and never pages.
 */

import { at, type CommitHead } from "./pr-ref";

/** What follows a commit: the next commit, the branch it is newest on, or nothing found. */
export type NextCommit =
  | { readonly kind: "commit"; readonly sha: string }
  | { readonly kind: "newest"; readonly branch: string }
  | { readonly kind: "unknown" };

/** Reads the JSON a github.com path answers with. */
type ReadJson = (path: string) => Promise<unknown>;

/**
 * The commit after `commit`: the earliest on the default branch with `commit` as a parent, from
 * commit search, which covers only that branch; else the one GitHub lists just above it on the
 * first branch holding it, when that branch's newest page lists it. `undefined` once a read fails
 * or answers an unexpected shape. Never rejects; logs one warning on a failed read unless `signal`
 * aborted.
 */
export async function readNextCommit(
  commit: CommitHead,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<NextCommit | undefined> {
  const json: ReadJson = (path) => readJson(path, fetchFn, signal);

  try {
    const child = await earliestChild(commit, json);
    if (child) return { kind: "commit", sha: child };

    const branch = await firstBranchHolding(commit, json);
    return branch === undefined ? { kind: "unknown" } : await nextOnBranch(commit, branch, json);
  } catch (error) {
    if (!signal.aborted) console.warn("gh-prism: couldn't read the next commit", error);
    return undefined;
  }
}

/** The SHA of the earliest commit with `commit` as a parent, on the default branch. */
async function earliestChild(
  { owner, repo, headSha }: CommitHead,
  json: ReadJson,
): Promise<string | undefined> {
  const query = new URLSearchParams({
    q: `repo:${owner}/${repo} parent:${headSha}`,
    type: "commits",
    s: "committer-date",
    o: "asc",
  });
  const found = await json(`/search?${query}`);
  return shasOf(at(found, "payload", "blackbirdSearchRoute", "results"), "sha")[0];
}

/** The first branch GitHub lists as holding `commit`, its default branch alone when that does. */
async function firstBranchHolding(
  { owner, repo, headSha }: CommitHead,
  json: ReadJson,
): Promise<string | undefined> {
  const branches = at(await json(`/${owner}/${repo}/branch_commits/${headSha}`), "branches");
  if (!Array.isArray(branches)) throw new Error("expected a list of branches");
  const branch = at(branches[0], "branch");
  return typeof branch === "string" ? branch : undefined;
}

/** What follows `commit` among the newest commits `branch` lists. */
async function nextOnBranch(
  { owner, repo, headSha }: CommitHead,
  branch: string,
  json: ReadJson,
): Promise<NextCommit> {
  const found = await json(`/${owner}/${repo}/commits/${encodeURIComponent(branch)}`);
  const groups = at(found, "payload", "commitsRefRoute", "commitGroups");
  if (!Array.isArray(groups)) throw new Error("expected a list of commit groups");
  const listed = groups.flatMap((group) => shasOf(at(group, "commits"), "oid"));

  const index = listed.findIndex((oid) => oid.startsWith(headSha));
  if (index < 0) return { kind: "unknown" };
  const above = listed[index - 1];
  return above ? { kind: "commit", sha: above } : { kind: "newest", branch };
}

async function readJson(
  path: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  const url = `https://github.com${path}`;
  // Without this header each answers with its page's HTML.
  const response = await fetchFn(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** The `key` SHA of each of `commits`; throws on anything but a list of them. */
function shasOf(commits: unknown, key: string): string[] {
  if (!Array.isArray(commits)) throw new Error("expected a list of commits");
  return commits.map((commit) => {
    const sha = at(commit, key);
    if (typeof sha !== "string") throw new Error(`expected each commit's ${key}`);
    return sha;
  });
}
