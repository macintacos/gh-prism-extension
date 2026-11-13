/** Introduces Structural mode: the card its segment opens on hover or focus, linking the doc. */

import { el } from "../ui/dom";
import { type Card, followHoverIntent } from "../ui/hover-intent";
import { place } from "../ui/place";

/** The doc the card links. Shipped builds link here, so the path never changes. */
export const STRUCTURAL_DIFFS_DOC =
  "https://github.com/macintacos/gh-prism-extension/blob/main/docs/STRUCTURAL-DIFFS.md";

/**
 * Until `signal` aborts, opens a card on hover or focus of the Structural segment showing its tip
 * and a link to the doc, except while `blocked`.
 */
export function followStructuralTip(
  doc: Document,
  signal: AbortSignal,
  { blocked }: { blocked: () => boolean },
): void {
  followHoverIntent(doc, signal, {
    triggerOf: (target) =>
      target.closest<HTMLElement>('.gh-prism-diff-view-segment[data-view="structural"]'),
    show: (segment) => (blocked() ? undefined : openTip(segment)),
  });
}

function openTip(segment: HTMLElement): Card {
  const doc = segment.ownerDocument;
  const link = el(
    doc,
    "a",
    "tw:inline-flex tw:items-center tw:min-h-6 tw:text-[color:var(--fgColor-accent)]",
    "What's a structural diff?",
  );
  link.href = STRUCTURAL_DIFFS_DOC;
  link.target = "_blank";
  link.rel = "noopener noreferrer";

  const card = el(
    doc,
    "div",
    "tw:inset-auto tw:m-0 tw:box-border tw:max-w-[min(320px,calc(100vw-16px))] tw:p-3 tw:text-body-small tw:leading-body-small tw:font-normal tw:text-start tw:whitespace-normal tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:rounded-medium tw:[border:0] tw:[box-shadow:var(--shadow-floating-small)]",
    el(doc, "p", "tw:mt-0 tw:mb-1", segment.getAttribute("aria-description") ?? ""),
    link,
  );
  // Manual: hover intent alone opens and closes it; light dismiss would close it on the press.
  card.popover = "manual";
  // After the button, so Tab from the segment reaches the link.
  segment.after(card);
  card.showPopover();
  place(card, segment.getBoundingClientRect());
  return { element: card, close: () => card.remove() };
}
