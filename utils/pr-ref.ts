/** A pull request as its github.com URL names it; owner and repo compare case-insensitively. */
export interface PrRef {
  kind: "pr";
  owner: string;
  repo: string;
  number: number;
}

/**
 * A pull request at a commit. `headSha` is the full 40-hex SHA, never a ref — github.com's raw/
 * 404s on ref paths.
 */
export interface PrHead extends PrRef {
  headSha: string;
}

/**
 * A single commit as its github.com URL names it, by a full or abbreviated SHA: github.com
 * resolves either in the commit's `.diff` and `raw/` URLs.
 */
export interface CommitHead {
  kind: "commit";
  owner: string;
  repo: string;
  headSha: string;
}

/** Where a Files view's diff comes from: a pull request, or a single commit. */
export type DiffRef = PrRef | CommitHead;

/** A diff pinned at the commit it ends on. */
export type DiffHead = PrHead | CommitHead;

export function isPrHeadSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}

const EMBEDDED_DATA_SELECTOR = 'script[data-target="react-app.embeddedData"]';
const EMBEDDED_DATA_SCRIPT =
  /<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/;

function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    // Checked to be a non-null object just above.
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sameName(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && actual.toLowerCase() === expected.toLowerCase();
}

/**
 * The PR's head SHA from GitHub's embedded page data, or `undefined` unless that data
 * names `pr`.
 *
 * @remarks
 * The embedded script reflects the last full page load, not the current URL: after a soft
 * navigation it still holds the previous page's payload, hence the match check.
 */
export function prHeadShaFromEmbeddedData(
  json: string | null | undefined,
  pr: PrRef,
): string | undefined {
  if (json == null) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }
  const route = at(data, "payload", "pullRequestsLayoutRoute");
  const headSha = at(route, "pullRequest", "headSha");
  const matches =
    at(route, "pullRequest", "number") === pr.number &&
    sameName(at(route, "repository", "ownerLogin"), pr.owner) &&
    sameName(at(route, "repository", "name"), pr.repo);
  return matches && isPrHeadSha(headSha) ? headSha : undefined;
}

/** The embedded page-data JSON from a PR page's HTML, for contexts without a `DOMParser`. */
export function prEmbeddedDataFromHtml(html: string): string | undefined {
  return EMBEDDED_DATA_SCRIPT.exec(html)?.[1];
}

/** {@link prHeadShaFromEmbeddedData} for a live page's `document`. */
export function readPrPageHeadSha(
  doc: { querySelector(selectors: string): { textContent: string | null } | null },
  pr: PrRef,
): string | undefined {
  return prHeadShaFromEmbeddedData(doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent, pr);
}
