import { type DiffRef, isCommitSha } from "./pr-ref";

const FILES_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/([^/]*).*)?$/;
const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([^/]+)\/?$/;

/** The diff a Files changed URL names, and whether a commit or range narrows a pull request's. */
export interface FilesRoute {
  readonly diff: DiffRef;
  /**
   * A pull request's URL narrows it to one commit or a range: `/changes/<sha>` or
   * `/changes/<base>..<head>`.
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
 * Whether `pathname` is a pull request's Files changed tab, any commit or range included, or a
 * commit page.
 */
export function isFilesPath(pathname: string): boolean {
  return readFilesRoute(pathname) !== undefined;
}
