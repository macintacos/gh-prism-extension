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

/**
 * A pull request's code owners by changed path. Empty in a repository without CODEOWNERS; a path
 * missing from it has no owners.
 */
export type PrCodeOwners = ReadonlyMap<string, FileOwners>;

const LOGIN = /^[A-Za-z0-9_-]{1,39}$/;
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

/** A PR reviewer, and the teams GitHub tells the viewer they review for. */
export interface PrReviewer {
  /** `@user` or `@org/team`. */
  readonly token: string;
  /**
   * The `@org/team` tokens of the teams one of their reviews was on behalf of, or their pending
   * request was assigned from. GitHub names a team only to a viewer who can see it.
   */
  readonly teams: readonly string[];
  /** Whether GitHub marks their pending request as a code owner's, even without naming a team. */
  readonly codeOwner: boolean;
}

/** Whether `token` names `owner`: the same user or the same team, ignoring case. */
export function isOwner(token: string, owner: CodeOwner): boolean {
  return token.toLowerCase() === owner.token.toLowerCase();
}

/** The PR reviewer in `reviewers` whose token is `token`, ignoring case. */
export const reviewerOf = (
  reviewers: readonly PrReviewer[],
  token: string,
): PrReviewer | undefined => reviewers.find((reviewer) => isOwner(token, reviewer));

/**
 * A filter keeping the changed files one of whose code owners in `codeOwners` is `token`, or a
 * team the PR reviewer `token` reviews for in `reviewers`, ignoring case; a path with no owners,
 * or missing from `codeOwners`, is dropped.
 */
export function ownerFilter(
  codeOwners: PrCodeOwners,
  token: string,
  reviewers: readonly PrReviewer[],
): (path: string) => boolean {
  const tokens = [token, ...(reviewerOf(reviewers, token)?.teams ?? [])];
  return (path) =>
    codeOwners.get(path)?.owners.some((owner) => tokens.some((t) => isOwner(t, owner))) ?? false;
}

/**
 * The tokens of the PR reviewers in `reviewers` who own at least one changed file in
 * `codeOwners`, directly or through a team they review for, in reviewer order, leaving out
 * `viewer`'s own `@login`, since GitHub's "Only files owned by you" stands for the viewer; a team
 * the viewer belongs to stays, since its files differ from the viewer's.
 */
export function owningReviewers(
  reviewers: readonly PrReviewer[],
  codeOwners: PrCodeOwners,
  viewer: string | undefined,
): string[] {
  const paths = [...codeOwners.keys()];
  return reviewers
    .map(({ token }) => token)
    .filter(
      (token) =>
        !(viewer !== undefined && isOwner(token, { token: `@${viewer}` })) &&
        paths.some(ownerFilter(codeOwners, token, reviewers)),
    );
}

/**
 * A pull request's code owners, from the `page_data/codeowners` endpoint its Files changed page
 * reads, in one request; `undefined` for a commit, or once the read fails or answers an unexpected
 * shape. Never rejects; logs one warning on a failed read unless `signal` aborted.
 */
export function readCodeOwners(
  diff: DiffRef,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<PrCodeOwners | undefined> {
  return readPageData(
    diff,
    { endpoint: "codeowners", parse: byPathFrom, what: "code owners" },
    fetchFn,
    signal,
  );
}

/**
 * A pull request's requested reviewers, then those who reviewed it, commenting included, in
 * GitHub's order, each once with every team GitHub names for them, from the
 * `page_data/review_requests` endpoint its Reviewers sidebar reads, in one request. Only `@user`
 * and `@org/team` reviewers count. `undefined` for a commit, or once the read fails or answers an
 * unexpected shape. Never rejects; logs one warning on a failed read unless `signal` aborted.
 */
export function readPrReviewers(
  diff: DiffRef,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<readonly PrReviewer[] | undefined> {
  return readPageData(
    diff,
    { endpoint: "review_requests", parse: reviewersFrom, what: "PR reviewers" },
    fetchFn,
    signal,
  );
}

interface PageDataRead<T> {
  readonly endpoint: string;
  readonly parse: (json: unknown) => T | undefined;
  /** What the warning on a failed read names. */
  readonly what: string;
}

async function readPageData<T>(
  diff: DiffRef,
  { endpoint, parse, what }: PageDataRead<T>,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<T | undefined> {
  if (diff.kind !== "pr") return undefined;
  const url = `https://github.com/${diff.owner}/${diff.repo}/pull/${diff.number}/page_data/${endpoint}`;

  try {
    const read = parse(await pageData(url, fetchFn, signal));
    if (read === undefined) throw new Error(`${url} answered an unexpected shape`);
    return read;
  } catch (error) {
    if (!signal.aborted) console.warn(`gh-prism: couldn't read ${what}; showing none`, error);
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

/** One request or review's reviewer, as review_requests names them. */
interface ReviewerEntry {
  readonly reviewer: unknown;
  readonly teams: readonly unknown[];
  readonly codeOwner: boolean;
}

function reviewersFrom(json: unknown): PrReviewer[] | undefined {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return undefined;
  // Its JSON leaves out an empty list.
  const requests = at(json, "pendingReviewRequests") ?? [];
  const reviews = at(json, "completedReviews") ?? [];
  if (!Array.isArray(requests) || !Array.isArray(reviews)) return undefined;

  const entries: ReviewerEntry[] = requests.map((request) => ({
    reviewer: at(request, "reviewer"),
    teams: [at(request, "delegatedFromTeam")],
    codeOwner: at(request, "isCodeOwner") === true,
  }));
  for (const review of reviews) {
    const teams = at(review, "onBehalfOfTeams") ?? [];
    if (!Array.isArray(teams)) return undefined;
    entries.push({ reviewer: at(review, "reviewer"), teams, codeOwner: false });
  }

  const reviewers = new Map<string, PrReviewer>();
  for (const { reviewer, teams, codeOwner } of entries) {
    if (reviewer == null) continue;
    const token = tokenOf(reviewer);
    if (token === undefined) return undefined;
    if (!codeOwnerOf(token).url) continue;
    const seen = reviewers.get(token.toLowerCase());
    reviewers.set(token.toLowerCase(), {
      token: seen?.token ?? token,
      teams: [...new Set([...(seen?.teams ?? []), ...teams.flatMap(teamTokenOf)])],
      codeOwner: seen?.codeOwner || codeOwner,
    });
  }
  return [...reviewers.values()];
}

/** `account`'s `@displayLogin`, or `undefined` when it has none. */
function tokenOf(account: unknown): string | undefined {
  const login = at(account, "displayLogin");
  return typeof login === "string" ? `@${login}` : undefined;
}

/** `team`'s `@org/slug` token, once; nothing for anything else. */
function teamTokenOf(team: unknown): string[] {
  const token = tokenOf(team);
  return token?.includes("/") && codeOwnerOf(token).url ? [token] : [];
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
