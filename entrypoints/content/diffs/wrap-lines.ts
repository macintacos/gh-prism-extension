/**
 * The "Wrap lines" item in GitHub's diff settings menu, and the `<html>` attribute that unwraps
 * every diff while it is unchecked.
 */

import {
  addTrailingIcon,
  diffTables,
  type FilesPage,
  findCompactLineHeight,
  findLayoutGear,
  followLayoutMenu,
  type LayoutMenu,
  menuEntry,
  observeDiffs,
} from "../files-page";
import { prismGlyph } from "../ui/mark";
import { followSideScroll } from "./side-scroll";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./wrap-lines.css?inline";

/** Whether diffs wrap long lines. One per tab, so the choice carries to the next page. */
export interface WrapChoice {
  on: boolean;
}

/** The tab's Wrap lines choice for `showWrapLines` to apply, and how to persist a flip. */
export interface WrapLinesOptions {
  readonly choice: WrapChoice;
  /** Remembers the choice the item flipped to. */
  readonly save: (on: boolean) => void;
}

const ITEM_ID = "gh-prism-wrap-lines";

/**
 * Adds "Wrap lines" after Compact line height each time `page`'s diff settings menu opens, and
 * unwraps the diffs while it is unchecked, until `signal` aborts. Diffs stay wrapped until the gear
 * is found, and for the rest of the page once a menu opens without Compact line height.
 */
export function showWrapLines(
  page: FilesPage,
  signal: AbortSignal,
  { choice, save }: WrapLinesOptions,
): void {
  const doc = page.sidebar.ownerDocument;
  let gate: "closed" | "open" | "given up" = "closed";
  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`gh-prism: ${message}`);
  };

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

  const openGate = () => {
    if (gate !== "closed") return;
    if (findLayoutGear(page)) gate = "open";
    else if (diffTables(page.diffs).length > 0)
      warnOnce("the diff settings gear is missing, so diffs keep wrapping long lines");
    apply();
  };

  const addItem = (menu: LayoutMenu) => {
    const compact = findCompactLineHeight(menu);
    if (!compact) {
      gate = "given up";
      apply();
      warnOnce("the diff settings menu has no Compact line height, so it gets no Wrap lines");
      return;
    }
    const flip = () => {
      choice.on = !choice.on;
      save(choice.on);
      apply();
    };
    const item = menuEntry(compact, {
      id: ITEM_ID,
      text: "Wrap lines",
      role: "menuitemcheckbox",
      checked: choice.on,
      pick: flip,
    });
    addTrailingIcon(menu, item, prismGlyph(doc, {}));
    compact.after(item);
  };

  observeDiffs(page.diffs, openGate, { signal });
  followLayoutMenu(
    doc,
    (menu) => {
      openGate();
      if (gate === "open") addItem(menu);
    },
    { signal },
  );
  openGate();
}
