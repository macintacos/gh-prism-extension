import { type DiffRef, isCommitSha, type PrRef } from "./pr-ref";

// The classic page's `/files` and `/commits/<sha>`: GitHub redirects them to `/changes` and
// `/changes/<sha>` wherever it shows the new page.
const FILES_PATH =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files|commits(?=\/[0-9a-f]{7,40}\/?$))(?:\/([^/]*).*)?$/;
const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([^/]+)\/?$/;
const HEADER_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/commits|\/checks)?\/?$/;

/** The diff a Files changed URL names, and whether a commit or range narrows a pull request's. */
export interface FilesRoute {
  readonly diff: DiffRef;
  /**
   * A pull request's URL narrows it to one commit or a range: `/changes/<sha>`,
   * `/commits/<sha>`, or `/changes/<base>..<head>`.
   */
  readonly commitFiltered: boolean;
}

/**
 * The pull request and commit filter a Files changed `pathname` names, or the single commit a
 * commit page names; `undefined` anywhere else.
 */
export function readFilesRoute(pathname: string): FilesRoute | undefined {
  const [, owner, repo, prNumber, filter] = FILES_PATH.exec(pathname) ?? [];
  if (owner !== undefined && repo !== undefined && prNumber !== undefined)
    return {
      diff: { kind: "pr", owner, repo, number: Number(prNumber) },
      commitFiltered: Boolean(filter),
    };

  const [, commitOwner, commitRepo, headSha] = COMMIT_PATH.exec(pathname) ?? [];
  if (commitOwner === undefined || commitRepo === undefined || !isCommitSha(headSha))
    return undefined;
  return {
    diff: { kind: "commit", owner: commitOwner, repo: commitRepo, headSha },
    commitFiltered: false,
  };
}

/**
 * The pull request whose header tab (Conversation, Commits, or Checks) `pathname` is; `undefined`
 * anywhere else, Files changed included.
 */
export function readHeaderTabPr(pathname: string): PrRef | undefined {
  const [, owner, repo, prNumber] = HEADER_PATH.exec(pathname) ?? [];
  if (owner === undefined || repo === undefined || prNumber === undefined) return undefined;
  return { kind: "pr", owner, repo, number: Number(prNumber) };
}

/** gh-prism's own query parameter: the code owner whose files a Files changed page narrows to. */
export const OWNER_PARAM = "gh-prism-owner";

/**
 * The code owner `search` names in {@link OWNER_PARAM}, as a CODEOWNERS token: `@` is added
 * unless the value holds one, as `@user` and an email do, so `org/team` reads as `@org/team`.
 * `undefined` when absent or empty.
 */
export function ownerOf(search: string): string | undefined {
  const owner = new URLSearchParams(search).get(OWNER_PARAM)?.trim();
  if (!owner) return undefined;
  return owner.includes("@") ? owner : `@${owner}`;
}

/** GitHub's own query parameter for "Only files owned by you", holding the viewer's login. */
const OWNED_BY_PARAM = "owned-by[]";

/**
 * `href` with the owner filter set to `owner`, a CODEOWNERS token, or cleared when `undefined`.
 * GitHub's own owner filter is dropped either way, so one owner applies at a time.
 */
export function withOwner(href: string, owner: string | undefined): string {
  const url = new URL(href);
  url.searchParams.delete(OWNED_BY_PARAM);
  if (owner === undefined) url.searchParams.delete(OWNER_PARAM);
  else url.searchParams.set(OWNER_PARAM, owner.replace(/^@/, ""));
  return url.href;
}

/** `href` with GitHub's "Only files owned by you" set to `login`, and the owner filter dropped. */
export function withViewerOwner(href: string, login: string): string {
  const url = new URL(href);
  url.searchParams.delete(OWNER_PARAM);
  url.searchParams.set(OWNED_BY_PARAM, login);
  return url.href;
}

/**
 * Whether `pathname` is a pull request's Files changed tab, any commit or range included, or a
 * commit page.
 */
export function isFilesPath(pathname: string): boolean {
  return readFilesRoute(pathname) !== undefined;
}
