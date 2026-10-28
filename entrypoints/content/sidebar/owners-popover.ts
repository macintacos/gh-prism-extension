/** The popover a code owners shield opens, listing its file's owners; it exists only while open. */

import type { CodeOwner } from "@/utils/github/code-owners";
import { el } from "../ui/dom";

interface OwnersPopover {
  /** The file's base name, for the popover's accessible name. */
  readonly name: string;
  readonly owners: readonly CodeOwner[];
  /** Where the popover mounts: the sections view's root, which styles it. */
  readonly root: Element;
  readonly signal: AbortSignal;
  /** Called after Escape closes it, to return focus to the file's row. */
  readonly onEscape: () => void;
}

const VIEWPORT_MARGIN = 8;

/** Opens a popover below `shield` listing `owners`, removed again once it closes. */
export function openOwners(
  shield: HTMLElement,
  { name, owners, root, signal, onEscape }: OwnersPopover,
): void {
  const doc = shield.ownerDocument;
  const popover = el(
    doc,
    "div",
    "gh-prism-owners tw:text-body-small tw:leading-body-small tw:text-fg-default",
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

  const close = () => {
    popover.remove();
    shield.removeAttribute("aria-expanded");
  };
  popover.addEventListener(
    "toggle",
    (event) => {
      if (event.newState === "closed") close();
    },
    { signal },
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
    { signal },
  );

  popover.showPopover();
  place(popover, shield.getBoundingClientRect());
  popover.focus({ preventScroll: true });
  shield.setAttribute("aria-expanded", "true");
  // Attached only now, so the focus above can't close it. Capture: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    (event) => {
      if (!(event.target instanceof Node && popover.contains(event.target))) popover.hidePopover();
    },
    { capture: true, signal },
  );
}

/** `owner`'s token, linking to its page in a new tab when it has one. */
function ownerOf(doc: Document, { token, url }: CodeOwner): Node | string {
  if (!url) return token;
  const link = el(doc, "a", "", token);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/** Puts `popover` below `anchor`, start-aligned, or above it when there's no room below. */
function place(popover: HTMLElement, anchor: DOMRect): void {
  const view = popover.ownerDocument.defaultView;
  const { width, height } = popover.getBoundingClientRect();
  const maxLeft = (view?.innerWidth ?? 0) - width - VIEWPORT_MARGIN;
  const maxTop = (view?.innerHeight ?? 0) - height - VIEWPORT_MARGIN;
  const top = anchor.bottom > maxTop ? anchor.top - height : anchor.bottom;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;
  popover.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
}
