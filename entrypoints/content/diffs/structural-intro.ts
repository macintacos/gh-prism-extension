/**
 * Introduces Structural mode: the card its segment opens on hover or focus, and the popup that
 * points at it until dismissed, both linking the doc.
 */

import { el, icon, X_ICON } from "../ui/dom";
import { type Card, followHoverIntent } from "../ui/hover-intent";
import { prismMark } from "../ui/mark";
import { place } from "../ui/place";

/** The doc both link. Shipped builds link here, so the path never changes. */
export const STRUCTURAL_DIFFS_DOC =
  "https://github.com/macintacos/gh-prism-extension/blob/main/docs/STRUCTURAL-DIFFS.md";

/** Whether the Structural popup is dismissed. One per tab, kept current across tabs. */
export interface IntroChoice {
  dismissed: boolean;
}

/** The tab's popup choice, and how to persist a dismissal. */
export interface IntroOptions {
  readonly choice: IntroChoice;
  /** Remembers the dismissal. */
  readonly save: () => void;
}

/** The Structural popup's handle for the control that owns its segment. */
export interface StructuralIntro {
  /**
   * Shows the popup against `segment`, moving it there from a replaced one; hides it, undismissed,
   * for `undefined`. Does nothing once dismissed.
   */
  readonly follow: (segment: HTMLElement | undefined) => void;
  /** Closes the popup for good and saves the dismissal, once. */
  readonly dismiss: () => void;
  readonly isOpen: () => boolean;
}

// Primer's overlay surface, shared by the card and the popup.
const SURFACE =
  "tw:inset-auto tw:m-0 tw:box-border tw:max-w-[min(320px,calc(100vw-16px))] tw:p-3 tw:text-body-small tw:leading-body-small tw:font-normal tw:text-start tw:whitespace-normal tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:rounded-medium tw:[border:0] tw:[box-shadow:var(--shadow-floating-small)]";

// The room between the segment and the popup, which the caret spans.
const GAP = 8;

/** "What's a structural diff?", opening the doc in a new tab so the diff stays put. */
function docLink(doc: Document): HTMLAnchorElement {
  const link = el(
    doc,
    "a",
    "tw:inline-flex tw:items-center tw:min-h-6 tw:text-[color:var(--fgColor-accent)]",
    "What's a structural diff?",
  );
  link.href = STRUCTURAL_DIFFS_DOC;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

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
  const card = el(
    doc,
    "div",
    SURFACE,
    el(doc, "p", "tw:mt-0 tw:mb-1", segment.getAttribute("aria-description") ?? ""),
    docLink(doc),
  );
  // Manual: hover intent alone opens and closes it; light dismiss would close it on the press.
  card.popover = "manual";
  // After the button, so Tab from the segment reaches the link.
  segment.after(card);
  card.showPopover();
  place(card, segment.getBoundingClientRect());
  return { element: card, close: () => card.remove() };
}

/** The popup's parts: the surface, its caret, and its close button, which calls `close`. */
function popupOf(doc: Document, close: () => void): { popup: HTMLElement; caret: HTMLElement } {
  // Primer's small invisible IconButton, at the 24px target floor.
  const closer = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-6 tw:-my-1 tw:-me-1 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X_ICON, {}),
  );
  closer.type = "button";
  closer.setAttribute("aria-label", "Close");
  closer.addEventListener("click", close);

  // Turned 45°, in the surface's colour, so its far half reads as the popup's point; its two outer
  // edges carry the floating shadow's ring.
  const caret = el(
    doc,
    "span",
    "tw:absolute tw:box-border tw:size-2 tw:-ms-1 tw:rotate-45 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[border:0_solid_var(--borderColor-default)]",
  );
  caret.setAttribute("aria-hidden", "true");

  const popup = el(
    doc,
    "div",
    `gh-prism-structural-popup ${SURFACE} tw:overflow-visible`,
    caret,
    el(
      doc,
      "div",
      "tw:flex tw:items-center tw:gap-2 tw:mb-1",
      prismMark(doc),
      el(doc, "strong", "tw:flex-1 tw:font-semibold", "Structural diffs are new"),
      closer,
    ),
    el(
      doc,
      "p",
      "tw:mt-0 tw:mb-1 tw:text-fg-muted",
      "Highlights what changed in the code and quiets formatting-only changes.",
    ),
    docLink(doc),
  );
  popup.popover = "manual";
  return { popup, caret };
}

/** Whether `rect` lies entirely outside `win`'s viewport. */
const offscreen = (rect: DOMRect, win: Window) =>
  rect.bottom < 0 || rect.top > win.innerHeight || rect.right < 0 || rect.left > win.innerWidth;

/**
 * The popup announcing Structural mode, shown against the segment `follow` names until dismissed
 * or `signal` aborts. Takes no focus. Escape dismisses it while focus is in it, on its segment, or
 * nowhere; elsewhere, Escape belongs to whatever holds focus.
 */
export function structuralIntro(
  doc: Document,
  signal: AbortSignal,
  { choice, save }: IntroOptions,
): StructuralIntro {
  const win = doc.defaultView;
  let anchor: HTMLElement | undefined;
  let shown = false;
  let listening: AbortController | undefined;

  const hide = () => {
    if (shown) popup.hidePopover();
    shown = false;
  };

  // Below the segment, else above, the caret at the segment's centre on the facing edge.
  const aim = () => {
    if (!anchor || !win) return;
    const rect = anchor.getBoundingClientRect();
    if (offscreen(rect, win)) return hide();
    if (!shown) popup.showPopover();
    shown = true;
    place(popup, new DOMRect(rect.x, rect.y - GAP, rect.width, rect.height + 2 * GAP));
    const below = parseFloat(popup.style.top) >= rect.bottom;
    caret.style.left = `${rect.left + rect.width / 2 - parseFloat(popup.style.left)}px`;
    caret.style.top = below ? `-${GAP / 2}px` : "";
    caret.style.bottom = below ? "" : `-${GAP / 2}px`;
    caret.style.borderWidth = below ? "1px 0 0 1px" : "0 1px 1px 0";
  };

  const onEscape = (event: KeyboardEvent) => {
    const active = doc.activeElement;
    const ownsEscape =
      !active || active === doc.body || active === anchor || popup.contains(active);
    if (event.key === "Escape" && shown && ownsEscape) dismiss();
  };

  const remove = () => {
    listening?.abort();
    listening = undefined;
    anchor = undefined;
    hide();
    popup.remove();
  };

  const follow = (segment: HTMLElement | undefined) => {
    if (choice.dismissed || !segment) return remove();
    if (segment !== anchor) {
      // Leaving the document closes a popover, so the move shows it afresh.
      hide();
      anchor = segment;
      segment.after(popup);
    }
    if (!listening) {
      listening = new AbortController();
      const options = { signal: AbortSignal.any([signal, listening.signal]) };
      win?.addEventListener("scroll", aim, { ...options, capture: true, passive: true });
      win?.addEventListener("resize", aim, options);
      doc.addEventListener("keydown", onEscape, options);
    }
    aim();
  };

  const dismiss = () => {
    if (choice.dismissed) return;
    choice.dismissed = true;
    const segment = anchor;
    const heldFocus = popup.contains(doc.activeElement);
    remove();
    if (heldFocus) segment?.focus();
    save();
  };

  const { popup, caret } = popupOf(doc, dismiss);
  signal.addEventListener("abort", remove, { once: true });
  return { follow, dismiss, isOpen: () => shown };
}
