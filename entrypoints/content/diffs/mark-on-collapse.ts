/**
 * The "Mark files viewed when collapsed" item in gh-prism's diff settings group: while it is
 * checked, collapsing a file with its chevron marks it Viewed, and expanding it again unmarks it
 * when collapsing was what marked it.
 */

import {
  anchorOf,
  expandButtonOf,
  type FilesPage,
  fileHeaderAt,
  findDiff,
  observeViewed,
  readViewed,
  showsViewed,
  viewedToggleOf,
} from "../files-page";
import type { MenuGate, PrismMenuItem } from "./prism-menu";
import { markViewed } from "./viewed";

/** Whether collapsing a file marks it Viewed. One per tab, so the choice carries to the next page. */
export interface MarkOnCollapseChoice {
  on: boolean;
}

/** The tab's choice for `markOnCollapseItem` to apply, how to persist a flip, and what it marked. */
export interface MarkOnCollapseOptions {
  readonly choice: MarkOnCollapseChoice;
  /** Remembers the choice the item flipped to. */
  readonly save: (on: boolean) => void;
  /**
   * The visit's files that collapsing marked Viewed, by diff anchor; shared by the visit's pages.
   * The item adds and removes entries, drops any a read finds unviewed, and clears it when
   * unchecked.
   */
  readonly marked: Set<string>;
}

/**
 * The mark-on-collapse item, which marks `page`'s files Viewed as their chevrons collapse them,
 * and unmarks those it marked as they expand, while it is checked and its group's gate is open,
 * until `signal` aborts.
 */
export function markOnCollapseItem(
  page: FilesPage,
  signal: AbortSignal,
  { choice, save, marked }: MarkOnCollapseOptions,
): PrismMenuItem {
  let gate: MenuGate = "closed";

  let activation: AbortController | undefined;
  const apply = () => {
    if (gate === "open" && choice.on) {
      if (activation) return;
      activation = new AbortController();
      const whileActive = AbortSignal.any([signal, activation.signal]);
      // Captured: GitHub collapses the diff, detaching the chevron's svg, before the click bubbles.
      page.diffs.addEventListener("click", (event) => onClick(page, event, marked, whileActive), {
        capture: true,
        signal: whileActive,
      });
      // A file the reviewer unticks by hand is no longer collapsing's to unmark.
      observeViewed(
        page.diffs,
        () => {
          for (const [anchor, viewed] of readViewed(page)) if (!viewed) marked.delete(anchor);
        },
        { signal: whileActive },
      );
    } else {
      activation?.abort();
      activation = undefined;
    }
  };

  return {
    id: "gh-prism-mark-viewed-on-collapse",
    text: "Mark files viewed when collapsed",
    checked: () => choice.on,
    pick: () => {
      choice.on = !choice.on;
      save(choice.on);
      if (!choice.on) marked.clear();
      apply();
    },
    follow: (next) => {
      gate = next;
      apply();
    },
  };
}

/** Marks or unmarks the file whose chevron `event` clicked, once GitHub has collapsed or expanded it. */
function onClick(page: FilesPage, event: Event, marked: Set<string>, whileActive: AbortSignal) {
  // Alt-click collapses or expands every file at once; leave those to the reviewer.
  if (event instanceof MouseEvent && event.altKey) return;
  const { target } = event;
  if (!(target instanceof Element)) return;
  const header = fileHeaderAt(target);
  if (!header?.chevron.contains(target)) return;
  const { link } = header;
  const anchor = anchorOf(link);
  if (!anchor) return;

  setTimeout(() => {
    if (whileActive.aborted) return;
    const collapsed = expandButtonOf(findDiff(page, link)) !== null;
    if (collapsed) {
      const toggle = viewedToggleOf(page, link);
      // Already viewed means viewed by hand, so it never enters the set and expanding leaves it.
      if (!toggle || showsViewed(toggle)) return;
      marked.add(anchor);
      void markViewed(page, link, true, { signal: whileActive });
    } else if (marked.delete(anchor)) {
      void markViewed(page, link, false, { signal: whileActive });
    }
  });
}
