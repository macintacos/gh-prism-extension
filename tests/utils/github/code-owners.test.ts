import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  codeOwnerOf,
  isOwner,
  ownerFilter,
  owningReviewers,
  owningTeams,
  type PrCodeOwners,
  type PrReviewer,
  readCodeOwners,
  readPrReviewers,
  readTeamMembers,
  teamMembersReader,
  withMemberTeams,
} from "../../../utils/github/code-owners";
import type { DiffRef } from "../../../utils/github/pr-ref";
import nodeCodeowners from "../../fixtures/codeowners-node.json?raw";
import noCodeowners from "../../fixtures/codeowners-none.json?raw";
import sandboxCodeowners from "../../fixtures/codeowners-sandbox.json?raw";
import { routedFetch } from "../../fixtures/fetch";
import nodeReviewRequests from "../../fixtures/review-requests-node.json?raw";
import sandboxReviewRequests from "../../fixtures/review-requests-sandbox.json?raw";
import sandboxTeamMembers from "../../fixtures/team-members-sandbox.json?raw";

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

function sandboxFetch(
  codeowners = ok(sandboxCodeowners),
  reviewRequests = ok(sandboxReviewRequests),
) {
  return routedFetch({
    [`${sandboxUrl}/codeowners`]: codeowners,
    [`${sandboxUrl}/review_requests`]: reviewRequests,
  });
}

type Json = Record<string, unknown>;

/** Node's fixtures, with its review_requests body passed through `edit`. */
function nodeFetchWith(
  edit: (body: { pendingReviewRequests: Json[]; completedReviews: Json[] }) => void,
) {
  const reviewRequests = JSON.parse(nodeReviewRequests);
  edit(reviewRequests);

  return routedFetch({
    [`${nodeUrl}/codeowners`]: ok(nodeCodeowners),
    [`${nodeUrl}/review_requests`]: ok(JSON.stringify(reviewRequests)),
  });
}

/** Node's fixtures, with its first review, pimterry's, passed through `edit`. */
const nodeFetchWithReview = (edit: (review: Json) => void) =>
  nodeFetchWith(({ completedReviews }) => edit(completedReviews[0] ?? {}));

/** Node's code owners and PR reviewers, read through `fetchFn`; throws if either read fails. */
async function readNode(fetchFn: typeof fetch) {
  const owners = await read(node, fetchFn);
  const reviewers = await readReviewers(node, fetchFn);
  if (owners === undefined || reviewers === undefined) throw new Error("node's read failed");
  return { owners, reviewers };
}

/** Node's code owners and PR reviewers, with pimterry's review on behalf of nodejs/crypto. */
const readNodeReviewedForCrypto = () =>
  readNode(
    nodeFetchWithReview((review) => {
      review.onBehalfOfTeams = [team("nodejs/crypto")];
    }),
  );

/** A team as review_requests names one, `org/slug`. */
const team = (displayLogin: string) => ({ displayLogin, name: "", reviewerType: "Team" });

/** The sandbox's codeowners body with `edit` applied to `web/app.ts`'s entry. */
function editedCodeowners(edit: (entry: Record<string, unknown>) => void) {
  const json = JSON.parse(sandboxCodeowners);
  edit(json.ownershipByPath["web/app.ts"]);
  return ok(JSON.stringify(json));
}

/** The sandbox's review_requests body with `edit` applied. */
function editedReviewRequests(edit: (body: Json) => void) {
  const json = JSON.parse(sandboxReviewRequests);
  edit(json);
  return ok(JSON.stringify(json));
}

function read(diff: DiffRef, fetchFn: typeof fetch): Promise<PrCodeOwners | undefined> {
  return readCodeOwners(diff, fetchFn, new AbortController().signal);
}

function readReviewers(
  diff: DiffRef,
  fetchFn: typeof fetch,
): Promise<readonly PrReviewer[] | undefined> {
  return readPrReviewers(diff, fetchFn, new AbortController().signal);
}

/** The tokens of the reviewers `fetchFn` reads for `diff`. */
const tokensRead = async (diff: DiffRef, fetchFn: typeof fetch) =>
  (await readReviewers(diff, fetchFn))?.map(({ token }) => token);

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
      editedReviewRequests((body) => {
        body.pendingReviewRequests = "none";
      }),
    ],
    ["never answers", () => new Promise<Response>(() => {})],
  ])("reads the owners, quietly, when review_requests %s", async (_, reviewRequests) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await read(sandbox, sandboxFetch(undefined, reviewRequests));

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
  it("reads the sandbox PR's requested teams as code owners", async () => {
    const result = await readReviewers(sandbox, sandboxFetch());

    expect(result).toEqual([
      { token: "@excessive-dev/frontend", teams: [], codeOwner: true },
      { token: "@excessive-dev/platform", teams: [], codeOwner: true },
    ]);
  });

  it("lists requested reviewers before those who reviewed", async () => {
    const result = await readReviewers(
      node,
      nodeFetchWith(() => {}),
    );

    expect(result).toEqual([
      { token: "@jasnell", teams: [], codeOwner: false },
      { token: "@aduh95", teams: [], codeOwner: false },
      { token: "@pimterry", teams: [], codeOwner: false },
      { token: "@richardlau", teams: [], codeOwner: false },
    ]);
  });

  it("reads a PR with no requests or reviews as no reviewers", async () => {
    const fetchFn = routedFetch({ [`${nodeUrl}/review_requests`]: ok("{}") });

    const result = await readReviewers(node, fetchFn);

    expect(result).toEqual([]);
  });

  it("requests review_requests once with the XHR header and the visit's signal", async () => {
    const fetchFn = sandboxFetch();
    const signal = new AbortController().signal;

    await readPrReviewers(sandbox, fetchFn, signal);

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(`${sandboxUrl}/review_requests`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal,
    });
  });

  it.each([
    ["review_requests answers 404", notFound],
    ["review_requests answers a list", ok("[]")],
    [
      "pendingReviewRequests isn't a list",
      editedReviewRequests((body) => {
        body.pendingReviewRequests = {};
      }),
    ],
    [
      "completedReviews isn't a list",
      editedReviewRequests((body) => {
        body.completedReviews = "none";
      }),
    ],
    [
      "a reviewer's displayLogin is a number",
      editedReviewRequests((body) => {
        body.pendingReviewRequests = [{ reviewer: { displayLogin: 7 } }];
      }),
    ],
    [
      "a review's onBehalfOfTeams isn't a list",
      editedReviewRequests((body) => {
        body.completedReviews = [{ reviewer: { displayLogin: "a" }, onBehalfOfTeams: {} }];
      }),
    ],
  ])("reads nothing and warns once of the PR reviewers when %s", async (_, reviewRequests) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await readReviewers(sandbox, sandboxFetch(undefined, reviewRequests));

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("PR reviewers"),
      expect.any(Error),
    );
  });

  it("skips a deleted reviewer", async () => {
    const fetchFn = nodeFetchWith(({ pendingReviewRequests, completedReviews }) => {
      delete pendingReviewRequests[0]?.reviewer;
      if (completedReviews[0]) completedReviews[0].reviewer = null;
    });

    const result = await tokensRead(node, fetchFn);

    expect(result).toEqual(["@aduh95", "@richardlau"]);
  });

  it("names the teams a review was on behalf of", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOfTeams = [team("nodejs/crypto"), team("nodejs/security-wg")];
    });

    const result = await readReviewers(node, fetchFn);

    expect(result?.find(({ token }) => token === "@pimterry")?.teams).toEqual([
      "@nodejs/crypto",
      "@nodejs/security-wg",
    ]);
  });

  it("names the team a code owner's request was assigned from", async () => {
    const fetchFn = nodeFetchWith(({ pendingReviewRequests: [jasnell] }) => {
      Object.assign(jasnell ?? {}, {
        delegatedFromTeam: team("nodejs/crypto"),
        isCodeOwner: true,
        isCodeOwnerFromDelegation: true,
      });
    });

    const [result] = (await readReviewers(node, fetchFn)) ?? [];

    expect(result).toEqual({ token: "@jasnell", teams: ["@nodejs/crypto"], codeOwner: true });
  });

  it("marks a code owner GitHub names no team for", async () => {
    const fetchFn = nodeFetchWith(({ pendingReviewRequests: [jasnell] }) => {
      Object.assign(jasnell ?? {}, { isCodeOwner: true });
    });

    const [result] = (await readReviewers(node, fetchFn)) ?? [];

    expect(result).toEqual({ token: "@jasnell", teams: [], codeOwner: true });
  });

  it("counts a reviewer who only commented", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.state = "REVIEW_STATE_COMMENTED";
    });

    const result = await tokensRead(node, fetchFn);

    expect(result).toContain("@pimterry");
  });

  it("skips a team whose displayLogin isn't org/slug", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.onBehalfOfTeams = [team("crypto"), { name: "crypto" }];
    });

    const result = await readReviewers(node, fetchFn);

    expect(result?.find(({ token }) => token === "@pimterry")?.teams).toEqual([]);
  });

  it("counts an Enterprise Managed User's review", async () => {
    const fetchFn = nodeFetchWithReview((review) => {
      review.reviewer = { displayLogin: "mona-cat_octo", reviewerType: "User" };
    });

    const result = await tokensRead(node, fetchFn);

    expect(result).toContain("@mona-cat_octo");
  });

  it("lists a reviewer both requested and reviewing once, ignoring case, with both's teams", async () => {
    const fetchFn = nodeFetchWith(
      ({ pendingReviewRequests: [jasnell], completedReviews: [review] }) => {
        Object.assign(jasnell ?? {}, {
          delegatedFromTeam: team("nodejs/crypto"),
          isCodeOwner: true,
        });
        Object.assign(review ?? {}, {
          reviewer: { displayLogin: "Jasnell", reviewerType: "User" },
          onBehalfOfTeams: [team("nodejs/crypto"), team("nodejs/security-wg")],
        });
      },
    );

    const result = await readReviewers(node, fetchFn);

    expect(result?.map(({ token }) => token)).toEqual(["@jasnell", "@aduh95", "@richardlau"]);
    expect(result?.[0]).toEqual({
      token: "@jasnell",
      teams: ["@nodejs/crypto", "@nodejs/security-wg"],
      codeOwner: true,
    });
  });
});

describe("readTeamMembers", () => {
  const frontendUrl = "https://github.com/orgs/excessive-dev/teams/frontend/members";
  const readMembers = (fetchFn: typeof fetch) =>
    readTeamMembers("@excessive-dev/frontend", fetchFn, new AbortController().signal);

  it("reads a team's members as JSON with the visit's signal", async () => {
    const fetchFn = routedFetch({ [frontendUrl]: ok(sandboxTeamMembers) });
    const signal = new AbortController().signal;

    const result = await readTeamMembers("@excessive-dev/frontend", fetchFn, signal);

    expect(result).toEqual({ total: 1, members: ["sandbox-user"] });
    expect(fetchFn).toHaveBeenCalledExactlyOnceWith(frontendUrl, {
      headers: { Accept: "application/json" },
      signal,
    });
  });

  it("counts the listed members when the answer gives no total", async () => {
    const fetchFn = routedFetch({ [frontendUrl]: ok(JSON.stringify({ members: ["a", "b"] })) });

    const result = await readMembers(fetchFn);

    expect(result).toEqual({ total: 2, members: ["a", "b"] });
  });

  it("reads nothing, quietly, from a team the viewer can't see", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await readMembers(routedFetch({ [frontendUrl]: notFound }));

    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads nothing and warns once when members isn't a list of logins", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = routedFetch({ [frontendUrl]: ok(JSON.stringify({ members: [7] })) });

    const result = await readMembers(fetchFn);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads nothing for a token that isn't a team", async () => {
    const fetchFn = routedFetch({});

    const result = await readTeamMembers("@octocat", fetchFn, new AbortController().signal);

    expect(result).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("teamMembersReader", () => {
  const teamUrl = (slug: string) => `https://github.com/orgs/o/teams/${slug}/members`;

  it("reads a team once however its token is cased", async () => {
    const fetchFn = vi.fn(async () => new Response(sandboxTeamMembers));
    const teamMembers = teamMembersReader(fetchFn, new AbortController().signal);

    const [first, second] = await Promise.all([teamMembers("@O/Team"), teamMembers("@o/team")]);

    expect(second).toBe(first);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("reads each different team once", async () => {
    const fetchFn = routedFetch({
      [teamUrl("a")]: ok(sandboxTeamMembers),
      [teamUrl("b")]: ok(sandboxTeamMembers),
    });
    const teamMembers = teamMembersReader(fetchFn, new AbortController().signal);

    await Promise.all([teamMembers("@o/a"), teamMembers("@o/b"), teamMembers("@o/a")]);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("reads with the visit's signal", async () => {
    const fetchFn = routedFetch({ [teamUrl("a")]: ok(sandboxTeamMembers) });
    const signal = new AbortController().signal;

    await teamMembersReader(fetchFn, signal)("@o/a");

    expect(fetchFn).toHaveBeenCalledWith(teamUrl("a"), expect.objectContaining({ signal }));
  });
});

describe("owningTeams", () => {
  it("lists each team among the owners once, first seen first", () => {
    const owners = ["@octocat", "@o/a", "@O/A", "@o/b", "dev@example.com"].map(codeOwnerOf);

    expect(owningTeams(owners)).toEqual(["@o/a", "@o/b"]);
  });
});

describe("withMemberTeams", () => {
  const owners: PrCodeOwners = new Map([
    ["web/app.ts", { owners: [codeOwnerOf("@o/frontend")], ownedByViewer: false }],
    ["infra/main.tf", { owners: [codeOwnerOf("@o/platform")], ownedByViewer: false }],
    ["docs/guide.md", { owners: [codeOwnerOf("@ada")], ownedByViewer: false }],
  ]);
  const reviewer = (token: string, extra: Partial<PrReviewer> = {}): PrReviewer => ({
    token,
    teams: [],
    codeOwner: false,
    ...extra,
  });
  /** Members by team: `@o/frontend` lists `@Grace`, every other team no one. */
  const readMembers = vi.fn(async (team: string) => (team === "@o/frontend" ? ["Grace"] : []));

  beforeEach(() => readMembers.mockClear());

  it("adds each owning team that lists a reviewer who owns nothing yet", async () => {
    const reviewers = [reviewer("@o/platform"), reviewer("@grace", { codeOwner: true })];

    const result = await withMemberTeams(reviewers, owners, readMembers);

    expect(result).toEqual([
      reviewer("@o/platform"),
      reviewer("@grace", { codeOwner: true, teams: ["@o/frontend"] }),
    ]);
  });

  it("adds each owning team that lists a reviewer who owns files directly", async () => {
    const reviewers = [reviewer("@ada", { codeOwner: true })];

    const result = await withMemberTeams(reviewers, owners, async (team) =>
      team === "@o/frontend" ? ["ada"] : [],
    );

    expect(result).toEqual([reviewer("@ada", { codeOwner: true, teams: ["@o/frontend"] })]);
  });

  it("names a team a reviewer already reviews for once, ignoring case", async () => {
    const reviewers = [reviewer("@grace", { teams: ["@O/Frontend"] })];

    const result = await withMemberTeams(reviewers, owners, readMembers);

    expect(result).toEqual(reviewers);
  });

  it("asks each owning team once, ignoring case", async () => {
    const sharedTeams: PrCodeOwners = new Map([
      ...owners,
      [
        "web/index.ts",
        { owners: [codeOwnerOf("@o/frontend"), codeOwnerOf("@o/platform")], ownedByViewer: false },
      ],
      ["web/style.css", { owners: [codeOwnerOf("@O/Frontend")], ownedByViewer: false }],
    ]);

    await withMemberTeams([reviewer("@grace", { codeOwner: true })], sharedTeams, readMembers);

    expect(readMembers.mock.calls.map(([team]) => team.toLowerCase()).sort()).toEqual([
      "@o/frontend",
      "@o/platform",
    ]);
  });

  it("names a team listed in two spellings by the first one", async () => {
    const twoSpellings: PrCodeOwners = new Map([
      ["web/app.ts", { owners: [codeOwnerOf("@o/frontend")], ownedByViewer: false }],
      ["web/style.css", { owners: [codeOwnerOf("@O/Frontend")], ownedByViewer: false }],
    ]);

    const result = await withMemberTeams(
      [reviewer("@grace", { codeOwner: true })],
      twoSpellings,
      readMembers,
    );

    expect(result).toEqual([reviewer("@grace", { codeOwner: true, teams: ["@o/frontend"] })]);
  });

  it("asks nothing when GitHub shows the viewer no team among the PR reviewers", async () => {
    const reviewers = [reviewer("@grace"), reviewer("@linus")];

    const result = await withMemberTeams(reviewers, owners, readMembers);

    expect(result).toEqual(reviewers);
    expect(readMembers).not.toHaveBeenCalled();
  });

  it("adds nothing from a team whose members can't be read", async () => {
    const reviewers = [reviewer("@grace", { codeOwner: true })];

    const result = await withMemberTeams(reviewers, owners, async () => undefined);

    expect(result).toEqual(reviewers);
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

    const keep = ownerFilter(owners, token, []);

    expect(paths.filter(keep)).toEqual(kept);
  });

  it("keeps the files of the teams a reviewer reviewed for, and only those", async () => {
    const { owners, reviewers } = await readNodeReviewedForCrypto();

    const keep = ownerFilter(owners, "@PimTerry", reviewers);

    expect([...owners.keys()].filter(keep).sort()).toEqual([
      "src/crypto/crypto_context.cc",
      "src/crypto/crypto_context.h",
      "src/crypto/crypto_hash.cc",
      "src/crypto/crypto_rsa.cc",
      "src/crypto/crypto_tls.cc",
      "src/crypto/crypto_util.cc",
    ]);
  });

  it("keeps no files of a reviewer who reviewed for no team", async () => {
    const { owners, reviewers } = await readNode(nodeFetchWith(() => {}));

    const keep = ownerFilter(owners, "@pimterry", reviewers);

    expect([...owners.keys()].filter(keep)).toEqual([]);
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

  /** PR reviewers with `tokens`, reviewing for no team. */
  const reviewersOf = (...tokens: string[]): PrReviewer[] =>
    tokens.map((token) => ({ token, teams: [], codeOwner: false }));

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

  it("keeps a reviewer who owns files only through a team they reviewed for", async () => {
    const { owners, reviewers } = await readNodeReviewedForCrypto();

    expect(owningReviewers(reviewers, owners, undefined)).toEqual(["@pimterry"]);
  });

  it("leaves out a reviewer who owns no changed path, keeping reviewer order", () => {
    const owners = ownedBy({ "a.ts": ["@o/a"], "b.ts": ["@o/b"] });

    expect(owningReviewers(reviewersOf("@o/b", "@idle", "@o/a"), owners, undefined)).toEqual([
      "@o/b",
      "@o/a",
    ]);
  });

  it("leaves out a code owner whose files GitHub doesn't show the viewer", () => {
    const owners = ownedBy({ "a.ts": ["@o/a"] });

    expect(
      owningReviewers([{ token: "@hidden", teams: [], codeOwner: true }], owners, undefined),
    ).toEqual([]);
  });

  it.each(["sandbox-user", "Sandbox-User"])("leaves out the viewer %s", (viewer) => {
    const owners = ownedBy({ "a.ts": ["@o/a", "@sandbox-user"] });

    expect(owningReviewers(reviewersOf("@sandbox-user", "@o/a"), owners, viewer)).toEqual(["@o/a"]);
  });

  it("keeps the viewer's login when the viewer is unknown", () => {
    const owners = ownedBy({ "a.ts": ["@sandbox-user"] });

    expect(owningReviewers(reviewersOf("@sandbox-user"), owners, undefined)).toEqual([
      "@sandbox-user",
    ]);
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
