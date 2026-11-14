/**
 * The "Wrap lines" item in GitHub's diff settings menu, and the `<html>` attribute that unwraps
 * every diff while it is unchecked.
 */

import {
  copyMenuItem,
  diffTables,
  type FilesPage,
  findCompactLineHeight,
  findLayoutGear,
  followLayoutMenu,
  type LayoutMenu,
  observeDiffs,
} from "../files-page";
import { followSideScroll } from "./side-scroll";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./wrap-lines.css?inline";

export interface WrapLinesOptions {
  /** The saved choice, shared by every visit. */
  readonly wrap: { on: boolean };
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
  { wrap, save }: WrapLinesOptions,
): void {
  const doc = page.sidebar.ownerDocument;
  let gate: "closed" | "open" | "given up" = "closed";
  let warned = false;
  const warnOnce = (message: string) => {
    if (warned) return;
    warned = true;
    console.warn(`gh-prism: ${message}`);
  };

  let unwrapped: AbortController | undefined;
  const apply = () => {
    if (gate === "open" && !wrap.on) {
      doc.documentElement.dataset.ghPrismWrap = "off";
      if (unwrapped) return;
      unwrapped = new AbortController();
      followSideScroll(page, AbortSignal.any([signal, unwrapped.signal]));
    } else {
      delete doc.documentElement.dataset.ghPrismWrap;
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
    const item = wrapItem(compact, wrap.on, () => {
      wrap.on = !wrap.on;
      save(wrap.on);
      apply();
      return wrap.on;
    });
    compact.after(item);
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => style.remove());

  observeDiffs(page.diffs, openGate, { signal });
  followLayoutMenu(doc, (menu) => gate !== "given up" && addItem(menu), { signal });
  signal.addEventListener("abort", () => delete doc.documentElement.dataset.ghPrismWrap);
  openGate();
}

/**
 * A copy of `compact` labelled "Wrap lines", checked while `on`, that runs `flip` on click, Enter,
 * or Space, shows what it returns, then closes the menu.
 */
function wrapItem(compact: HTMLElement, on: boolean, flip: () => boolean): HTMLElement {
  const { item, label } = copyMenuItem({ item: compact });
  item.id = ITEM_ID;
  item.setAttribute("role", "menuitemcheckbox");
  item.setAttribute("tabindex", "-1");
  item.setAttribute("aria-labelledby", `${ITEM_ID}--label`);
  item.setAttribute("aria-checked", String(on));
  label.id = `${ITEM_ID}--label`;
  label.textContent = "Wrap lines";

  const flipAndClose = () => {
    item.setAttribute("aria-checked", String(flip()));
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  };
  item.addEventListener("click", flipAndClose);
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    flipAndClose();
  });
  return item;
}
