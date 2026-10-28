import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codeOwnerOf,
  isOwner,
  ownedBy,
  type PrCodeOwners,
  readCodeOwners,
} from "../../../utils/github/code-owners";
import type { DiffRef } from "../../../utils/github/pr-ref";
import nodeCodeowners from "../../fixtures/codeowners-node.json?raw";
import noCodeowners from "../../fixtures/codeowners-none.json?raw";
import sandboxCodeowners from "../../fixtures/codeowners-sandbox.json?raw";
import { routedFetch } from "../../fixtures/fetch";
import nodeMergeBox from "../../fixtures/merge-box-node.json?raw";
import sandboxMergeBox from "../../fixtures/merge-box-sandbox.json?raw";

const sandbox: DiffRef = {
  kind: "pr",
  owner: "excessive-dev",
  repo: "gh-prism-codeowners-sandbox",
  number: 1,
};
const node: DiffRef = { kind: "pr", owner: "nodejs", repo: "node", number: 67056 };
const sandboxUrl = "https://github.com/excessive-dev/gh-prism-codeowners-sandbox/pull/1/page_data";
const nodeUrl = "https://github.com/nodejs/node/pull/67056/page_data";

const ok = (text: string) => () => Promise.resolve(new Response(text));
const notFound = () => Promise.resolve(new Response("", { status: 404 }));

function sandboxFetch(codeowners = ok(sandboxCodeowners), mergeBox = ok(sandboxMergeBox)) {
  return routedFetch({
    [`${sandboxUrl}/codeowners`]: codeowners,
    [`${sandboxUrl}/merge_box`]: mergeBox,
  });
}

/** Node's fixtures, with its first review passed through `edit`. */
function nodeFetchWithReview(edit: (review: Record<string, unknown>) => void) {
  const mergeBox = JSON.parse(nodeMergeBox);
  edit(mergeBox.pullRequest.latestOpinionatedReviews[0]);

  return routedFetch({
    [`${nodeUrl}/codeowners`]: ok(nodeCodeowners),
    [`${nodeUrl}/merge_box`]: ok(JSON.stringify(mergeBox)),
  });
}

/** The sandbox's codeowners body with `edit` applied to `web/app.ts`'s entry. */
function editedCodeowners(edit: (entry: Record<string, unknown>) => void) {
  const json = JSON.parse(sandboxCodeowners);
  edit(json.ownershipByPath["web/app.ts"]);
  return ok(JSON.stringify(json));
}

/** The sandbox's merge_box body with `edit` applied. */
function editedMergeBox(edit: (pullRequest: Record<string, unknown>) => void) {
  const json = JSON.parse(sandboxMergeBox);
  edit(json.pullRequest);
  return ok(JSON.stringify(json));
}

function read(diff: DiffRef, fetchFn: typeof fetch): Promise<PrCodeOwners | undefined> {
  return readCodeOwners(diff, fetchFn, new AbortController().signal);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readCodeOwners", () => {
  it("reads each changed file's owners and the reviewers of the sandbox PR", async () => {
    const result = await read(sandbox, sandboxFetch());

    expect(result?.byPath.size).toBe(6);
    expect(result?.byPath.get("api/routes.ts")).toEqual({
      owners: [
        {
          token: "@excessive-dev/platform",
          url: "https://github.com/orgs/excessive-dev/teams/platform",
        },
        { token: "@sandbox-user", url: "https://github.com/sandbox-user" },
      ],
      ownedByViewer: true,
    });
    expect(result?.byPath.get("web/app.ts")?.owners.map((o) => o.token)).toEqual([
      "@excessive-dev/frontend",
    ]);
    expect(result?.byPath.get("web/app.ts")?.ownedByViewer).toBe(true);
    expect(result?.byPath.get("infra/deploy.yml")?.ownedByViewer).toBe(false);
    expect(result?.byPath.get("README.md")).toEqual({ owners: [], ownedByViewer: false });
    expect(result?.reviewers).toEqual(["@excessive-dev/frontend", "@excessive-dev/platform"]);
  });

  it("lists requested reviewers before those who reviewed", async () => {
    const result = await read(
      node,
      nodeFetchWithReview(() => {}),
    );

    expect(result?.reviewers).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
    expect(result?.byPath.get("test/cctest/test_node_crypto.cc")?.owners).toEqual([]);
    expect(result?.byPath.get("src/crypto/crypto_util.cc")?.owners.map((o) => o.token)).toEqual([
      "@nodejs/crypto",
    ]);
  });

  it("reads a repository without CODEOWNERS as no owners", async () => {
    const result = await read(sandbox, sandboxFetch(ok(noCodeowners)));

    expect(result?.byPath.size).toBe(0);
  });

  it("requests each endpoint once with the XHR header and the visit's signal", async () => {
    const fetchFn = sandboxFetch();
    const signal = new AbortController().signal;

    await readCodeOwners(sandbox, fetchFn, signal);

    const init = { headers: { "X-Requested-With": "XMLHttpRequest" }, signal };
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledWith(`${sandboxUrl}/codeowners`, init);
    expect(fetchFn).toHaveBeenCalledWith(`${sandboxUrl}/merge_box`, init);
  });

  it("reads nothing for a commit", async () => {
    const fetchFn = sandboxFetch();
    const commit: DiffRef = { kind: "commit", owner: "o", repo: "r", headSha: "dd95cdc" };

    const result = await read(commit, fetchFn);

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["codeowners answers 404", () => sandboxFetch(notFound)],
    ["merge_box answers 404", () => sandboxFetch(undefined, notFound)],
    ["codeowners answers HTML", () => sandboxFetch(ok("<html>"))],
    [
      "an entry's owners is a string",
      () =>
        sandboxFetch(
          editedCodeowners((entry) => {
            entry.owners = "@a";
          }),
        ),
    ],
    [
      "an entry lacks isOwnedByViewer",
      () =>
        sandboxFetch(
          editedCodeowners((entry) => {
            delete entry.isOwnedByViewer;
          }),
        ),
    ],
    [
      "an owner is a number",
      () =>
        sandboxFetch(
          editedCodeowners((entry) => {
            entry.owners = [7];
          }),
        ),
    ],
    [
      "pendingReviewRequests is missing",
      () =>
        sandboxFetch(
          undefined,
          editedMergeBox((pr) => {
            delete pr.pendingReviewRequests;
          }),
        ),
    ],
    [
      "ownershipByPath is an array",
      () => sandboxFetch(ok(JSON.stringify({ ownershipByPath: [] }))),
    ],
    [
      "latestOpinionatedReviews is missing",
      () =>
        sandboxFetch(
          undefined,
          editedMergeBox((pr) => {
            delete pr.latestOpinionatedReviews;
          }),
        ),
    ],
    [
      "a reviewer's login is a number",
      () =>
        sandboxFetch(
          undefined,
          editedMergeBox((pr) => {
            pr.pendingReviewRequests = [{ reviewer: { login: 7 } }];
          }),
        ),
    ],
  ])("reads nothing and warns once when %s", async (_, fetchFn) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await read(sandbox, fetchFn());

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads nothing and warns once when a review lacks onBehalfOf", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = nodeFetchWithReview((review) => {
      delete review.onBehalfOf;
    });

    const result = await read(node, fetchFn);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads nothing and stays quiet once the visit aborts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      Promise.reject(init?.signal?.reason),
    );

    const result = await readCodeOwners(sandbox, fetchFn, controller.signal);

    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips a deleted reviewer or review author", async () => {
    const mergeBox = JSON.parse(nodeMergeBox);
    mergeBox.pullRequest.pendingReviewRequests[0].reviewer = null;
    mergeBox.pullRequest.latestOpinionatedReviews[0].author = null;
    const fetchFn = routedFetch({
      [`${nodeUrl}/codeowners`]: ok(nodeCodeowners),
      [`${nodeUrl}/merge_box`]: ok(JSON.stringify(mergeBox)),
    });

    const result = await read(node, fetchFn);

    expect(result?.reviewers).toEqual(["@aduh95", "@richardlau"]);
  });

  it("counts a team a review was submitted on behalf of as a reviewer", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOf = [
        {
          login: "nodejs/crypto",
          name: "crypto",
          url: "https://github.com/orgs/nodejs/teams/crypto",
        },
      ];
    });

    const result = await read(node, fetchFn);

    const owner = result?.byPath.get("src/crypto/crypto_util.cc")?.owners[0];
    expect(result?.reviewers).toContain("@nodejs/crypto");
    expect(owner && isOwner("@nodejs/crypto", owner)).toBe(true);
  });

  it("skips an onBehalfOf entry without a login", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOf = [{ name: "crypto" }];
    });

    const result = await read(node, fetchFn);

    expect(result?.reviewers).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
  });

  it("skips an onBehalfOf entry whose login isn't org/slug", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOf = [{ login: "crypto" }];
    });

    const result = await read(node, fetchFn);

    expect(result?.reviewers).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
  });

  it("counts an Enterprise Managed User's review", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.author = { login: "mona-cat_octo" };
    });

    const result = await read(node, fetchFn);

    expect(result?.reviewers).toContain("@mona-cat_octo");
  });

  it("lists a reviewer both requested and reviewing once, ignoring case", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.author = { login: "Jasnell" };
    });

    const result = await read(node, fetchFn);

    expect(result?.reviewers).toEqual(["@jasnell", "@aduh95", "@richardlau"]);
  });
});

describe("codeOwnerOf", () => {
  it.each([
    ["@octocat", "https://github.com/octocat"],
    ["@github/docs-team", "https://github.com/orgs/github/teams/docs-team"],
    ["@org/team_name", "https://github.com/orgs/org/teams/team_name"],
    ["@mona-cat_octo", "https://github.com/mona-cat_octo"],
  ])("links %s", (token, url) => {
    expect(codeOwnerOf(token)).toEqual({ token, url });
  });

  it.each([
    "docs@example.com",
    "@",
    "@a/b/c",
    "@octo cat",
    "@org/te am",
    "@org/<script>",
    `@${"a".repeat(40)}`,
  ])("leaves %s unlinked", (token) => {
    expect(codeOwnerOf(token)).toEqual({ token });
  });
});

describe("isOwner", () => {
  it("matches the same team ignoring case", () => {
    expect(isOwner("@Excessive-Dev/Frontend", codeOwnerOf("@excessive-dev/frontend"))).toBe(true);
  });

  it.each([
    ["@sandbox-user", "@excessive-dev/frontend"],
    ["@jasnell", "@nodejs/crypto"],
    ["@jasnell", "jasnell@example.com"],
  ])("doesn't match %s to %s", (token, owner) => {
    expect(isOwner(token, codeOwnerOf(owner))).toBe(false);
  });
});

describe("ownedBy", () => {
  const paths = [
    "web/app.ts",
    "docs/guide.md",
    "api/routes.ts",
    "api/generated/client.ts",
    "infra/deploy.yml",
    "README.md",
    "notes/absent.md",
  ];

  it.each([
    ["@excessive-dev/frontend", ["web/app.ts", "api/generated/client.ts"]],
    ["@excessive-dev/platform", ["api/routes.ts", "infra/deploy.yml"]],
    ["@Sandbox-User", ["docs/guide.md", "api/routes.ts"]],
    ["@nobody", []],
  ])("keeps %s's files", async (token, kept) => {
    const owners = await read(sandbox, sandboxFetch());
    if (owners === undefined) throw new Error("the sandbox's read failed");

    const keep = ownedBy(owners, token);

    expect(paths.filter(keep)).toEqual(kept);
  });
});
