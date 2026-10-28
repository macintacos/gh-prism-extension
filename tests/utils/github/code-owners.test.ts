import { afterEach, describe, expect, it, vi } from "vitest";
import {
  codeOwnerOf,
  isOwner,
  ownerFilter,
  owningReviewers,
  type PrCodeOwners,
  readCodeOwners,
  readPrReviewers,
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

function readReviewers(
  diff: DiffRef,
  fetchFn: typeof fetch,
): Promise<readonly string[] | undefined> {
  return readPrReviewers(diff, fetchFn, new AbortController().signal);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([
  { name: "readCodeOwners", readFrom: readCodeOwners },
  { name: "readPrReviewers", readFrom: readPrReviewers },
])("$name", ({ readFrom }) => {
  it("reads nothing for a commit", async () => {
    const fetchFn = sandboxFetch();
    const commit: DiffRef = { kind: "commit", owner: "o", repo: "r", headSha: "dd95cdc" };

    const result = await readFrom(commit, fetchFn, new AbortController().signal);

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads nothing and stays quiet once the visit aborts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const controller = new AbortController();
    controller.abort();
    const fetchFn = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      Promise.reject(init?.signal?.reason),
    );

    const result = await readFrom(sandbox, fetchFn, controller.signal);

    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("readCodeOwners", () => {
  it("reads each changed file's owners in the sandbox PR", async () => {
    const result = await read(sandbox, sandboxFetch());

    expect(result?.size).toBe(6);
    expect(result?.get("api/routes.ts")).toEqual({
      owners: [
        {
          token: "@excessive-dev/platform",
          url: "https://github.com/orgs/excessive-dev/teams/platform",
        },
        { token: "@sandbox-user", url: "https://github.com/sandbox-user" },
      ],
      ownedByViewer: true,
    });
    expect(result?.get("web/app.ts")?.owners.map((o) => o.token)).toEqual([
      "@excessive-dev/frontend",
    ]);
    expect(result?.get("web/app.ts")?.ownedByViewer).toBe(true);
    expect(result?.get("infra/deploy.yml")?.ownedByViewer).toBe(false);
    expect(result?.get("README.md")).toEqual({ owners: [], ownedByViewer: false });
  });

  it("reads a repository without CODEOWNERS as no owners", async () => {
    const result = await read(sandbox, sandboxFetch(ok(noCodeowners)));

    expect(result?.size).toBe(0);
  });

  it("requests codeowners once with the XHR header and the visit's signal", async () => {
    const fetchFn = sandboxFetch();
    const signal = new AbortController().signal;

    await readCodeOwners(sandbox, fetchFn, signal);

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(`${sandboxUrl}/codeowners`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal,
    });
  });

  it.each([
    ["answers 404", notFound],
    [
      "answers an unexpected shape",
      editedMergeBox((pr) => {
        delete pr.pendingReviewRequests;
      }),
    ],
    ["never answers", () => new Promise<Response>(() => {})],
  ])("reads the owners, quietly, when merge_box %s", async (_, mergeBox) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await read(sandbox, sandboxFetch(undefined, mergeBox));

    expect(result?.size).toBe(6);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["codeowners answers 404", notFound],
    ["codeowners answers HTML", ok("<html>")],
    [
      "an entry's owners is a string",
      editedCodeowners((entry) => {
        entry.owners = "@a";
      }),
    ],
    [
      "an entry lacks isOwnedByViewer",
      editedCodeowners((entry) => {
        delete entry.isOwnedByViewer;
      }),
    ],
    [
      "an owner is a number",
      editedCodeowners((entry) => {
        entry.owners = [7];
      }),
    ],
    ["ownershipByPath is an array", ok(JSON.stringify({ ownershipByPath: [] }))],
  ])("reads nothing and warns once of the code owners when %s", async (_, codeowners) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await read(sandbox, sandboxFetch(codeowners));

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("code owners"),
      expect.any(Error),
    );
  });
});

describe("readPrReviewers", () => {
  it("reads the sandbox PR's reviewers", async () => {
    const result = await readReviewers(sandbox, sandboxFetch());

    expect(result).toEqual(["@excessive-dev/frontend", "@excessive-dev/platform"]);
  });

  it("lists requested reviewers before those who reviewed", async () => {
    const result = await readReviewers(
      node,
      nodeFetchWithReview(() => {}),
    );

    expect(result).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
  });

  it("requests merge_box once with the XHR header and the visit's signal", async () => {
    const fetchFn = sandboxFetch();
    const signal = new AbortController().signal;

    await readPrReviewers(sandbox, fetchFn, signal);

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(`${sandboxUrl}/merge_box`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal,
    });
  });

  it.each([
    ["merge_box answers 404", notFound],
    [
      "pendingReviewRequests is missing",
      editedMergeBox((pr) => {
        delete pr.pendingReviewRequests;
      }),
    ],
    [
      "latestOpinionatedReviews is missing",
      editedMergeBox((pr) => {
        delete pr.latestOpinionatedReviews;
      }),
    ],
    [
      "a reviewer's login is a number",
      editedMergeBox((pr) => {
        pr.pendingReviewRequests = [{ reviewer: { login: 7 } }];
      }),
    ],
  ])("reads nothing and warns once of the PR reviewers when %s", async (_, mergeBox) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await readReviewers(sandbox, sandboxFetch(undefined, mergeBox));

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("PR reviewers"),
      expect.any(Error),
    );
  });

  it("reads nothing and warns once when a review lacks onBehalfOf", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = nodeFetchWithReview((review) => {
      delete review.onBehalfOf;
    });

    const result = await readReviewers(node, fetchFn);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("skips a deleted reviewer or review author", async () => {
    const mergeBox = JSON.parse(nodeMergeBox);
    mergeBox.pullRequest.pendingReviewRequests[0].reviewer = null;
    mergeBox.pullRequest.latestOpinionatedReviews[0].author = null;
    const fetchFn = routedFetch({ [`${nodeUrl}/merge_box`]: ok(JSON.stringify(mergeBox)) });

    const result = await readReviewers(node, fetchFn);

    expect(result).toEqual(["@aduh95", "@richardlau"]);
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

    const reviewers = await readReviewers(node, fetchFn);
    const owners = await read(node, fetchFn);

    const owner = owners?.get("src/crypto/crypto_util.cc")?.owners[0];
    expect(reviewers).toContain("@nodejs/crypto");
    expect(owner && isOwner("@nodejs/crypto", owner)).toBe(true);
  });

  it("skips an onBehalfOf entry without a login", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOf = [{ name: "crypto" }];
    });

    const result = await readReviewers(node, fetchFn);

    expect(result).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
  });

  it("skips an onBehalfOf entry whose login isn't org/slug", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOf = [{ login: "crypto" }];
    });

    const result = await readReviewers(node, fetchFn);

    expect(result).toEqual(["@jasnell", "@aduh95", "@pimterry", "@richardlau"]);
  });

  it("counts an Enterprise Managed User's review", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.author = { login: "mona-cat_octo" };
    });

    const result = await readReviewers(node, fetchFn);

    expect(result).toContain("@mona-cat_octo");
  });

  it("lists a reviewer both requested and reviewing once, ignoring case", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.author = { login: "Jasnell" };
    });

    const result = await readReviewers(node, fetchFn);

    expect(result).toEqual(["@jasnell", "@aduh95", "@richardlau"]);
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

describe("ownerFilter", () => {
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

    const keep = ownerFilter(owners, token);

    expect(paths.filter(keep)).toEqual(kept);
  });
});

describe("owningReviewers", () => {
  /** Code owners mapping each path to the owner tokens given. */
  function ownedBy(byPath: Record<string, string[]>): PrCodeOwners {
    return new Map(
      Object.entries(byPath).map(([path, tokens]) => [
        path,
        { owners: tokens.map(codeOwnerOf), ownedByViewer: false },
      ]),
    );
  }

  it("keeps the sandbox's owning reviewers", async () => {
    const owners = await read(sandbox, sandboxFetch());
    const reviewers = await readReviewers(sandbox, sandboxFetch());
    if (owners === undefined || reviewers === undefined)
      throw new Error("the sandbox's read failed");

    expect(owningReviewers(reviewers, owners, "sandbox-user")).toEqual([
      "@excessive-dev/frontend",
      "@excessive-dev/platform",
    ]);
  });

  it("leaves out a reviewer who owns no changed path, keeping reviewer order", () => {
    const owners = ownedBy({ "a.ts": ["@o/a"], "b.ts": ["@o/b"] });

    expect(owningReviewers(["@o/b", "@idle", "@o/a"], owners, undefined)).toEqual(["@o/b", "@o/a"]);
  });

  it.each(["sandbox-user", "Sandbox-User"])("leaves out the viewer %s", (viewer) => {
    const owners = ownedBy({ "a.ts": ["@o/a", "@sandbox-user"] });

    expect(owningReviewers(["@sandbox-user", "@o/a"], owners, viewer)).toEqual(["@o/a"]);
  });

  it("keeps the viewer's login when the viewer is unknown", () => {
    const owners = ownedBy({ "a.ts": ["@sandbox-user"] });

    expect(owningReviewers(["@sandbox-user"], owners, undefined)).toEqual(["@sandbox-user"]);
  });

  it("keeps no reviewer in a repository without CODEOWNERS", async () => {
    const owners = await read(sandbox, sandboxFetch(ok(noCodeowners)));
    const reviewers = await readReviewers(sandbox, sandboxFetch());
    if (owners === undefined || reviewers === undefined)
      throw new Error("the sandbox's read failed");

    expect(reviewers).not.toEqual([]);
    expect(owningReviewers(reviewers, owners, undefined)).toEqual([]);
  });
});
