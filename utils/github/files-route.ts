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
 * The pull request whose Conversation, Commits, or Checks tab `pathname` is; `undefined`
 * anywhere else, Files changed included.
 */
export function readHeaderRoute(pathname: string): PrRef | undefined {
  const [, owner, repo, prNumber] = HEADER_PATH.exec(pathname) ?? [];
  if (owner === undefined || repo === undefined || prNumber === undefined) return undefined;
  return { kind: "pr", owner, repo, number: Number(prNumber) };
}

/**
 * Whether `pathname` is a pull request's Files changed tab, any commit or range included, or a
 * commit page.
 */
export function isFilesPath(pathname: string): boolean {
  return readFilesRoute(pathname) !== undefined;
}
