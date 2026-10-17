import { afterEach, beforeEach, vi } from "vitest";
import { visitViewed } from "../../entrypoints/content/diffs/viewed";
import { findFilesPage } from "../../entrypoints/content/files-page";
import type { DiffstatChoice } from "../../entrypoints/content/header/diffstat-view";
import { showVisit } from "../../entrypoints/content/visit/land";
import type { IntentResult, PendingIntent } from "../../utils/intent/read";
import { byId, loadFixture } from "./files-page";
import { landedWith } from "./intent";

/** The sections view, or `null` while none is mounted. */
export const view = () => document.querySelector<HTMLElement>(".gh-prism-sections");
/** The sections view's progress bar, or `null` once intent has landed. */
export const progressBar = () => view()?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;

/** The keys of the sections the sidebar lists, in its order. */
export const sectionKeys = () =>
  [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
    (section) => section.dataset.section,
  );

/** The tree host in `section`'s sidebar section; throws when there is none. */
export function treeHost(section: string): HTMLElement {
  const host = document.querySelector<HTMLElement>(
    `.gh-prism-section[data-section="${section}"] .gh-prism-tree`,
  );
  if (!host) throw new Error(`no tree in ${section}`);
  return host;
}

/** The rendered rows, directories and files, of `section`'s tree. */
export const rowsIn = (section: string) => [
  ...(treeHost(section).shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
];

/** The paths of the file rows `section`'s tree renders, in order. */
export const filesIn = (section: string) =>
  rowsIn(section)
    .filter((row) => row.dataset.itemType === "file")
    .map((row) => row.dataset.itemPath);

/** Adds a native row for `path` after `after`'s row, as GitHub does when a file joins the PR. */
export function addNativeFile(path: string, after: string): void {
  const native = byId(after).cloneNode(true);
  if (!(native instanceof HTMLElement)) throw new Error("clone is not an element");
  native.id = path;
  byId(after).after(native);
}

/**
 * Advances fake timers past the observers' 50 ms debounce. The async advance runs the
 * MutationObserver's pending microtask first.
 */
export const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

/** Mounts a landed visit on the loaded fixture before each test, and aborts it after. */
export function mountsVisit() {
  let controller = new AbortController();

  /**
   * Replaces the mounted visit with one that waits on `intent`, in a tab whose header counter
   * last chose `diffstat`.
   */
  const remountWith = (
    intent: PendingIntent = () => landedWith(),
    diffstat: DiffstatChoice = { view: "breakout" },
  ): void => {
    controller.abort();
    controller = new AbortController();

    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    showVisit(page, controller.signal, { intent, diffstat, viewed: visitViewed(undefined) });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    loadFixture();
    remountWith();
  });

  afterEach(() => {
    controller.abort();
    // Preact schedules its after-paint flush only onto an empty queue, so one flush the clock
    // drops leaves every later tree queued, and alive, for the rest of the file.
    vi.runAllTimers();
    vi.useRealTimers();
  });

  return {
    remountWith,
    /** Mounts the visit on an intent that settles as `result`, and lets it render. */
    landed: async (result: IntentResult): Promise<void> => {
      remountWith(() => Promise.resolve(result));
      await afterDebounce();
    },
    abort: () => controller.abort(),
  };
}

/** The stylesheets in the document whose rules select `className`. */
export const sheetsStyling = (className: string) =>
  [...document.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes(`.${className}`),
  );
