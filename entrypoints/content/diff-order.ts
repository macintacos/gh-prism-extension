/**
 * Lays GitHub's diffs out in the order the sidebar lists their files, with CSS `order` from a
 * stylesheet keyed on each file's anchor: no node React renders is moved or mutated, so comments,
 * Viewed, and GitHub's own scroll to a file keep working. GitHub's virtualized lists, which place
 * each diff absolutely, keep GitHub's order.
 */

import { SECTIONS } from "@/utils/sections";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./diff-order.css?raw";
import { el } from "./dom";
import {
  afterEntries,
  appendToDiffs,
  type FilesPage,
  isDiffAnchor,
  PAGE_KINDS,
  type PageKind,
  reorderable,
} from "./files-page";
import { type LoadingView, loadingView } from "./loading-view";
import { retakeHash } from "./reveal";
import type { LandingView } from "./visit";

const STAGGER_MS = 50;
const ANIMATION_MS = 280;
// Holds the reveal until the last section's files have dropped in, with slack.
const REVEAL_MS = (SECTIONS.length - 1) * STAGGER_MS + ANIMATION_MS + 120;
// A read that stalls this long leaves the diffs to read in GitHub's order meanwhile.
const COVER_LIMIT_MS = 15_000;

/**
 * Rules that put `kind`'s files after the ones `arrangement` ranks, hide its diff list while
 * covered, and drop its files in a section at a time, as the sidebar's sections do, once revealed.
 */
export function listRules(kind: PageKind): string {
  const { diffList, diffEntries } = kind;
  const block = kind.listLayout === "block";
  return [
    // `order` takes effect only in a flex or grid container.
    ...(block ? [`${diffList} { display: flex; flex-direction: column; }`] : []),
    // A file the sidebar doesn't list, such as one its filter hides, follows the ones it does.
    `${diffEntries} { order: 999999; }`,
    `${afterEntries(kind)} { order: 1000000; }`,
    // A block list keeps its toolbar, the list's first child, in view.
    `html[data-gh-prism-diffs="covered"] ${block ? `${diffList} > :not(:first-child)` : diffList} { display: none !important; }`,
    "@media (prefers-reduced-motion: no-preference) { " +
      `html[data-gh-prism-diffs="revealed"] ${diffEntries} { ` +
      `animation: gh-prism-diff-reveal ${ANIMATION_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; ` +
      `animation-delay: calc(var(--gh-prism-section-order, 0) * ${STAGGER_MS}ms); } }`,
  ].join("\n");
}

const SHEET = [css, ...PAGE_KINDS.map(listRules)].join("\n");

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
    // GitHub spaces a block list's files by their place in its order; the new first sits flush.
    ...(first && kind.listLayout === "block"
      ? [
          `${kind.diffEntries} { padding-top: 16px !important; }`,
          `${kind.diffEntry(first)} { padding-top: 0 !important; }`,
        ]
      : []),
  ].join("\n");
}

/** Lays out one page's diff list; see `orderDiffs`. */
interface DiffOrder {
  /** Hides the diffs behind `loader`, shown where they start, until `reveal` or 15 seconds pass. */
  cover(loader: Element): void;
  /**
   * Orders the diffs as `arrangement` does, or not at all while they can't be reordered. Changes
   * nothing when the order is unchanged.
   */
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
  const style = Object.assign(doc.createElement("style"), { textContent: SHEET });
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
      const text = reorderable(page) ? arrangement(page.kind, sections) : "";
      if (rules.textContent !== text) rules.textContent = text;
    },
    reveal,
  };
}

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
