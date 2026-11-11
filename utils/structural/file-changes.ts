// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import { type PrFileDiff, parsePrHunks } from "../github/pr-diff";
import type { DiffHead } from "../github/pr-ref";
import type { PrDataProblem, PrDataSource } from "../github/pr-source";
import { baseText } from "./base-text";
import type { StructuralChanges } from "./changes";
import type { EngineResult } from "./engine";
import { type Grammar, grammarOf } from "./grammar";
import { DEFAULT_LIMITS } from "./limits";
import { changedRegions } from "./regions";
import type { EngineRun, StructuralRequest } from "./request";

export type StructuralProblem = PrDataProblem | "not-applicable" | "unsupported";

/** One file's structural changes, or why there are none. Small enough to cross a port: no file text. */
export type FileChangesResult =
  | { readonly ok: true; readonly changes: StructuralChanges }
  | { readonly ok: false; readonly problem: StructuralProblem };

/** Answers for `path` in `pr`'s diff. Rejects with `signal.reason` when `signal` aborts. */
export type FileChanges = (
  pr: DiffHead,
  path: string,
  signal: AbortSignal,
) => Promise<FileChangesResult>;

/** The most token spans the cache keeps across all files. */
export const CACHED_SPANS = 200_000;

/** The most head texts read at once. Keep in sync with `HEAD_READS_AT_ONCE` in utils/intent/read.ts. */
export const STRUCTURAL_READS_AT_ONCE = 6;

export interface FileChangesDeps {
  readonly source: Pick<PrDataSource, "files" | "content">;
  readonly run: EngineRun;
  /** The cache's bound, in token spans across all entries. */
  readonly cachedSpans: number;
}

const refuse = (problem: StructuralProblem): FileChangesResult => ({ ok: false, problem });

/**
 * Builds one diff file's structural changes from the source's cached diff and head text, running
 * `run` only for a listed, modified file with a grammar. Settled answers that belong to the file
 * are cached; fetch problems and `failed` are not.
 */
export function fileChanges({ source, run, cachedSpans }: FileChangesDeps): FileChanges {
  const cache = spanCache(cachedSpans);
  const gated = gate(STRUCTURAL_READS_AT_ONCE);

  return async (pr, path, signal) => {
    const listed = await source.files(pr, signal);
    if (!listed.ok) return listed;

    const file = listed.files.find((candidate) => candidate.path === path);
    if (!file) return refuse("failed");

    if (!hasHunks(file)) return refuse("not-applicable");

    const grammar = grammarOf(path);
    if (!grammar) return refuse("unsupported");

    const key = cacheKey(pr, path);
    const cached = cache.get(key);
    if (cached) return cached;

    const head = await gated(() => {
      signal.throwIfAborted();
      return source.content(pr, path, signal);
    });
    signal.throwIfAborted();
    if (!head.ok) return head;

    const request = requestFor(file, head.text, grammar);
    if (!request) return refuse("failed");

    const result = answerOf(await runOrFail(run, request, signal));
    if (result.ok || result.problem !== "failed") cache.set(key, result);
    return result;
  };
}

/** Whether `file` is a modified text file with at least one hunk: the only kind with an old text. */
function hasHunks(file: PrFileDiff): file is PrFileDiff & { kind: "text" } {
  return (
    file.kind === "text" &&
    file.status !== "added" &&
    file.status !== "deleted" &&
    parsePrHunks(file.patch).length > 0
  );
}

const BOM = String.fromCharCode(0xfeff);

/**
 * The engine request for `file` at `head`, or `undefined` when the patch does not apply. The head
 * read drops a leading BOM the diff keeps, so a BOM file is retried with it restored.
 */
function requestFor(
  file: PrFileDiff & { kind: "text" },
  head: string,
  grammar: Grammar,
): StructuralRequest | undefined {
  const regions = changedRegions(parsePrHunks(file.patch));
  const newText = [head, `${BOM}${head}`].find((text) => baseText(file, text) !== undefined);
  const oldText = newText === undefined ? undefined : baseText(file, newText);
  if (!regions || newText === undefined || oldText === undefined) return undefined;
  return { oldText, newText, grammar, regions, limits: DEFAULT_LIMITS };
}

async function runOrFail(
  run: EngineRun,
  request: StructuralRequest,
  signal: AbortSignal,
): Promise<EngineResult> {
  try {
    return await run(request, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn("gh-prism: structural engine failed", error);
    return { ok: false, reason: "failed" };
  }
}

const answerOf = (result: EngineResult): FileChangesResult =>
  result.ok ? result : refuse(result.reason);

/** Apart per diff, so a PR and a commit at the same SHA never share an entry. */
const cacheKey = (pr: DiffHead, path: string): string =>
  `${`${pr.owner}/${pr.repo}`.toLowerCase()}/${pr.kind === "pr" ? `pull/${pr.number}` : "commit"}@${pr.headSha}:${path}`;

/** Settled answers by key, bounded by `bound` token spans in total; a refusal weighs 1. */
function spanCache(bound: number) {
  // ponytail: first in, first out; refresh an entry on read if revisits matter.
  const entries = new Map<string, { result: FileChangesResult; weight: number }>();
  let total = 0;

  const evict = (key: string) => {
    total -= entries.get(key)?.weight ?? 0;
    entries.delete(key);
  };

  return {
    get: (key: string) => entries.get(key)?.result,
    set(key: string, result: FileChangesResult) {
      const weight = result.ok ? result.changes.old.length + result.changes.new.length + 1 : 1;
      evict(key);
      if (weight > bound) return;

      entries.set(key, { result, weight });
      total += weight;
      for (const oldest of entries.keys()) {
        if (total <= bound) break;
        evict(oldest);
      }
    },
  };
}

/** Runs at most `limit` tasks at once, starting waiting ones in arrival order. */
function gate(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running < limit) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
