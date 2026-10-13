/**
 * Lands intent on each page of a Files view visit. Hands each step (pending, progress, landed, then
 * the sections) to every view in one order, and owns the only observer of the native tree,
 * re-listing the sections after each change to it. It reads intent once per page; the caller shares
 * that read across a visit's pages (`shareIntent`).
 */

import { type LandedSection, landingOf, sectionsOf } from "@/utils/intent/landing";
import type { IntentProgress, IntentResult, PendingIntent } from "@/utils/intent/read";
import { showDiffOrder } from "../diffs/order";
import { type ChangedFile, type FilesPage, observeTree, readChangedFiles } from "../files-page";
import { type DiffstatChoice, showDiffstat } from "../header/diffstat-view";
import { showSections } from "../sidebar/sections-view";

/**
 * The native tree's files in the sections they land in: what the sidebar lists and the diffs
 * follow.
 */
export type FileSection = LandedSection<ChangedFile>;

/**
 * What a view draws as a page's intent lands. `land` calls every view's hook for a step before any
 * view's hook for the next.
 */
export interface LandingView {
  /** Intent is still being read: draw the pending state. */
  pending?(): void;
  /** How far the read has got: the latest progress right after `pending`, then each new one. */
  progress?(progress: IntentProgress): void;
  /** Intent landed as `result`. */
  landed?(result: IntentResult): void;
  /**
   * The native tree's files in their sections: right after landing, then after each change to the
   * tree.
   */
  sections?(sections: readonly FileSection[]): void;
}

/**
 * Lands `intent` on `views`, then re-lists their sections after each change to `page`'s native
 * tree outside `ignore`, until `signal` aborts. Reads `intent` once. A read that rejects is logged
 * and lands path-only, as `failed`.
 */
export function land(
  page: FilesPage,
  intent: PendingIntent,
  views: readonly LandingView[],
  { signal, ignore }: { signal: AbortSignal; ignore?: Node },
): void {
  let result: IntentResult | undefined;
  const relist = () => {
    if (!result) return;
    const sections = sectionsOf(landingOf(result), readChangedFiles(page.sidebar));
    for (const view of views) view.sections?.(sections);
  };
  const settle = (landed: IntentResult) => {
    result = landed;
    for (const view of views) view.landed?.(landed);
    relist();
  };

  let earlyProgress: IntentProgress | undefined;
  let pending = false;
  const read = intent((progress) => {
    if (!pending) earlyProgress = progress;
    else for (const view of views) view.progress?.(progress);
  });

  if (read instanceof Promise) {
    pending = true;
    for (const view of views) view.pending?.();
    if (earlyProgress) for (const view of views) view.progress?.(earlyProgress);
    void orFailed(read).then((landed) => {
      if (!signal.aborted) settle(landed);
    });
  } else {
    settle(read);
  }

  observeTree(page.sidebar, relist, { signal, ignore });
}

/** `read`'s result, or a path-only `failed` one, logged, when it rejects. */
const orFailed = (read: Promise<IntentResult>): Promise<IntentResult> =>
  read.catch((error: unknown): IntentResult => {
    console.error("gh-prism: reading intent failed", error);
    return { ok: false, problem: "failed" };
  });

/**
 * Mounts the sidebar, the diff order, and the diffstat on one page of a visit, and lands `intent`
 * on them in that order, until `signal` aborts.
 */
export function showVisit(
  page: FilesPage,
  signal: AbortSignal,
  { intent, diffstat }: { intent: PendingIntent; diffstat: DiffstatChoice },
): void {
  const sidebar = showSections(page, signal);
  const views = [
    sidebar,
    showDiffOrder(page, signal),
    showDiffstat(page, { choice: diffstat, signal }),
  ];
  // The sidebar draws inside the tree's container, so its own changes must not re-list.
  land(page, intent, views, { signal, ignore: sidebar.root });
}
