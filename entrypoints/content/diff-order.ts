/**
 * Lays GitHub's diffs out in the order the sidebar lists their files, with CSS `order` from a
 * stylesheet keyed on each file's anchor: no node React renders is moved or mutated, so comments,
 * Viewed, and GitHub's own scroll to a file keep working. GitHub's virtualized lists, which place
 * each diff absolutely, keep GitHub's order.
 */

// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./diff-order.css?raw";
import { el } from "./dom";
import {
  appendToDiffs,
  type FilesPage,
  isDiffAnchor,
  type PageKind,
  reorderable,
  retakeHash,
} from "./files-page";
import { type LoadingView, loadingView } from "./loading-view";
import type { LandingView } from "./visit";

// The longest stagger in diff-order.css, four sections of delay plus the reveal itself, and slack.
const REVEAL_MS = 600;
// A read that stalls this long leaves the diffs to read in GitHub's order meanwhile.
const COVER_LIMIT_MS = 15_000;

/**
 * Rules that order the diff list's entries as `sections` list their files' anchors, sections
 * first: a file in several sections takes the first, and its entry carries that section's index
 * as `--gh-prism-section-order`.
 */
function arrangement(kind: PageKind, sections: readonly (readonly string[])[]): string {
  const ranked = new Map<string, number>();
  for (const [section, anchors] of sections.entries())
    for (const anchor of anchors)
      if (isDiffAnchor(anchor) && !ranked.has(anchor)) ranked.set(anchor, section);
  const [first] = ranked.keys();
  return [
    ...[...ranked].map(
      ([anchor, section], rank) =>
        `${kind.diffEntry(anchor)} { order: ${rank + 1}; --gh-prism-section-order: ${section}; }`,
    ),
    // GitHub spaces a commit's files by their place in its order; the new first sits flush.
    ...(first && kind.spacedEntries
      ? [
          `${kind.spacedEntries} { padding-top: 16px !important; }`,
          `${kind.diffEntry(first)} { padding-top: 0 !important; }`,
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
      appendToDiffs(page, next);
      root.dataset.ghPrismDiffs = "covered";
      timer = setTimeout(reveal, COVER_LIMIT_MS);
    },
    arrange(sections) {
      const text = arrangement(page.kind, sections);
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
