import { afterEach, beforeEach, vi } from "vitest";
import type { DiffstatChoice } from "../../entrypoints/content/diffstat-view";
import { findFilesPage } from "../../entrypoints/content/files-page";
import { showVisit } from "../../entrypoints/content/visit";
import type { IntentResult, PendingIntent } from "../../utils/intent";
import { byId, loadFixture } from "./files-page";
import { landedWith } from "./intent";

export const view = () => document.querySelector<HTMLElement>(".gh-prism-sections");
export const progressBar = () => view()?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;

export const sectionKeys = () =>
  [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
    (section) => section.dataset.section,
  );

export function treeHost(section: string): HTMLElement {
  const host = document.querySelector<HTMLElement>(
    `.gh-prism-section[data-section="${section}"] .gh-prism-tree`,
  );
  if (!host) throw new Error(`no tree in ${section}`);
  return host;
}

export const rowsIn = (section: string) => [
  ...(treeHost(section).shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
];

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

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
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
    showVisit(page, controller.signal, { intent, diffstat });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    loadFixture();
    remountWith();
  });
  afterEach(() => {
    controller.abort();
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
