import { parsePrHunks } from "@/utils/github/pr-diff";
import type { PrDataClient } from "@/utils/github/pr-port";
import type { PrHeadAndFilesResult } from "@/utils/github/pr-source";
import { type StructuralFile, structuralFile } from "@/utils/structural/changes";
import type { FileChangesResult, StructuralProblem } from "@/utils/structural/file-changes";
import type { PaintOutcome } from "./structural";

/** What a visit knows about one requested file once its answer settled. */
export type StructuralAnswer =
  | { readonly ok: true; readonly file: StructuralFile }
  | { readonly ok: false; readonly problem: StructuralProblem };

/** One visit's structural answers, asked for lazily and kept until the visit ends. */
export interface StructuralFiles {
  /** Asks for each path not yet asked this visit. Does nothing once the visit has ended. */
  request(paths: Iterable<string>): void;
  /** The settled answer for `path`, the same object on every call; `undefined` until it settles. */
  answerOf(path: string): StructuralAnswer | undefined;
  /** Whether `path` was asked this visit and its answer has not settled. */
  pending(path: string): boolean;
  /** Calls `listener` after each answer settles, until `until` aborts or the visit ends. */
  onAnswer(listener: () => void, until: AbortSignal): void;
  /** Records the painter's latest outcome for `path`. */
  report(path: string, outcome: PaintOutcome): void;
  /** The painter's latest outcome for `path`. */
  outcomeOf(path: string): PaintOutcome | undefined;
}

type StructuralClient = Pick<PrDataClient, "files" | "structural" | "close">;

const FAILED: StructuralAnswer = { ok: false, problem: "failed" };

/**
 * `path`'s answer from the port's changes for it and the diff's listing, or `undefined` when the
 * changes don't fit the listed diff.
 */
function answerFor(
  path: string,
  changes: FileChangesResult,
  listing: PrHeadAndFilesResult,
): StructuralAnswer | undefined {
  if (!changes.ok) return changes;
  if (!listing.ok) return listing;
  const listed = listing.files.find((file) => file.path === path);
  if (listed?.kind !== "text") return undefined;
  const file = structuralFile(changes.changes, parsePrHunks(listed.patch));
  return file ? { ok: true, file } : undefined;
}

/**
 * `connect` is called on the first request; its client is closed when `signal` aborts. Nothing that
 * settles after `signal` aborts is kept or announced.
 */
export function structuralFiles(
  connect: () => StructuralClient,
  signal: AbortSignal,
): StructuralFiles {
  let client: StructuralClient | undefined;
  const asked = new Set<string>();
  // ponytail: a file's answer, `failed` included (a Worker restart, say), is kept until the next
  // visit; retry a failed one if reviewers need it without a reload.
  const answers = new Map<string, StructuralAnswer>();
  const listeners = new Set<() => void>();
  const outcomes = new Map<string, PaintOutcome>();

  const opened = () => {
    if (client) return client;
    const connected = connect();
    signal.addEventListener("abort", () => connected.close(), { once: true });
    client = connected;
    return connected;
  };

  const ask = (path: string) => {
    const port = opened();
    void Promise.all([port.structural(path), port.files()]).then(([changes, listing]) => {
      if (signal.aborted) return;
      const answer = answerFor(path, changes, listing);
      if (!answer)
        console.warn(`gh-prism: Structural mode's answer for ${path} doesn't fit its diff`);
      answers.set(path, answer ?? FAILED);
      for (const listener of listeners) listener();
    });
  };

  return {
    request(paths) {
      if (signal.aborted) return;
      for (const path of paths) {
        if (asked.has(path)) continue;
        asked.add(path);
        ask(path);
      }
    },
    answerOf: (path) => answers.get(path),
    pending: (path) => asked.has(path) && !answers.has(path),
    onAnswer(listener, until) {
      listeners.add(listener);
      until.addEventListener("abort", () => listeners.delete(listener), { once: true });
    },
    report: (path, outcome) => void outcomes.set(path, outcome),
    outcomeOf: (path) => outcomes.get(path),
  };
}
