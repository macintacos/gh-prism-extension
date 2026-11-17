import { ARROW_DOWN_ICON, el, icon } from "./dom";

// The fade's 32px plus a row: the last row in view before a page stays in view after it.
const PAGE_OVERLAP = 64;

/**
 * `content` in a list that scrolls on its own, fading its bottom edge and offering a "Scroll
 * down" button while more of it sits below. Styled by `ui/scroll-cue.css`.
 */
export function scrollCue(doc: Document, ...content: Node[]): HTMLElement {
  const list = el(doc, "div", "gh-prism-scroll-cue-list", ...content);
  // Focusable, so a page that reaches the end can hand focus to it. A Tab stop only where
  // nothing inside can scroll it, as Chromium does: Firefox tabs into any scroller.
  list.tabIndex = list.querySelector("a[href], button") ? -1 : 0;

  const arrow = el(doc, "button", "gh-prism-scroll-cue-arrow", icon(doc, ARROW_DOWN_ICON, {}));
  arrow.type = "button";
  arrow.setAttribute("aria-label", "Scroll down");
  arrow.addEventListener("click", () => scrollPage(list, arrow));

  return el(doc, "div", "gh-prism-scroll-cue", list, arrow);
}

/** Scrolls `list` down a page. */
function scrollPage(list: HTMLElement, arrow: HTMLElement): void {
  const top = Math.max(list.clientHeight - PAGE_OVERLAP, list.clientHeight / 2);

  // The arrow hides at the end, and a hidden button drops focus, which closes the card.
  const end = list.scrollHeight - list.clientHeight - 1;
  if (list.ownerDocument.activeElement === arrow && list.scrollTop + top >= end)
    list.focus({ preventScroll: true });

  const reduce = list.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  list.scrollBy({ top, behavior: reduce ? "instant" : "smooth" });
}
