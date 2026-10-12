import { type PrFileDiff, parsePrDiff } from "./pr-diff";
import {
  type DiffHead,
  type DiffRef,
  type PrRef,
  prEmbeddedDataFromHtml,
  prHeadShaFromEmbeddedData,
} from "./pr-ref";

/**
 * Why a PR read failed.
 * - `no-access`: 401, 403 or 404 — signed out or no access; GitHub hides a private repo as 404.
 *   Prompt the user to sign in to GitHub, never for a token.
 * - `rate-limited`: 429, or 403 with `retry-after` or `x-ratelimit-remaining: 0`.
 * - `too-large`: the result exceeds Chrome's 64 MiB extension-message cap.
 * - `failed`: anything else — another status, a network error, an interstitial page, or the
 *   service worker stopping mid-request. Retrying may succeed.
 */
export type PrDataProblem = "no-access" | "rate-limited" | "too-large" | "failed";
export type PrFailure = { ok: false; problem: PrDataProblem };
export type PrHeadResult = { ok: true; headSha: string } | PrFailure;
export type PrFilesResult = { ok: true; files: PrFileDiff[] } | PrFailure;
export type PrFileContentResult = { ok: true; text: string } | PrFailure;
export type PrHeadAndFilesResult = { ok: true; headSha: string; files: PrFileDiff[] } | PrFailure;

/**
 * Reads a PR's data through github.com with the browser's session; aborting `signal` rejects
 * with `AbortError`. Callers validate `pr` and `path` first, as {@link servePrDataPort} does:
 * URLs are built from them with per-segment encoding only.
 */
export interface PrDataSource {
  /** `pr`'s head SHA from its page, with the diff cached under that head; a first read fetches both at once. */
  headAndFiles(pr: PrRef, signal: AbortSignal): Promise<PrHeadAndFilesResult>;
  files(pr: DiffHead, signal: AbortSignal): Promise<PrFilesResult>;
  content(pr: DiffHead, path: string, signal: AbortSignal): Promise<PrFileContentResult>;
}

interface PrCacheEntry {
  headSha: string;
  files?: PrFileDiff[];
  contents: Map<string, string>;
}

function problemFor(response: Response): PrDataProblem {
  const { status, headers } = response;
  if (status === 429) return "rate-limited";
  if (
    status === 403 &&
    (headers.has("retry-after") || headers.get("x-ratelimit-remaining") === "0")
  )
    return "rate-limited";
  if (status === 401 || status === 403 || status === 404) return "no-access";
  return "failed";
}

/**
 * A {@link PrDataSource} over `fetchFn` that caches successful `files` and `content` results in
 * memory, one head per PR and one commit per repository: a request naming another head replaces
 * that entry, and problems are never cached. Create one per service worker.
 */
export function createPrDataSource(fetchFn: typeof fetch): PrDataSource {
  // ponytail: unbounded across PRs and repositories, bounded by the worker's idle shutdown — add
  // LRU if memory shows up. Two clients on different heads of one PR, or on different commits of
  // one repository, evict each other's entry every request.
  const cache = new Map<string, PrCacheEntry>();

  const keyOf = (pr: DiffRef) =>
    (pr.kind === "pr" ? diffUrl(pr) : `${repoUrl(pr)}/commit`).toLowerCase();

  function entryFor(pr: DiffHead): PrCacheEntry {
    const key = keyOf(pr);
    let entry = cache.get(key);
    if (entry?.headSha !== pr.headSha) {
      entry = { headSha: pr.headSha, contents: new Map() };
      cache.set(key, entry);
    }
    return entry;
  }

  // Both endpoints redirect to a `?token=` URL: never log it or read the response's URL.
  async function fetchText(url: string, signal: AbortSignal): Promise<PrFileContentResult> {
    try {
      const response = await fetchFn(url, { credentials: "include", signal });
      if (!response.ok) return { ok: false, problem: problemFor(response) };
      return { ok: true, text: await response.text() };
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, problem: "failed" };
    }
  }

  const repoUrl = (pr: DiffRef) => `https://github.com/${pr.owner}/${pr.repo}`;
  const diffUrl = (pr: DiffRef): string => {
    switch (pr.kind) {
      case "pr":
        return `${repoUrl(pr)}/pull/${pr.number}`;
      case "commit":
        return `${repoUrl(pr)}/commit/${pr.headSha}`;
      default:
        return pr satisfies never;
    }
  };

  async function lookUpHead(pr: PrRef, signal: AbortSignal): Promise<PrHeadResult> {
    const page = await fetchText(`${repoUrl(pr)}/pull/${pr.number}`, signal);
    if (!page.ok) return page;
    const headSha = prHeadShaFromEmbeddedData(prEmbeddedDataFromHtml(page.text), pr);
    return headSha ? { ok: true, headSha } : { ok: false, problem: "failed" };
  }

  async function readDiff(pr: DiffRef, signal: AbortSignal): Promise<PrFilesResult> {
    const diff = await fetchText(`${diffUrl(pr)}.diff`, signal);
    if (!diff.ok) return diff;
    const files = parsePrDiff(diff.text);
    // A non-empty 200 that parses to no files is an interstitial page, not an empty PR.
    if (files.length === 0 && diff.text.trim() !== "") return { ok: false, problem: "failed" };
    return { ok: true, files };
  }

  async function files(pr: DiffHead, signal: AbortSignal): Promise<PrFilesResult> {
    const entry = entryFor(pr);
    const cached = entry.files;
    if (cached) return { ok: true, files: cached };
    const read = await readDiff(pr, signal);
    if (read.ok) entry.files = read.files;
    return read;
  }

  return {
    async headAndFiles(pr, signal) {
      // A cached diff waits for the head, which says whether it still holds.
      if (cache.get(keyOf(pr))?.files) {
        const head = await lookUpHead(pr, signal);
        if (!head.ok) return head;
        const listed = await files({ ...pr, headSha: head.headSha }, signal);
        return listed.ok ? { ...listed, headSha: head.headSha } : listed;
      }
      const [head, read] = await Promise.all([lookUpHead(pr, signal), readDiff(pr, signal)]);
      if (!head.ok) return head;
      if (!read.ok) return read;
      const entry = entryFor({ ...pr, headSha: head.headSha });
      // As a `files` request at this head would answer: an entry filled meanwhile wins.
      entry.files ??= read.files;
      return { ok: true, headSha: head.headSha, files: entry.files };
    },

    files,

    async content(pr, path, signal) {
      const entry = entryFor(pr);
      const cached = entry.contents.get(path);
      if (cached !== undefined) return { ok: true, text: cached };
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      // Through github.com: raw.githubusercontent.com and ref paths both 404 on private repos.
      const result = await fetchText(`${repoUrl(pr)}/raw/${pr.headSha}/${encoded}`, signal);
      if (result.ok) entry.contents.set(path, result.text);
      return result;
    },
  };
}
