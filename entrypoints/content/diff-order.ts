/**
 * Lays GitHub's diffs out in the order the sidebar lists their files, with CSS `order` from a
 * stylesheet keyed on each file's anchor: no node React renders is moved or mutated, so comments,
 * Viewed, and GitHub's own scroll to a file keep working. GitHub's virtualized lists, which place
 * each diff absolutely, keep GitHub's order.
 */

// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./diff-order.css?raw";
import { el } from "./dom";
import { type FilesPage, retakeHash } from "./files-page";
import { type LoadingView, loadingView } from "./loading-view";
import type { LandingView } from "./visit";

// Keep in sync with diff-order.css: a pull request's progressive list, and a commit's list while
// its diffs are in flow. A virtualized commit nests each diff a level deeper.
const PR_LIST = '[data-testid="progressive-diffs-list"]';
const COMMIT_LIST = '#diff-content-parent > :has(> * > [role="region"])';
// Both of GitHub's virtualized lists index each row they place.
const VIRTUALIZED = '[data-index] [role="region"]';
const ANCHOR = /^diff-[0-9a-f]+$/;
// The longest stagger in diff-order.css, four sections of delay plus the reveal itself, and slack.
const REVEAL_MS = 600;
// A read that stalls this long leaves the diffs to read in GitHub's order meanwhile.
const COVER_LIMIT_MS = 15_000;

/** A file's entry in either list: a pull request's region carries the anchor; a commit's header links to it. */
const entryOf = (anchor: string) =>
  `${PR_LIST} > :has(#${anchor}), ${COMMIT_LIST} > :has(a[href="#${anchor}"])`;

/**
 * Rules that order the diff list's entries as `sections` list their files' anchors, sections
 * first: a file in several sections takes the first, and its entry carries that section's index
 * as `--gh-prism-section-order`.
 */
function arrangement(sections: readonly (readonly string[])[]): string {
  const ranked = new Map<string, number>();
  for (const [section, anchors] of sections.entries())
    for (const anchor of anchors)
      if (ANCHOR.test(anchor) && !ranked.has(anchor)) ranked.set(anchor, section);
  const [first] = ranked.keys();
  return [
    ...[...ranked].map(
      ([anchor, section], rank) =>
        `${entryOf(anchor)} { order: ${rank + 1}; --gh-prism-section-order: ${section}; }`,
    ),
    // GitHub spaces a commit's files by their place in its order; the new first sits flush.
    ...(first
      ? [
          `${COMMIT_LIST} > :has([role="region"]) { padding-top: 16px !important; }`,
          `${COMMIT_LIST} > :has(a[href="#${first}"]) { padding-top: 0 !important; }`,
        ]
      : []),
  ].join("\n");
}

/** Lays out one page's diff list; see `orderDiffs`. */
interface DiffOrder {
  /** Hides the diffs behind `loader`, shown where they start, until `reveal` or 15 seconds pass. */
  cover(loader: Element): void;
  /** Orders the diffs as `arrangement` does. Changes nothing when the order is unchanged. */
  arrange(sections: readonly (readonly string[])[]): void;
  /**
   * Lifts the cover: the diffs drop in section by section, and GitHub takes the URL's hash again,
   * since it can't scroll to a diff the cover hid.
   */
  reveal(): void;
}

/**
 * Whether GitHub lays `page`'s diffs out in a way their order can follow; false while
 * virtualized.
 */
export const reorderable = (page: FilesPage): boolean =>
  page.diffs.querySelector(VIRTUALIZED) === null;

/** Orders `page`'s diffs, and covers them while asked to, until `signal` aborts. */
function orderDiffs(page: FilesPage, signal: AbortSignal): DiffOrder {
  const doc = page.diffs.ownerDocument;
  const root = doc.documentElement;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const rules = doc.createElement("style");
  let loader: Element | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  doc.head.append(style, rules);
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    style.remove();
    rules.remove();
    loader?.remove();
    delete root.dataset.ghPrismDiffs;
  });
  const reveal = () => {
    if (!loader) return;
    clearTimeout(timer);
    loader.remove();
    loader = undefined;
    root.dataset.ghPrismDiffs = "revealed";
    if (doc.defaultView) retakeHash(doc.defaultView, { signal });
    timer = setTimeout(() => delete root.dataset.ghPrismDiffs, REVEAL_MS);
  };
  return {
    cover(next) {
      loader = next;
      // A commit's comments follow its diffs.
      const comments = page.diffs.querySelector(":scope > #comments");
      if (comments) comments.before(next);
      else page.diffs.append(next);
      root.dataset.ghPrismDiffs = "covered";
      timer = setTimeout(reveal, COVER_LIMIT_MS);
    },
    arrange(sections) {
      const text = arrangement(sections);
      if (rules.textContent !== text) rules.textContent = text;
    },
    reveal,
  };
}

// sections-view.css styles the cover, as it does loadingView; showVisit mounts the sidebar on
// every page.
/** Placeholder diffs: a file header over a few lines of code each. */
const diffSkeleton = (doc: Document) =>
  el(
    doc,
    "div",
    "gh-prism-diff-skeleton",
    ...[4, 2, 3].map((lines) =>
      el(
        doc,
        "div",
        "gh-prism-diff-card",
        el(doc, "span", "gh-prism-diff-card-header"),
        ...Array.from({ length: lines }, () => el(doc, "span", "")),
      ),
    ),
  );

/**
 * Orders `page`'s diffs as the sections list their files until `signal` aborts, covering them
 * with a progress bar while intent is pending, if their order can follow.
 */
export function showDiffOrder(page: FilesPage, signal: AbortSignal): LandingView {
  const order = orderDiffs(page, signal);
  let loading: LoadingView | undefined;
  return {
    pending() {
      if (!reorderable(page)) return;
      const doc = page.diffs.ownerDocument;
      loading = loadingView(doc, diffSkeleton(doc));
      loading.root.classList.add("gh-prism-diff-loading");
      order.cover(loading.root);
    },
    progress(progress) {
      loading?.progress(progress);
    },
    sections(sections) {
      order.arrange(
        sections.map(({ entries }) => entries.map(({ file }) => file.link.hash.slice(1))),
      );
      order.reveal();
    },
  };
}
