/**
 * Lands intent on each page of a Files view visit. Hands each step (pending, progress, landed, then
 * the sections) to every view in one order, and owns the only observers of the native tree and of
 * the narrow layout's overlay copy, re-listing the sections from whichever is shown after each
 * change to it. It reads intent once per page; the caller shares that read across a visit's pages
 * (`shareIntent`).
 */

import { type LandedSection, landingOf, sectionsOf } from "@/utils/intent/landing";
import type { IntentProgress, IntentResult, PendingIntent } from "@/utils/intent/read";
import { followOnScreen } from "../diffs/on-screen";
import { showDiffOrder } from "../diffs/order";
import { followViewed, type VisitViewed } from "../diffs/viewed";
import {
  type ChangedFile,
  type FilesPage,
  followOverlay,
  type NativeTree,
  observeTree,
  readChangedFiles,
} from "../files-page";
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
  /**
   * The native tree the sections now list: the narrow layout's overlay while it is open, else the
   * page's own. Called before the re-list.
   */
  shownIn?(tree: NativeTree): void;
}

/**
 * Lands `intent` on `views`, then re-lists their sections after each change outside `ignore` to the
 * shown native tree, `page`'s or its overlay copy while open, until `signal` aborts. Each switch
 * between the two tells `views` through `shownIn` first. Reads `intent` once. A read that rejects
 * is logged and lands path-only, as `failed`.
 */
export function land(
  page: FilesPage,
  intent: PendingIntent,
  views: readonly LandingView[],
  { signal, ignore }: { signal: AbortSignal; ignore?: Node },
): void {
  let result: IntentResult | undefined;
  let shown: NativeTree = page;
  const relist = () => {
    if (!result) return;
    const sections = sectionsOf(landingOf(result), readChangedFiles(shown.sidebar));
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

  const showIn = (tree: NativeTree) => {
    shown = tree;
    for (const view of views) view.shownIn?.(tree);
    relist();
  };
  followOverlay(
    page,
    (overlay, closed) => {
      showIn(overlay);
      observeTree(overlay.sidebar, relist, { signal: closed, ignore });
      closed.addEventListener("abort", () => {
        // Teardown aborts closed too, after the sidebar has removed its nav.
        if (!signal.aborted) showIn(page);
      });
    },
    { signal },
  );
}

/** `read`'s result, or a path-only `failed` one, logged, when it rejects. */
const orFailed = (read: Promise<IntentResult>): Promise<IntentResult> =>
  read.catch((error: unknown): IntentResult => {
    console.error("gh-prism: reading intent failed", error);
    return { ok: false, problem: "failed" };
  });

/**
 * Mounts the sidebar, the diff order, the diffstat, and the on-screen and Viewed trackers that feed
 * the sidebar on one page of a visit, and lands `intent` on them in that order, until `signal`
 * aborts. `viewed` is the visit's Viewed state, shared by its pages.
 */
export function showVisit(
  page: FilesPage,
  signal: AbortSignal,
  {
    intent,
    diffstat,
    viewed,
  }: { intent: PendingIntent; diffstat: DiffstatChoice; viewed: VisitViewed },
): void {
  const sidebar = showSections(page, signal);
  const views = [
    sidebar,
    showDiffOrder(page, signal),
    showDiffstat(page, { choice: diffstat, signal }),
    followOnScreen(page, sidebar.onScreen, signal),
    followViewed(page, viewed, sidebar.viewed, signal),
  ];
  // The sidebar draws inside the tree's container, so its own changes must not re-list.
  land(page, intent, views, { signal, ignore: sidebar.root });
}
