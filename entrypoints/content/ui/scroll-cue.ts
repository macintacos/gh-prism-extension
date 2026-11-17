import { ARROW_DOWN_ICON, el, icon } from "./dom";

// The fade's 32px plus a row: the last row in view before a page stays in view after it.
const PAGE_OVERLAP = 64;

/**
 * `content` in a list that scrolls on its own, fading its bottom edge and offering a "Scroll
 * down" button while more of it sits below. The host's sheet must `@import`
 * `ui/scroll-cue.css`, and the cue scrolls only inside a flex column whose height is bounded;
 * `content` brings its own padding, so the scrollbar sits at the host's edge. The list is a Tab
 * stop only while it overflows, and never when `content` holds a link or button when built.
 */
export function scrollCue(doc: Document, ...content: Node[]): HTMLElement {
  const list = el(doc, "div", "gh-prism-scroll-cue-list", ...content);
  // The browser makes an overflowing list a Tab stop; -1 keeps it out where a link or button
  // inside can scroll it (Firefox tabs into any scroller), yet focusable for the hand-off.
  if (list.querySelector("a[href], button")) list.tabIndex = -1;

  const arrow = el(doc, "button", "gh-prism-scroll-cue-arrow", icon(doc, ARROW_DOWN_ICON, {}));
  arrow.type = "button";
  arrow.setAttribute("aria-label", "Scroll down");
  arrow.addEventListener("click", () => scrollPage(list, arrow));

  return el(doc, "div", "gh-prism-scroll-cue", list, arrow);
}

/** Scrolls `list` down a page, first moving focus from `arrow` to `list` if the page reaches the end. */
function scrollPage(list: HTMLElement, arrow: HTMLElement): void {
  const top = Math.max(list.clientHeight - PAGE_OVERLAP, list.clientHeight / 2);

  // The arrow hides at the end, and a hidden button drops focus, which closes the card.
  const end = list.scrollHeight - list.clientHeight - 1;
  if (list.ownerDocument.activeElement === arrow && list.scrollTop + top >= end)
    list.focus({ preventScroll: true });

  const reducedMotion = list.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  list.scrollBy({ top, behavior: reducedMotion ? "instant" : "smooth" });
}
