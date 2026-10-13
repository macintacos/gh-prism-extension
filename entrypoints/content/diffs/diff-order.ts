/**
 * Lays GitHub's diffs out in the order the sidebar lists their files, with CSS `order`; no node
 * React renders is moved, so comments, Viewed, and GitHub's own scroll to a file keep working.
 * Each listed file's entry, the list child GitHub renders, deliberately gets an inline `order`
 * and `animation-delay`: that restyles the entry alone, where a `:has()` rule per file is matched
 * against every entry's subtree. React sets only the style keys it renders, so both survive its
 * re-renders; the view's removal strips them. GitHub's virtualized lists, which place each diff
 * absolutely, keep GitHub's order.
 */

import { SECTIONS } from "@/utils/sections";
import {
  afterEntries,
  appendToDiffs,
  diffEntryOf,
  type FilesPage,
  findDiffList,
  isDiffAnchor,
  PAGE_KINDS,
  type PageKind,
  reorderable,
} from "../files-page";
import { el } from "../ui/dom";
import { type LoadingView, loadingView } from "../ui/loading-view";
import type { LandingView } from "../visit/visit";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./diff-order.css?raw";
import { retakeHash } from "./reveal";

const STAGGER_MS = 50;
const ANIMATION_MS = 280;
// Holds the reveal until the last section's files have dropped in, with slack.
const REVEAL_MS = (SECTIONS.length - 1) * STAGGER_MS + ANIMATION_MS + 120;
// A read that stalls this long leaves the diffs to read in GitHub's order meanwhile.
const COVER_LIMIT_MS = 15_000;

/**
 * Rules that put `kind`'s files after the ones `arrange` places, hide its diff list while
 * covered, and drop its files in once revealed, each after the inline delay `arrange` gives its
 * section.
 */
export function listRules(kind: PageKind): string {
  const { diffList, diffEntries } = kind;
  const block = kind.listLayout === "block";
  return [
    // `order` takes effect only in a flex or grid container.
    ...(block ? [`${diffList} { display: flex; flex-direction: column; }`] : []),
    // A file the sidebar doesn't list, such as one its filter hides, follows the ones it does;
    // never `!important`, so a listed entry's inline `order` wins.
    `${diffEntries} { order: 999999; }`,
    `${afterEntries(kind)} { order: 1000000; }`,
    // A block list keeps its toolbar, the list's first child, in view.
    `html[data-gh-prism-diffs="covered"] ${block ? `${diffList} > :not(:first-child)` : diffList} { display: none !important; }`,
    // Never `!important`: the entry's inline `animation-delay` staggers it.
    "@media (prefers-reduced-motion: no-preference) { " +
      `html[data-gh-prism-diffs="revealed"] ${diffEntries} { ` +
      `animation: gh-prism-diff-reveal ${ANIMATION_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; } }`,
  ].join("\n");
}

const SHEET = [css, ...PAGE_KINDS.map(listRules)].join("\n");

/** Each diff anchor `sections` list, in rank order, mapped to the first section that lists it. */
function ranking(sections: readonly (readonly string[])[]): ReadonlyMap<string, number> {
  const ranked = new Map<string, number>();
  for (const [section, anchors] of sections.entries())
    for (const anchor of anchors)
      if (isDiffAnchor(anchor) && !ranked.has(anchor)) ranked.set(anchor, section);
  return ranked;
}

/**
 * Rules that sit `first`, the top-ranked file, flush under a block list's toolbar. GitHub spaces
 * the entries with an inline `padding-top` React owns, so an `!important` rule overrides it.
 */
function flushFirst(kind: PageKind, first: string | undefined): string {
  if (!first || kind.listLayout !== "block") return "";
  return [
    `${kind.diffEntries} { padding-top: 16px !important; }`,
    `${kind.diffEntry(first)} { padding-top: 0 !important; }`,
  ].join("\n");
}

/** Sets `entry`'s inline `property` to `value`, `""` removing it, skipping a no-op write. */
function setStyle(entry: HTMLElement, property: string, value: string): void {
  if (entry.style.getPropertyValue(property) !== value) entry.style.setProperty(property, value);
}

/**
 * Gives `list`'s entries their place in `ranked`, inline, and strips it from every other child: a
 * file the filter hides, or a restored copy of a previous visit's entries.
 */
function placeEntries(page: FilesPage, list: Element, ranked: ReadonlyMap<string, number>): void {
  const placed = new Map<Element, readonly [string, string]>();
  for (const [rank, [anchor, section]] of [...ranked].entries()) {
    const entry = diffEntryOf(page, list, anchor);
    if (entry) placed.set(entry, [`${rank + 1}`, `${section * STAGGER_MS}ms`]);
  }
  for (const child of list.children) {
    if (!(child instanceof HTMLElement)) continue;
    const [order, delay] = placed.get(child) ?? ["", ""];
    setStyle(child, "order", order);
    setStyle(child, "animation-delay", delay);
  }
}

/**
 * Keeps `page`'s listed entries where `ranked` places them, re-placing any GitHub adds or
 * replaces, and any list it mounts or swaps in, until `signal` aborts.
 */
function entryPlacer(
  page: FilesPage,
  signal: AbortSignal,
): (ranked: ReadonlyMap<string, number>) => void {
  let ranked: ReadonlyMap<string, number> = new Map();
  // `undefined` until bound, so a missing list is watched for too.
  let list: Element | null | undefined;
  // Not debounced, so an entry is placed before it paints. The list is watched through its parent
  // to catch a swap; diffs swapped inside kept entries are deliberately not watched.
  const observer = new MutationObserver(() => place());
  const place = () => {
    const found = findDiffList(page);
    if (found !== list) {
      observer.disconnect();
      list = found;
      if (!list) observer.observe(page.diffs, { childList: true, subtree: true });
      else {
        observer.observe(list, { childList: true });
        if (list.parentElement) observer.observe(list.parentElement, { childList: true });
      }
    }
    if (list) placeEntries(page, list, ranked);
  };
  signal.addEventListener("abort", () => {
    observer.disconnect();
    if (list) placeEntries(page, list, new Map());
  });
  return (next) => {
    ranked = next;
    place();
  };
}

/** Lays out one page's diff list; see `orderDiffs`. */
interface DiffOrder {
  /** Hides the diffs behind `loader`, shown where they start, until `reveal` or 15 seconds pass. */
  cover(loader: Element): void;
  /**
   * Orders the diffs as `ranking` ranks them, or not at all while they can't be reordered. Changes
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
  const place = entryPlacer(page, signal);
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
      const ranked = reorderable(page) ? ranking(sections) : new Map<string, number>();
      place(ranked);
      const [first] = ranked.keys();
      const text = flushFirst(page.kind, first);
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
