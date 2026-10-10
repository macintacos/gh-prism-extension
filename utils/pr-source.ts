import { type PrFileDiff, parsePrDiff } from "./pr-diff";
import {
  type PrHead,
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

/**
 * Reads a PR's data through github.com with the browser's session; aborting `signal` rejects
 * with `AbortError`. Callers validate `pr` and `path` first, as {@link servePrDataPort} does:
 * URLs are built from them with per-segment encoding only.
 */
export interface PrDataSource {
  head(pr: PrRef, signal: AbortSignal): Promise<PrHeadResult>;
  files(pr: PrHead, signal: AbortSignal): Promise<PrFilesResult>;
  content(pr: PrHead, path: string, signal: AbortSignal): Promise<PrFileContentResult>;
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
 * memory, one head per PR: a request naming another head replaces that PR's entry, and problems
 * are never cached. Create one per service worker.
 */
export function createPrDataSource(fetchFn: typeof fetch): PrDataSource {
  // ponytail: unbounded across PRs, bounded by the worker's idle shutdown — add LRU if memory
  // shows up. Two clients on different heads of one PR evict each other's entry every request.
  const cache = new Map<string, PrCacheEntry>();

  function entryFor(pr: PrHead): PrCacheEntry {
    const key = `${pr.owner}/${pr.repo}#${pr.number}`.toLowerCase();
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

  const repoUrl = (pr: PrRef) => `https://github.com/${pr.owner}/${pr.repo}`;

  return {
    async head(pr, signal) {
      const page = await fetchText(`${repoUrl(pr)}/pull/${pr.number}`, signal);
      if (!page.ok) return page;
      const headSha = prHeadShaFromEmbeddedData(prEmbeddedDataFromHtml(page.text), pr);
      return headSha ? { ok: true, headSha } : { ok: false, problem: "failed" };
    },

    async files(pr, signal) {
      const entry = entryFor(pr);
      const cached = entry.files;
      if (cached) return { ok: true, files: cached };
      const diff = await fetchText(`${repoUrl(pr)}/pull/${pr.number}.diff`, signal);
      if (!diff.ok) return diff;
      const files = parsePrDiff(diff.text);
      // A non-empty 200 that parses to no files is an interstitial page, not an empty PR.
      if (files.length === 0 && diff.text.trim() !== "") return { ok: false, problem: "failed" };
      entry.files = files;
      return { ok: true, files };
    },

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
