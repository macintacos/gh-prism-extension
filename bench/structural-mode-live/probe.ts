/** Bench-only content script body that `bench/scratch-build.ts` wraps; it must never ship. */

import { ADDED_HIGHLIGHT, REMOVED_HIGHLIGHT } from "@/entrypoints/content/diffs/structural";
import { structuralFiles } from "@/entrypoints/content/diffs/structural-files";
import { readFilesRoute } from "@/utils/github/files-route";
import { connectPrData } from "@/utils/github/pr-port";
import { structuralMode } from "@/utils/prefs";

/** A request the live bench posts to the page. */
export type ProbeRequest =
  | { readonly op: "set"; readonly on: boolean }
  | { readonly op: "get" }
  | { readonly op: "highlights" }
  | { readonly op: "paths" }
  | { readonly op: "answers"; readonly paths: readonly string[] };

/** A path's answer as the bench compares it: the changed lines' text, or the port's problem. */
export type ProbeAnswer =
  | {
      readonly ok: true;
      readonly text: {
        readonly old: Record<number, string>;
        readonly new: Record<number, string>;
      };
    }
  | { readonly ok: false; readonly problem: string };

const diffOfPage = () => {
  const route = readFilesRoute(location.pathname);
  if (!route) throw new Error(`not a Files page: ${location.pathname}`);
  return route.diff;
};

/** Each path's answer through a visit's own `structuralFiles`, on a port closed once all settle. */
function answers(paths: readonly string[]): Promise<Record<string, ProbeAnswer>> {
  const done = new AbortController();
  const files = structuralFiles(() => connectPrData(diffOfPage()), done.signal);
  return new Promise((resolve) => {
    const settle = () => {
      const settled = paths.map((path) => [path, files.answerOf(path)] as const);
      if (settled.some(([, answer]) => !answer)) return;
      done.abort();
      resolve(
        Object.fromEntries(
          settled.map(([path, answer]) => [
            path,
            answer?.ok
              ? { ok: true, text: answer.file.text }
              : { ok: false, problem: answer?.problem ?? "" },
          ]),
        ),
      );
    };
    files.onAnswer(settle, done.signal);
    files.request(paths);
    if (paths.length === 0) settle();
  });
}

async function paths(): Promise<string[]> {
  const client = connectPrData(diffOfPage());
  try {
    const listing = await client.files();
    if (!listing.ok) throw new Error(`listing failed: ${listing.problem}`);
    return listing.files.map((file) => file.path);
  } finally {
    client.close();
  }
}

function answer(request: ProbeRequest): Promise<unknown> {
  switch (request.op) {
    case "set":
      return structuralMode.setValue(request.on).then(() => request.on);
    case "get":
      return structuralMode.getValue();
    case "highlights":
      return Promise.resolve(
        [ADDED_HIGHLIGHT, REMOVED_HIGHLIGHT].map((name) => CSS.highlights.get(name)?.size ?? 0),
      );
    case "paths":
      return paths();
    case "answers":
      return answers(request.paths);
  }
}

/**
 * Bench-only content script body: answers each page message `{ probe: n, request }` with
 * `{ probeReply: n, result }` or `{ probeReply: n, error }`.
 */
export function probe(): void {
  window.addEventListener("message", (event) => {
    const { probe: n, request } = (event.data ?? {}) as { probe?: number; request?: ProbeRequest };
    if (n === undefined || !request) return;
    answer(request).then(
      (result) => window.postMessage({ probeReply: n, result }, "*"),
      (error: unknown) => window.postMessage({ probeReply: n, error: String(error) }, "*"),
    );
  });
}
