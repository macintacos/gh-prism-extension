/** Bench-only content script body that `bench/scratch-build.ts` wraps; it must never ship. */

import { browser } from "wxt/browser";
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
  | { readonly op: "answers"; readonly paths: readonly string[] }
  | { readonly op: "paint" }
  | { readonly op: "storage" };

/**
 * The highlight ranges per diff anchor, how many sit on a node no longer in the page, and how many
 * sit in a cell GitHub does not mark changed.
 */
export type ProbePaint =
  | {
      readonly perRange: true;
      readonly byAnchor: Record<string, number>;
      readonly stale: number;
      readonly outsideChanged: number;
    }
  | { readonly perRange: false; readonly total: number };

function paint(): ProbePaint {
  const byAnchor: Record<string, number> = {};
  let stale = 0;
  let outsideChanged = 0;
  // Firefox denies a content script the ranges another content script made; their count is all it
  // can read.
  if (import.meta.env.BROWSER === "firefox") {
    const total = [ADDED_HIGHLIGHT, REMOVED_HIGHLIGHT]
      .map((name) => CSS.highlights.get(name)?.size ?? 0)
      .reduce((a, b) => a + b, 0);
    return { perRange: false, total };
  }
  for (const name of [ADDED_HIGHLIGHT, REMOVED_HIGHLIGHT]) {
    CSS.highlights.get(name)?.forEach((range) => {
      const node = range.startContainer;
      if (!node.isConnected) stale++;
      if (!node.parentElement?.closest("code.addition, code.deletion")) outsideChanged++;
      const anchor =
        node.parentElement?.closest("table[data-diff-anchor]")?.getAttribute("data-diff-anchor") ??
        "";
      byAnchor[anchor] = (byAnchor[anchor] ?? 0) + 1;
    });
  }
  return { perRange: true, byAnchor, stale, outsideChanged };
}

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
    case "paint":
      return Promise.resolve().then(paint);
    case "storage":
      return Promise.all([browser.storage.sync.get(null), browser.storage.local.get(null)]).then(
        ([sync, local]) => ({ sync, local }),
      );
  }
}

/**
 * Bench-only content script body: answers each page message `{ probe: id, request }` with
 * `{ probeReply: id, result }` or `{ probeReply: id, error }`.
 */
export function probe(): void {
  window.addEventListener("message", (event) => {
    const { probe: id, request } = (event.data ?? {}) as { probe?: number; request?: ProbeRequest };
    if (id === undefined || !request) return;
    answer(request).then(
      (result) => window.postMessage({ probeReply: id, result }, "*"),
      (error: unknown) => window.postMessage({ probeReply: id, error: String(error) }, "*"),
    );
  });
}
