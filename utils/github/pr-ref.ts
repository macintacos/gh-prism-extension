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

/** Whether `value` is a full 40-hex SHA; validates PR head and base SHAs from page data and ports. */
export function isPrHeadSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

/** Whether `value` is a full or abbreviated SHA, as a commit page's URL may name it. */
export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value);
}

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
 * A pull request's diff as its page names it: the commits it runs between, both full 40-hex
 * SHAs. `baseSha` is the merge base the page's diff runs from, the same commit the `.diff`
 * diffs against.
 */
export interface DiffPin {
  readonly baseSha: string;
  readonly headSha: string;
}

const HEAD_SHA_PATH = ["payload", "pullRequestsLayoutRoute", "pullRequest", "headSha"] as const;
// Not `comparison.baseOid`: that is the base tip at the last head push, while the diff runs from
// the merge base each `diffContents` entry's `oldCommitOid` names.
const DIFF_BASE_PATH = [
  "payload",
  "pullRequestsChangesRoute",
  "diffContents",
  "0",
  "oldCommitOid",
] as const;

type PageDocument = { querySelector(selectors: string): { textContent: string | null } | null };

/**
 * GitHub's embedded page data, or `undefined` unless it parses and names `pr`.
 *
 * @remarks
 * The embedded script reflects the last full page load, not the current URL: after a soft
 * navigation it still holds the previous page's payload, hence the match check.
 */
function prPageData(json: string | null | undefined, pr: PrRef): unknown {
  if (json == null) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }

  const route = at(data, "payload", "pullRequestsLayoutRoute");
  const matches =
    at(route, "pullRequest", "number") === pr.number &&
    sameName(at(route, "repository", "ownerLogin"), pr.owner) &&
    sameName(at(route, "repository", "name"), pr.repo);
  return matches ? data : undefined;
}

/** The PR's head SHA from GitHub's embedded page data, or `undefined` unless that data names `pr`. */
export function prHeadShaFromEmbeddedData(
  json: string | null | undefined,
  pr: PrRef,
): string | undefined {
  const headSha = at(prPageData(json, pr), ...HEAD_SHA_PATH);
  return isPrHeadSha(headSha) ? headSha : undefined;
}

/**
 * The diff pin from GitHub's embedded page data, or `undefined` unless that data names `pr` with
 * both SHAs full.
 *
 * @remarks
 * Only a full load of the Files changed tab carries a pin.
 */
export function diffPinFromEmbeddedData(
  json: string | null | undefined,
  pr: PrRef,
): DiffPin | undefined {
  const data = prPageData(json, pr);
  const headSha = at(data, ...HEAD_SHA_PATH);
  const baseSha = at(data, ...DIFF_BASE_PATH);
  return isPrHeadSha(headSha) && isPrHeadSha(baseSha) ? { baseSha, headSha } : undefined;
}

/** A full load's Viewed state from GitHub's embedded route data. */
export interface ViewedSeed {
  /** `user.shouldShowViewedFilesCount`: the page offers Viewed. */
  readonly offered: boolean;
  /** Each file's `markedAsViewed`, keyed by its `pathDigest`. */
  readonly viewed: ReadonlyMap<string, boolean>;
}

/**
 * The Viewed seed from GitHub's embedded page data, or `undefined` unless it names `pr` and every
 * Viewed field has its expected shape.
 *
 * @remarks
 * Reads `payload.pullRequestsChangesRoute`: `diffSummaries[]` of `{ pathDigest, markedAsViewed }`,
 * with a lowercase-hex digest and a boolean state, and `user.shouldShowViewedFilesCount`. One
 * malformed entry discards the whole source, so a partial map never dims the wrong rows.
 */
export function viewedFromEmbeddedData(
  json: string | null | undefined,
  pr: PrRef,
): ViewedSeed | undefined {
  const route = at(prPageData(json, pr), "payload", "pullRequestsChangesRoute");
  const summaries = at(route, "diffSummaries");
  const offered = at(route, "user", "shouldShowViewedFilesCount");
  if (!Array.isArray(summaries) || typeof offered !== "boolean") return undefined;

  const viewed = new Map<string, boolean>();
  for (const entry of summaries) {
    const digest = at(entry, "pathDigest");
    const marked = at(entry, "markedAsViewed");
    if (typeof digest !== "string" || !/^[0-9a-f]+$/.test(digest) || typeof marked !== "boolean")
      return undefined;
    viewed.set(digest, marked);
  }
  return { offered, viewed };
}

const EMBEDDED_DATA_SELECTOR = 'script[data-target="react-app.embeddedData"]';
const EMBEDDED_DATA_SCRIPT =
  /<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/;

/** The embedded page-data JSON from a PR page's HTML, for contexts without a `DOMParser`. */
export function prEmbeddedDataFromHtml(html: string): string | undefined {
  return EMBEDDED_DATA_SCRIPT.exec(html)?.[1];
}

/** {@link prHeadShaFromEmbeddedData} for a live page's `document`. */
export function readPrPageHeadSha(doc: PageDocument, pr: PrRef): string | undefined {
  return prHeadShaFromEmbeddedData(doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent, pr);
}

/** {@link diffPinFromEmbeddedData} for a live page's `document`; a commit's diff has no pin. */
export function readDiffPin(doc: PageDocument, diff: DiffRef): DiffPin | undefined {
  return diff.kind === "pr"
    ? diffPinFromEmbeddedData(doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent, diff)
    : undefined;
}

/** {@link viewedFromEmbeddedData} for a live page's `document`; a commit's diff has none. */
export function readViewedSeed(doc: PageDocument, diff: DiffRef): ViewedSeed | undefined {
  return diff.kind === "pr"
    ? viewedFromEmbeddedData(doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent, diff)
    : undefined;
}
