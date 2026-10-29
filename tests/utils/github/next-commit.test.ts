import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readNextCommit } from "../../../utils/github/next-commit";
import type { CommitHead } from "../../../utils/github/pr-ref";
import { routedFetch } from "../../fixtures/fetch";

const commit: CommitHead = { kind: "commit", owner: "cli", repo: "cli", headSha: "9eb4db2" };
const SEARCH =
  "https://github.com/search?q=repo%3Acli%2Fcli+parent%3A9eb4db2&type=commits&s=committer-date&o=asc";
const BRANCHES = "https://github.com/cli/cli/branch_commits/9eb4db2";
const COMMITS = "https://github.com/cli/cli/commits/attester%2Fmulti-tenant";

// Each body keeps only the fields gh-prism reads, from a capture of the endpoint's JSON.
const searchFound = (...shas: string[]) =>
  JSON.stringify({ payload: { blackbirdSearchRoute: { results: shas.map((sha) => ({ sha })) } } });
const branchesOf = (...names: string[]) =>
  JSON.stringify({ branches: names.map((branch) => ({ branch, prs: [] })), tags: [] });
const commitsOf = (...oids: string[]) =>
  JSON.stringify({
    payload: {
      commitsRefRoute: {
        commitGroups: [
          { commits: oids.slice(0, 1).map((oid) => ({ oid })) },
          { commits: oids.slice(1).map((oid) => ({ oid })) },
        ],
      },
    },
  });

const ok = (body: string) => () => Promise.resolve(new Response(body));
const failing = () => Promise.resolve(new Response("", { status: 429 }));

let signal: AbortSignal;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  signal = new AbortController().signal;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readNextCommit", () => {
  it("goes to the earliest commit on the default branch that has the commit as a parent", async () => {
    const fetchFn = routedFetch({
      [SEARCH]: ok(searchFound("189706bccb1686c68fb73c5bd9013358320a9e71", "0cf1092493af")),
    });

    const next = await readNextCommit(commit, fetchFn, signal);

    expect(next).toEqual({ kind: "commit", sha: "189706bccb1686c68fb73c5bd9013358320a9e71" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("asks every endpoint for JSON", async () => {
    const fetchFn = routedFetch({
      [SEARCH]: ok(searchFound()),
      [BRANCHES]: ok(branchesOf("attester/multi-tenant")),
      [COMMITS]: ok(commitsOf("b5570ef5a", "9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b")),
    });

    await readNextCommit(commit, fetchFn, signal);

    expect(fetchFn).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchFn.mock.calls) {
      expect(init).toMatchObject({ headers: { Accept: "application/json" }, signal });
    }
  });

  it("goes to the commit listed just above it on the branch holding it, off the default branch", async () => {
    const fetchFn = routedFetch({
      [SEARCH]: ok(searchFound()),
      [BRANCHES]: ok(branchesOf("attester/multi-tenant", "attester/other")),
      [COMMITS]: ok(
        commitsOf(
          "9a5ddc3c6",
          "b5570ef5a",
          "9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b",
          "df5e6d92a",
        ),
      ),
    });

    expect(await readNextCommit(commit, fetchFn, signal)).toEqual({
      kind: "commit",
      sha: "b5570ef5a",
    });
  });

  it("has none at the head of the branch holding it", async () => {
    const fetchFn = routedFetch({
      [SEARCH]: ok(searchFound()),
      [BRANCHES]: ok(branchesOf("attester/multi-tenant")),
      [COMMITS]: ok(commitsOf("9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b", "df5e6d92a")),
    });

    expect(await readNextCommit(commit, fetchFn, signal)).toEqual({
      kind: "newest",
      branch: "attester/multi-tenant",
    });
  });

  it.each([
    ["no branch holds the commit", branchesOf(), commitsOf()],
    [
      "the commit is past the first page of its branch's history",
      branchesOf("attester/multi-tenant"),
      commitsOf("9a5ddc3c6", "b5570ef5a"),
    ],
  ])("finds none when %s", async (_, branches, commits) => {
    const fetchFn = routedFetch({
      [SEARCH]: ok(searchFound()),
      [BRANCHES]: ok(branches),
      [COMMITS]: ok(commits),
    });

    expect(await readNextCommit(commit, fetchFn, signal)).toEqual({ kind: "unknown" });
  });

  it.each([
    ["the search fails", { [SEARCH]: failing }],
    ["the search answers an unexpected shape", { [SEARCH]: ok("{}") }],
    [
      "the branches answer an unexpected shape",
      { [SEARCH]: ok(searchFound()), [BRANCHES]: ok("[]") },
    ],
    [
      "the branch's commits fail",
      { [SEARCH]: ok(searchFound()), [BRANCHES]: ok(branchesOf("attester/multi-tenant")) },
    ],
  ])("reads nothing, with one warning, when %s", async (_, routes) => {
    expect(await readNextCommit(commit, routedFetch(routes), signal)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads nothing, silently, once the visit aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError")));

    expect(await readNextCommit(commit, fetchFn, controller.signal)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
