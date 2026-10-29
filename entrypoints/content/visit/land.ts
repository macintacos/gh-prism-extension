/**
 * Lands intent on each page of a Files view visit, and the diffstat alone on each page of a header
 * tab's visit (`showHeaderTab`). Hands each step (pending, progress, landed, then
 * the sections) to every view in one order, and owns the only observers of the native tree and of
 * the narrow layout's overlay copy, re-listing the sections from whichever is shown after each
 * change to it. It reads intent once per page; the caller shares that read across a visit's pages
 * (`shareIntent`).
 */

import {
  ownerFilter,
  type PrCodeOwners,
  type PrReviewer,
  type TeamMembersOf,
} from "@/utils/github/code-owners";
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
import type { OwnerFilter } from "../ui/owners-dialog";

/**
 * The native tree's files in the sections they land in: what the sidebar lists and the diffs
 * follow.
 */
export type FileSection = LandedSection<ChangedFile>;

/** Whether the changed file at a path stays in the sections. */
export type PathFilter = (path: string) => boolean;

/**
 * What a view draws as a page's intent lands. `land` calls every view's hook for a step before any
 * view's hook for the next.
 */
export interface LandingView {
  /** Intent, or the filter `land` was given, is still pending: draw the pending state. */
  pending?(): void;
  /** How far the read has got: the latest progress right after `pending`, then each new one. */
  progress?(progress: IntentProgress): void;
  /** Intent landed as `result`. */
  landed?(result: IntentResult): void;
  /**
   * The native tree's files in their sections: right after landing, then after each change to the
   * tree. `hidden` holds the diff anchors of every file gh-prism's own filter has left out of the
   * sections on this page, including those whose rows have since left the tree.
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
 * is logged and lands path-only, as `failed`. `keep`, when given, must not reject; it is part of
 * landing: the page stays pending until intent and `keep` have both settled, then lists only the
 * tree's files `keep` keeps; settling `undefined` keeps every file.
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
    keep?: Promise<PathFilter | undefined>;
  },
): void {
  let result: IntentResult | undefined;
  let filter: PathFilter | undefined;
  // A filter never changes once settled, so a file it drops stays dropped after its row is gone.
  const hidden = new Set<string>();
  let shown: NativeTree = page;
  const relist = () => {
    if (!result) return;
    const kept = partition(readChangedFiles(shown.sidebar), filter, hidden);
    const sections = sectionsOf(landingOf(result), kept);
    for (const view of views) view.sections?.(sections, hidden);
  };
  const settle = (landed: IntentResult, settled?: PathFilter) => {
    result = landed;
    filter = settled;
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
    void Promise.all([orFailed(Promise.resolve(read)), keep]).then(([landed, settled]) => {
      if (!signal.aborted) settle(landed, settled);
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

/**
 * The `files` that `filter` keeps (all of them when it is `undefined`); adds the diff anchors of
 * the rest to `hidden`.
 */
function partition(
  files: readonly ChangedFile[],
  filter: PathFilter | undefined,
  hidden: Set<string>,
): ChangedFile[] {
  const kept: ChangedFile[] = [];
  for (const file of files) {
    if (!filter || filter(file.path)) kept.push(file);
    else {
      const anchor = anchorOf(file.link);
      if (anchor !== undefined) hidden.add(anchor);
    }
  }
  return kept;
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
 * and `prReviewers` are the visit's code owners and PR reviewers, read apart; each can land after
 * the sidebar draws or not at all, and never rejects. The sidebar shows the code owners once they
 * land, reading a team's members through `teamMembers`, the visit's reader. `owner`, the code
 * owner the page's URL names, if any, holds the page pending until the reads its filter needs
 * land, the code owners for a team and the PR reviewers too for a user, or for 10 s at most, then
 * narrows the sidebar and the diffs to that owner's files, counting the teams GitHub names a user
 * as reviewing for. A read still out by then counts as failed: every file shows when the code
 * owners can't be read, and only the owner's own files when the PR reviewers can't. `whatsNew`,
 * when given, opens the sidebar with its block. `filter`, when given, lets the sidebar's code owner
 * dialogs filter by an owning team.
 */
export function showVisit(
  page: FilesPage,
  signal: AbortSignal,
  {
    intent,
    diffstat,
    viewed,
    codeOwners,
    prReviewers,
    teamMembers,
    owner,
    filter,
    whatsNew,
  }: {
    intent: PendingIntent;
    diffstat: DiffstatOptions;
    viewed: VisitViewed;
    codeOwners?: Promise<PrCodeOwners | undefined>;
    prReviewers?: Promise<readonly PrReviewer[] | undefined>;
    teamMembers: TeamMembersOf;
    owner?: string;
    filter?: OwnerFilter;
    whatsNew?: WhatsNew;
  },
): void {
  const sidebar = showSections(page, signal, { teamMembers, filter });
  void codeOwners?.then((read) => {
    if (read && !signal.aborted) sidebar.owners(read);
  });
  if (whatsNew) sidebar.root.prepend(whatsNewBlock(page.sidebar.ownerDocument, whatsNew));
  const views = [
    sidebar,
    showDiffOrder(page, signal),
    followFileKeys(page, signal),
    showDiffstat(headerOf(page), { ...diffstat, signal }),
    followOnScreen(page, sidebar.onScreen, signal),
    followViewed(page, viewed, sidebar.viewed, signal),
  ];
  const keep =
    owner === undefined || codeOwners === undefined
      ? undefined
      : filterOf(owner, codeOwners, prReviewers);
  // The sidebar draws inside the tree's container, so its own changes must not re-list.
  land(page, intent, views, { signal, ignore: sidebar.root, keep });
}

const READ_TIMEOUT_MS = 10_000;

/** `read`'s value, or `undefined`, as from a failed read, once it has taken `READ_TIMEOUT_MS`. */
const settledWithin = <T>(read: Promise<T | undefined> | undefined): Promise<T | undefined> =>
  Promise.race([read, new Promise<undefined>((resolve) => setTimeout(resolve, READ_TIMEOUT_MS))]);

/**
 * The filter keeping `owner`'s files, once the reads it needs have settled or timed out: a team's
 * files need only `codeOwners`, and a user's need `prReviewers` too, for their teams.
 */
async function filterOf(
  owner: string,
  codeOwners: Promise<PrCodeOwners | undefined>,
  prReviewers: Promise<readonly PrReviewer[] | undefined> | undefined,
): Promise<PathFilter | undefined> {
  const [read, reviewers] = await Promise.all([
    settledWithin(codeOwners),
    owner.includes("/") ? undefined : settledWithin(prReviewers),
  ]);
  return read && ownerFilter(read, owner, reviewers ?? []);
}
