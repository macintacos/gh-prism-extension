import { type PrFileDiff, parsePrDiff } from "./pr-diff";
import {
  type PrHead,
  type PrRef,
  prEmbeddedDataFromHtml,
  prHeadShaFromEmbeddedData,
} from "./pr-ref";

export type PrDataProblem = "no-access" | "rate-limited" | "too-large" | "failed";
export type PrHeadResult = { ok: true; headSha: string } | { ok: false; problem: PrDataProblem };
export type PrFilesResult =
  | { ok: true; files: PrFileDiff[] }
  | { ok: false; problem: PrDataProblem };
export type PrFileContentResult =
  | { ok: true; text: string }
  | { ok: false; problem: PrDataProblem };

/** Reads a PR's data through github.com with the browser's session; aborting `signal` rejects with `AbortError`. */
export interface PrDataSource {
  head(pr: PrRef, signal: AbortSignal): Promise<PrHeadResult>;
  files(pr: PrHead, signal: AbortSignal): Promise<PrFilesResult>;
  content(pr: PrHead, path: string, signal: AbortSignal): Promise<PrFileContentResult>;
}

type TextResult = { ok: true; text: string } | { ok: false; problem: PrDataProblem };

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

export function createPrDataSource(fetchFn: typeof fetch): PrDataSource {
  // ponytail: unbounded across PRs; the service worker's idle shutdown bounds it — add LRU if memory shows up.
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

  async function fetchText(url: string, signal: AbortSignal): Promise<TextResult> {
    try {
      const response = await fetchFn(url, { credentials: "include", signal });
      if (!response.ok) return { ok: false, problem: problemFor(response) };
      return { ok: true, text: await response.text() };
    } catch (error) {
      if (signal.aborted) throw error;
      return { ok: false, problem: "failed" };
    }
  }

  const base = (pr: PrRef) => `https://github.com/${pr.owner}/${pr.repo}`;

  return {
    async head(pr, signal) {
      const page = await fetchText(`${base(pr)}/pull/${pr.number}`, signal);
      if (!page.ok) return page;
      const headSha = prHeadShaFromEmbeddedData(prEmbeddedDataFromHtml(page.text), pr);
      return headSha ? { ok: true, headSha } : { ok: false, problem: "failed" };
    },

    async files(pr, signal) {
      const cached = entryFor(pr).files;
      if (cached) return { ok: true, files: cached };
      const diff = await fetchText(`${base(pr)}/pull/${pr.number}.diff`, signal);
      if (!diff.ok) return diff;
      const files = parsePrDiff(diff.text);
      // A 200 that names no files is an interstitial page, not an empty PR.
      if (files.length === 0 && diff.text.trim() !== "") return { ok: false, problem: "failed" };
      entryFor(pr).files = files;
      return { ok: true, files };
    },

    async content(pr, path, signal) {
      const cached = entryFor(pr).contents.get(path);
      if (cached !== undefined) return { ok: true, text: cached };
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      const result = await fetchText(`${base(pr)}/raw/${pr.headSha}/${encoded}`, signal);
      if (result.ok) entryFor(pr).contents.set(path, result.text);
      return result;
    },
  };
}
