/**
 * The "Wrap lines" item in gh-prism's diff settings group, and the `<html>` attribute that unwraps
 * every diff while it is unchecked.
 */

import type { FilesPage } from "../files-page";
import type { MenuGate, PrismMenuItem } from "./prism-menu";
import { followSideScroll } from "./side-scroll";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./wrap-lines.css?inline";

/** Whether diffs wrap long lines. One per tab, so the choice carries to the next page. */
export interface WrapChoice {
  on: boolean;
}

/** The tab's Wrap lines choice for `wrapLinesItem` to apply, and how to persist a flip. */
export interface WrapLinesOptions {
  readonly choice: WrapChoice;
  /** Remembers the choice the item flipped to. */
  readonly save: (on: boolean) => void;
}

/**
 * The Wrap lines item, which unwraps `page`'s diffs while it is unchecked and its group's gate is
 * open, until `signal` aborts. Diffs stay wrapped while the gate is closed or given up.
 */
export function wrapLinesItem(
  page: FilesPage,
  signal: AbortSignal,
  { choice, save }: WrapLinesOptions,
): PrismMenuItem {
  const doc = page.sidebar.ownerDocument;
  let gate: MenuGate = "closed";

  let unwrapped: AbortController | undefined;
  const apply = () => {
    if (gate === "open" && !choice.on) {
      if (unwrapped) return;
      unwrapped = new AbortController();
      const whileUnwrapped = AbortSignal.any([signal, unwrapped.signal]);
      const style = Object.assign(doc.createElement("style"), { textContent: css });
      doc.head.append(style);
      doc.documentElement.dataset.ghPrismWrap = "off";
      whileUnwrapped.addEventListener("abort", () => {
        style.remove();
        delete doc.documentElement.dataset.ghPrismWrap;
      });
      followSideScroll(page, whileUnwrapped);
    } else {
      unwrapped?.abort();
      unwrapped = undefined;
    }
  };

  return {
    id: "gh-prism-wrap-lines",
    text: "Wrap lines",
    checked: () => choice.on,
    pick: () => {
      choice.on = !choice.on;
      save(choice.on);
      apply();
    },
    follow: (next) => {
      gate = next;
      apply();
    },
  };
}
