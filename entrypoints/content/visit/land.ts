/**
 * Lands intent on each page of a Files view visit, and the diffstat alone on each page of a header
 * tab's visit (`showHeaderTab`). Hands each step (pending, progress, landed, then
 * the sections) to every view in one order, and owns the only observers of the native tree and of
 * the narrow layout's overlay copy, re-listing the sections from whichever is shown after each
 * change to it. It reads intent once per page; the caller shares that read across a visit's pages
 * (`shareIntent`).
 */

import { ownedBy, type PrCodeOwners } from "@/utils/github/code-owners";
import { type LandedSection, landingOf, sectionsOf } from "@/utils/intent/landing";
import type { IntentProgress, IntentResult, PendingIntent } from "@/utils/intent/read";
import { followFileKeys } from "../diffs/file-keys";
import { followOnScreen } from "../diffs/on-screen";
import { showDiffOrder } from "../diffs/order";
import { followViewed, type VisitViewed } from "../diffs/viewed";
import {
  anchorOf,
  type ChangedFile,
  type FilesPage,
  followOverlay,
  type Header,
  headerOf,
  type NativeTree,
  observeTree,
  readChangedFiles,
} from "../files-page";
import { type DiffstatOptions, showDiffstat } from "../header/diffstat-view";
import { showSections } from "../sidebar/sections-view";
import { type WhatsNew, whatsNewBlock } from "../sidebar/whats-new";

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
   * tree. `hidden` holds the diff anchors of the tree's files gh-prism's own filter leaves out of
   * the sections.
   */
  sections?(sections: readonly FileSection[], hidden: ReadonlySet<string>): void;
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
 * is logged and lands path-only, as `failed`. `keep`, when given, is part of landing: the page
 * stays pending until intent and `keep` have both settled, then lists only the tree's files `keep`
 * keeps; settling `undefined` keeps every file.
 */
export function land(
  page: FilesPage,
  intent: PendingIntent,
  views: readonly LandingView[],
  {
    signal,
    ignore,
    keep,
  }: {
    signal: AbortSignal;
    ignore?: Node;
    keep?: Promise<((path: string) => boolean) | undefined>;
  },
): void {
  let result: IntentResult | undefined;
  let keeps: ((path: string) => boolean) | undefined;
  let shown: NativeTree = page;
  const relist = () => {
    if (!result) return;
    const { kept, hidden } = partition(readChangedFiles(shown.sidebar), keeps);
    const sections = sectionsOf(landingOf(result), kept);
    for (const view of views) view.sections?.(sections, hidden);
  };
  const settle = (landed: IntentResult, keeping?: (path: string) => boolean) => {
    result = landed;
    keeps = keeping;
    for (const view of views) view.landed?.(landed);
    relist();
  };

  let earlyProgress: IntentProgress | undefined;
  let pending = false;
  const read = intent((progress) => {
    if (!pending) earlyProgress = progress;
    else for (const view of views) view.progress?.(progress);
  });

  if (read instanceof Promise || keep) {
    pending = true;
    for (const view of views) view.pending?.();
    if (earlyProgress) for (const view of views) view.progress?.(earlyProgress);
    void Promise.all([orFailed(Promise.resolve(read)), keep]).then(([landed, keeping]) => {
      if (!signal.aborted) settle(landed, keeping);
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

/** `files` split into those `keeps` keeps, every one without it, and the others' diff anchors. */
function partition(
  files: readonly ChangedFile[],
  keeps: ((path: string) => boolean) | undefined,
): { kept: ChangedFile[]; hidden: Set<string> } {
  const kept: ChangedFile[] = [];
  const hidden = new Set<string>();
  for (const file of files) {
    if (!keeps || keeps(file.path)) kept.push(file);
    else {
      const anchor = anchorOf(file.link);
      if (anchor !== undefined) hidden.add(anchor);
    }
  }
  return { kept, hidden };
}

/**
 * Mounts the diffstat on one page of a header tab's visit: once intent lands, stands in for
 * `header`'s lines-changed counter as `diffstat` says, until `signal` aborts; a page dropped
 * before then shows nothing.
 */
export function showHeaderTab(
  header: Header,
  signal: AbortSignal,
  { intent, diffstat }: { intent: PendingIntent; diffstat: DiffstatOptions },
): void {
  void orFailed(Promise.resolve(intent(() => {}))).then((landed) => {
    // An aborted signal never fires `abort` again, so the counter would never come down.
    if (!signal.aborted) showDiffstat(header, { ...diffstat, signal }).landed(landed);
  });
}

/** `read`'s result, or a path-only `failed` one, logged, when it rejects. */
const orFailed = (read: Promise<IntentResult>): Promise<IntentResult> =>
  read.catch((error: unknown): IntentResult => {
    console.error("gh-prism: reading intent failed", error);
    return { ok: false, problem: "failed" };
  });

/**
 * Mounts the sidebar, the diff order, the j/k file keys, the diffstat, and the on-screen and Viewed
 * trackers that feed the sidebar on one page of a visit, and lands `intent` on them in that order,
 * until `signal` aborts. `viewed` is the visit's Viewed state, shared by its pages. `codeOwners`
 * is the visit's code owners and reviewers, which can land after the sidebar draws or not at all.
 * `owner`, the code owner the page's URL narrows it to, if any, narrows the sidebar and the diffs
 * to that owner's files once the code owners land, and to every file when they can't be read.
 * `whatsNew`, when given, opens the sidebar with its block.
 */
export function showVisit(
  page: FilesPage,
  signal: AbortSignal,
  {
    intent,
    diffstat,
    viewed,
    codeOwners,
    owner,
    whatsNew,
  }: {
    intent: PendingIntent;
    diffstat: DiffstatOptions;
    viewed: VisitViewed;
    codeOwners?: Promise<PrCodeOwners | undefined>;
    owner?: string;
    whatsNew?: WhatsNew;
  },
): void {
  const sidebar = showSections(page, signal);
  if (whatsNew) sidebar.root.prepend(whatsNewBlock(page.sidebar.ownerDocument, whatsNew));
  const views = [
    sidebar,
    showDiffOrder(page, signal),
    followFileKeys(page, signal),
    showDiffstat(headerOf(page), { ...diffstat, signal }),
    followOnScreen(page, sidebar.onScreen, signal),
    followViewed(page, viewed, sidebar.viewed, signal),
  ];
  // The sidebar draws inside the tree's container, so its own changes must not re-list.
  const keep =
    owner === undefined ? undefined : codeOwners?.then((read) => read && ownedBy(read, owner));
  land(page, intent, views, { signal, ignore: sidebar.root, keep });
}
