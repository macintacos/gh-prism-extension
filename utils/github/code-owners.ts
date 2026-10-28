import { at, type DiffRef } from "./pr-ref";

/** A code owner: its CODEOWNERS token as written, and the GitHub page it names, if any. */
export interface CodeOwner {
  token: string;
  /** A `@user`'s profile or an `@org/team`'s team page; absent for any other token. */
  url?: string;
}

/** One changed file's code owners, in CODEOWNERS order, and whether you own it. */
export interface FileOwners {
  owners: readonly CodeOwner[];
  /** True when you own the file yourself or through a team. */
  ownedByViewer: boolean;
}

/** A pull request's code owners by changed path, and its reviewers. */
export interface PrCodeOwners {
  /** Empty in a repository without CODEOWNERS; a path missing from it has no owners. */
  byPath: ReadonlyMap<string, FileOwners>;
  /**
   * The `@user` and `@org/team` tokens of everyone requested to review or who has reviewed, each
   * once. GitHub lists only approving and change-requesting reviews, so a reviewer who only
   * commented is missing.
   */
  reviewers: readonly string[];
}

const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const TEAM_SLUG = /^[A-Za-z0-9_-]+$/;

/** `token`, linked when it is a `@user` or `@org/team` with only the characters GitHub allows. */
export function codeOwnerOf(token: string): CodeOwner {
  const [login, team, ...rest] = token.startsWith("@") ? token.slice(1).split("/") : [];
  if (login === undefined || !LOGIN.test(login) || rest.length > 0) return { token };
  if (team === undefined) return { token, url: `https://github.com/${login}` };
  return TEAM_SLUG.test(team)
    ? { token, url: `https://github.com/orgs/${login}/teams/${team}` }
    : { token };
}

/** Whether `reviewer`'s token names `owner`: the same user or the same team, ignoring case. */
export function isOwner(reviewer: string, owner: CodeOwner): boolean {
  return reviewer.toLowerCase() === owner.token.toLowerCase();
}

/**
 * A pull request's code owners and reviewers, from the `page_data` endpoints its Files changed
 * page reads, one request each; `undefined` for a commit, or once either read fails or answers an
 * unexpected shape.
 */
export async function readCodeOwners(
  diff: DiffRef,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<PrCodeOwners | undefined> {
  if (diff.kind !== "pr") return undefined;
  const base = `https://github.com/${diff.owner}/${diff.repo}/pull/${diff.number}/page_data`;

  try {
    const [codeowners, mergeBox] = await Promise.all(
      ["codeowners", "merge_box"].map((name) => pageData(`${base}/${name}`, fetchFn, signal)),
    );
    const byPath = byPathFrom(codeowners);
    const reviewers = reviewersFrom(mergeBox);
    if (byPath === undefined || reviewers === undefined) throw new Error("unexpected shape");
    return { byPath, reviewers };
  } catch (error) {
    if (!signal.aborted) console.warn("gh-prism: couldn't read code owners; showing none", error);
    return undefined;
  }
}

async function pageData(url: string, fetchFn: typeof fetch, signal: AbortSignal): Promise<unknown> {
  // Without this header the endpoints answer 406 with HTML.
  const response = await fetchFn(url, {
    headers: { "X-Requested-With": "XMLHttpRequest" },
    signal,
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

function byPathFrom(json: unknown): Map<string, FileOwners> | undefined {
  const ownership = at(json, "ownershipByPath");
  if (typeof ownership !== "object" || ownership === null || Array.isArray(ownership)) {
    return undefined;
  }

  const byPath = new Map<string, FileOwners>();
  for (const [path, entry] of Object.entries(ownership)) {
    const owners = at(entry, "owners");
    const ownedByViewer = at(entry, "isOwnedByViewer");
    if (!isStrings(owners) || typeof ownedByViewer !== "boolean") return undefined;
    byPath.set(path, { owners: owners.map(codeOwnerOf), ownedByViewer });
  }
  return byPath;
}

function reviewersFrom(json: unknown): string[] | undefined {
  const requests = at(json, "pullRequest", "pendingReviewRequests");
  const reviews = at(json, "pullRequest", "latestOpinionatedReviews");
  if (!Array.isArray(requests) || !Array.isArray(reviews)) return undefined;

  const logins: unknown[] = requests.map((request) => at(request, "reviewer"));
  for (const review of reviews) {
    const onBehalfOf = at(review, "onBehalfOf");
    if (!Array.isArray(onBehalfOf)) return undefined;
    // The elements' shape is unobserved: read like `pendingReviewRequests`' teams, skip the rest.
    const teams = onBehalfOf.filter((team) => typeof at(team, "login") === "string");
    logins.push(at(review, "author"), ...teams);
  }

  const reviewers = new Map<string, string>();
  for (const account of logins) {
    if (account === null) continue;
    const login = at(account, "login");
    if (typeof login !== "string") return undefined;
    const token = `@${login}`;
    if (codeOwnerOf(token).url && !reviewers.has(token.toLowerCase())) {
      reviewers.set(token.toLowerCase(), token);
    }
  }
  return [...reviewers.values()];
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
