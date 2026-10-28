/** The popover a code owners shield opens, listing its file's owners; it exists only while open. */

import type { CodeOwner } from "@/utils/github/code-owners";
import { el } from "../ui/dom";

interface OwnersOptions {
  /** The file's base name, for the popover's accessible name. */
  readonly name: string;
  readonly owners: readonly CodeOwner[];
  /** Where the popover mounts: the sections view's root, which styles it. */
  readonly root: Element;
  /** The page's lifetime; the popover goes with it. */
  readonly signal: AbortSignal;
  /** Called after Escape closes it, to return focus to the file's row. */
  readonly onEscape: () => void;
}

/**
 * Opens a popover below `shield` listing `owners`, and moves focus into it. `shield` is marked
 * expanded while it is open. It closes on Escape (then calls `onEscape`), on a click outside it,
 * its own shield's included, on any scroll outside it, once `signal` aborts, or on a call of the
 * returned function. Closing removes it with its listeners and clears the shield's mark.
 */
export function openOwners(
  shield: HTMLElement,
  { name, owners, root, signal, onEscape }: OwnersOptions,
): () => void {
  const doc = shield.ownerDocument;
  const popover = el(
    doc,
    "div",
    "gh-prism-owners tw:inset-auto tw:m-0 tw:max-w-[320px] tw:max-h-[calc(100vh-16px)] tw:overflow-y-auto tw:p-3 tw:text-body-small tw:leading-body-small tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:border tw:border-border-default tw:rounded-medium tw:[box-shadow:var(--shadow-floating-small)] tw:wrap-anywhere",
    el(doc, "h2", "tw:mt-0 tw:mb-2 tw:text-body-small tw:font-semibold", "Code owners"),
    el(
      doc,
      "ul",
      "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1",
      ...owners.map((owner) => el(doc, "li", "", ownerOf(doc, owner))),
    ),
  );
  popover.popover = "auto";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", `Code owners of ${name}`);
  popover.tabIndex = -1;
  root.append(popover);

  const closed = new AbortController();
  const remove = () => {
    closed.abort();
    popover.remove();
  };
  // The browser fires no toggle events when an open popover leaves the document.
  const close = () => {
    if (closed.signal.aborted) return;
    remove();
    shield.removeAttribute("aria-expanded");
  };
  signal.addEventListener("abort", close, { signal: closed.signal });
  // beforetoggle, not toggle: the browser queues toggle, after a click may have opened the next.
  popover.addEventListener(
    "beforetoggle",
    (event) => {
      if (event.newState === "closed") shield.removeAttribute("aria-expanded");
    },
    { signal: closed.signal },
  );
  popover.addEventListener(
    "toggle",
    (event) => {
      if (event.newState === "closed") remove();
    },
    { signal: closed.signal },
  );
  popover.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      // The browser's own Escape would return focus to the shield, not the row.
      event.preventDefault();
      popover.hidePopover();
      onEscape();
    },
    { signal: closed.signal },
  );

  // source: Tab past its last link goes on from the shield, not from the end of the view.
  popover.showPopover({ source: shield });
  place(popover, shield.getBoundingClientRect());
  // preventScroll: a scroll would close it.
  popover.focus({ preventScroll: true });
  // Preact leaves alone an attribute it never rendered, and a scroll closes the popover before
  // its row could virtualize away.
  shield.setAttribute("aria-expanded", "true");
  // Capture: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    (event) => {
      if (!(event.target instanceof Node && popover.contains(event.target))) popover.hidePopover();
    },
    { capture: true, signal: closed.signal },
  );
  return close;
}

/** `owner`'s token, linking to its page in a new tab when it has one. */
function ownerOf(doc: Document, { token, url }: CodeOwner): Node | string {
  if (!url) return token;
  const link = el(doc, "a", "tw:text-[color:var(--fgColor-accent)]", token);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

// Keep the popover's tw:max-h at 100vh minus twice this.
const VIEWPORT_MARGIN = 8;

/** Puts `popover` below `anchor`, start-aligned, or above it when there's no room below. */
function place(popover: HTMLElement, anchor: DOMRect): void {
  const view = popover.ownerDocument.defaultView;
  // offset*, not getBoundingClientRect: the entrance transition is still scaling it.
  const { offsetWidth: width, offsetHeight: height } = popover;
  const maxLeft = (view?.innerWidth ?? 0) - width - VIEWPORT_MARGIN;
  const maxTop = (view?.innerHeight ?? 0) - height - VIEWPORT_MARGIN;
  const top = anchor.bottom > maxTop ? anchor.top - height : anchor.bottom;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;
  popover.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
}
