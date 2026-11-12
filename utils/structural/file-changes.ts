// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import { type PrFileDiff, parsePrHunks } from "../github/pr-diff";
import type { DiffHead } from "../github/pr-ref";
import type { PrDataProblem, PrDataSource } from "../github/pr-source";
import { baseText } from "./base-text";
import type { StructuralChanges } from "./changes";
import type { EngineResult } from "./engine";
import { type Grammar, grammarOf } from "./grammar";
import { DEFAULT_LIMITS } from "./limits";
import { isPlainText, PLAIN_TEXT, type PlainText } from "./plain-text";
import { changedRegions } from "./regions";
import type { EngineRun, StructuralRequest } from "./request";

/**
 * Why a file has no structural changes.
 * - `not-applicable`: no old text to compare: binary, added, deleted, or no hunks.
 * - `unsupported`: not plain text and no grammar for the path, or the engine refuses it.
 * - `too-large`: the head or old text is past the engine's limits, a token walk or diff runs past
 *   them, a parse or diff passes its deadline, or the result can't cross the port.
 * - `failed`: the diff doesn't list the path, the patch doesn't apply to the head, a text of an
 *   indentation-sensitive language parses with errors, or the engine's thread failed. Only the
 *   last may pass on a retry.
 * - `no-access`, `rate-limited`: the diff or head read's, as {@link PrDataProblem}.
 */
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

/**
 * The most token spans the cache keeps across all files: about five files at the engine's worst
 * case, `maxTokens` tokens changed a side.
 */
export const CACHED_SPANS = 200_000;

/**
 * The most head texts read at once, across every port: more invites GitHub's rate limiting.
 * Apart from intent's own six (`HEAD_READS_AT_ONCE`), so intent reads never wait on these.
 */
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
 * `run` only for a listed, modified file that is plain text or has a grammar. Settled answers that belong to the file
 * are cached; fetch problems, `failed`, and the engine's `too-slow` are not. A path the diff does
 * not list answers `failed` without a head read.
 */
export function fileChanges({ source, run, cachedSpans }: FileChangesDeps): FileChanges {
  const cache = spanCache(cachedSpans);
  const readingHeads = gate(STRUCTURAL_READS_AT_ONCE);
  // The source shares no in-flight diff read: one at a time, so a burst on a cold source fetches once.
  const listing = gate(1);

  return async (pr, path, signal) => {
    const listed = await listing(() => {
      signal.throwIfAborted();
      return source.files(pr, signal);
    });
    if (!listed.ok) return listed;

    const file = listed.files.find((candidate) => candidate.path === path);
    if (!file) return refuse("failed");

    if (!hasHunks(file)) return refuse("not-applicable");

    const grammar = isPlainText(path) ? PLAIN_TEXT : grammarOf(path);
    if (!grammar) return refuse("unsupported");

    const key = cacheKey(pr, path);
    const cached = cache.get(key);
    if (cached) return cached;

    const head = await readingHeads(() => {
      signal.throwIfAborted();
      return source.content(pr, path, signal);
    });
    signal.throwIfAborted();
    if (!head.ok) return head;
    if (head.text.length > DEFAULT_LIMITS.maxTextLength) {
      const tooLarge = refuse("too-large");
      cache.set(key, tooLarge);
      return tooLarge;
    }

    const request = requestFor(file, head.text, grammar);
    if (!request) return refuse("failed");

    const answer = await runOrFail(run, request, signal);
    const result = answerOf(answer);
    // A deadline depends on the machine's load, so another run may finish in time.
    if (answer.ok || (answer.reason !== "too-slow" && answer.reason !== "failed")) {
      cache.set(key, result);
    }
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

/** The engine request for `file` at `head`, or `undefined` when the patch does not apply. */
function requestFor(
  file: PrFileDiff & { kind: "text" },
  head: string,
  grammar: Grammar | PlainText,
): StructuralRequest | undefined {
  const regions = changedRegions(parsePrHunks(file.patch));
  if (!regions) return undefined;

  // The head read drops a leading BOM the diff keeps.
  for (const newText of [head, `${BOM}${head}`]) {
    const oldText = baseText(file, newText);
    if (oldText !== undefined) {
      return { oldText, newText, grammar, regions, limits: DEFAULT_LIMITS };
    }
  }
  return undefined;
}

/** The engine's answer, or `failed` when its thread breaks: a Worker error or a lost offscreen document. */
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
  result.ok ? result : refuse(result.reason === "too-slow" ? "too-large" : result.reason);

/** Apart per diff, so a PR and a commit at the same SHA never share an entry. */
const cacheKey = (pr: DiffHead, path: string): string => {
  const diff = pr.kind === "pr" ? `pull/${pr.number}` : "commit";
  return `${`${pr.owner}/${pr.repo}`.toLowerCase()}/${diff}@${pr.headSha}:${path}`;
};

/**
 * Settled answers by key, bounded by `bound` token spans in total. An entry weighs its spans plus
 * one, so empty changes still count; a refusal weighs 1.
 */
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
