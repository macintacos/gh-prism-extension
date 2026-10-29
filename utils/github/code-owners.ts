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

/** Whether `token` names `owner`: the same user or the same team, ignoring case. */
export function isOwner(token: string, owner: CodeOwner): boolean {
  return token.toLowerCase() === owner.token.toLowerCase();
}

/**
 * A filter keeping the changed files one of whose code owners in `codeOwners` is `token`, ignoring
 * case; a path with no owners, or missing from `codeOwners`, is dropped.
 */
export function ownerFilter(codeOwners: PrCodeOwners, token: string): (path: string) => boolean {
  return (path) => codeOwners.get(path)?.owners.some((owner) => isOwner(token, owner)) ?? false;
}

/**
 * The PR reviewers in `reviewers` who own at least one changed file in `codeOwners`, in reviewer
 * order, leaving out `viewer`'s own `@login`, since GitHub's "Only files owned by you" stands for
 * the viewer; a team the viewer belongs to stays, since its files differ from the viewer's.
 */
export function owningReviewers(
  reviewers: readonly string[],
  codeOwners: PrCodeOwners,
  viewer: string | undefined,
): string[] {
  const paths = [...codeOwners.keys()];
  return reviewers.filter(
    (token) =>
      !(viewer !== undefined && isOwner(token, { token: `@${viewer}` })) &&
      paths.some(ownerFilter(codeOwners, token)),
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
 * The `@user` and `@org/team` tokens of a pull request's requested reviewers, then reviewers, in
 * GitHub's order, each once, from the `page_data/merge_box` endpoint its Files changed page reads,
 * in one request; a team counts when a review lists it in `onBehalfOf`. GitHub's merge box leaves
 * out reviews that only commented, so a reviewer who only commented is missing. `undefined` for a
 * commit, or once the read fails or answers an unexpected shape. Never rejects; logs one warning on
 * a failed read unless `signal` aborted.
 */
export function readPrReviewers(
  diff: DiffRef,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<readonly string[] | undefined> {
  return readPageData(
    diff,
    { endpoint: "merge_box", parse: reviewersFrom, what: "PR reviewers" },
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

function reviewersFrom(json: unknown): string[] | undefined {
  const requests = at(json, "pullRequest", "pendingReviewRequests");
  const reviews = at(json, "pullRequest", "latestOpinionatedReviews");
  if (!Array.isArray(requests) || !Array.isArray(reviews)) return undefined;

  const accounts: unknown[] = requests.map((request) => at(request, "reviewer"));
  for (const review of reviews) {
    const onBehalfOf = at(review, "onBehalfOf");
    if (!Array.isArray(onBehalfOf)) return undefined;
    // Unobserved shape: read an element as `pendingReviewRequests` names a team, `org/slug`; skip the rest.
    const teams = onBehalfOf.filter((team) => String(at(team, "login")).includes("/"));
    accounts.push(at(review, "author"), ...teams);
  }

  const reviewers = new Map<string, string>();
  for (const account of accounts) {
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
