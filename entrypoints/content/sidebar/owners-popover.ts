/**
 * The popover a code owners shield opens on hover or focus, listing a file's owners, or a folder's
 * files and theirs; it exists only while open.
 *
 * It sits beside its shield, which is marked expanded while it is open. It closes on Escape inside
 * it, on a click outside it, on any scroll outside it, once `signal` aborts, or on a call of the
 * returned card's `close`. Closing removes it with its listeners and clears the shield's mark, and,
 * unless a click closed it, hands focus it held to `returnFocus`.
 */

import type { CodeOwner } from "@/utils/github/code-owners";
import { el } from "../ui/dom";
import type { Card } from "../ui/hover-intent";
import { detailsHint, ownerLink } from "../ui/owners-dialog";
import { place } from "../ui/place";

interface PopoverOptions {
  /** Where the popover mounts: the sections view's root, which styles it. */
  readonly root: Element;
  /** The page's lifetime; the popover goes with it. */
  readonly signal: AbortSignal;
  /** Moves focus to the shield's row, as the popover closes while holding focus. */
  readonly returnFocus: () => void;
}

interface OwnersOptions extends PopoverOptions {
  /** The file's base name, for the popover's accessible name. */
  readonly name: string;
  readonly owners: readonly CodeOwner[];
}

interface FolderOwnersOptions extends PopoverOptions {
  /** The folder's path, ending in `/`. */
  readonly folder: string;
  /** Every file under `folder`, by full path in the tree's order, each with its owners, if any. */
  readonly files: readonly { readonly path: string; readonly owners: readonly CodeOwner[] }[];
}

/** Opens the popover listing a file's `owners`. */
export function openOwners(shield: HTMLElement, { name, owners, ...options }: OwnersOptions): Card {
  return openPopover(
    shield,
    `Code owners of ${name}`,
    ownersList(shield.ownerDocument, owners),
    options,
  );
}

/** `owners`, one per line. */
export function ownersList(doc: Document, owners: readonly CodeOwner[]): HTMLElement {
  return el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1",
    ...owners.map((owner) => el(doc, "li", "", ownerLink(doc, owner))),
  );
}

/** `files` by their paths relative to `folder`, each owned one with its owners. */
export function folderList(
  doc: Document,
  folder: string,
  files: FolderOwnersOptions["files"],
): HTMLElement {
  return el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-2",
    ...files.map(({ path, owners }) => fileItem(doc, path.slice(folder.length), owners)),
  );
}

/**
 * Opens the popover listing `files` by their paths relative to `folder`, each owned one with its
 * owners.
 */
// ponytail: builds every file under the folder on each open, thousands of nodes at GitHub's
// 3,000-file cap; cap the list with a "+N more" line, or swap in a file tree, if that hitches.
export function openFolderOwners(
  shield: HTMLElement,
  { folder, files, ...options }: FolderOwnersOptions,
): Card {
  return openPopover(
    shield,
    `Code owners of files in ${folder.slice(0, -1)}`,
    folderList(shield.ownerDocument, folder, files),
    options,
  );
}

/** `label` is the popover's accessible name; `body` goes below its heading. */
function openPopover(
  shield: HTMLElement,
  label: string,
  body: HTMLElement,
  { root, signal, returnFocus }: PopoverOptions,
): Card {
  const doc = shield.ownerDocument;
  const popover = el(
    doc,
    "div",
    "gh-prism-owners tw:inset-auto tw:m-0 tw:max-w-[320px] tw:max-h-[calc(100vh-16px)] tw:overflow-y-auto tw:pt-3 tw:px-3 tw:pb-0 tw:text-body-small tw:leading-body-small tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:rounded-medium tw:[border:0] tw:[box-shadow:var(--shadow-floating-small)] tw:wrap-anywhere",
    el(doc, "h2", "tw:mt-0 tw:mb-2 tw:text-body-small tw:font-semibold", "Code owners"),
    body,
    // Sticky, and the popover keeps no bottom padding, so a long list scrolls under the hint.
    el(
      doc,
      "div",
      "tw:sticky tw:bottom-0 tw:-mx-3 tw:mt-3 tw:px-3 tw:py-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
      detailsHint(doc),
    ),
  );
  popover.popover = "auto";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", label);
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
    const heldFocus = popover.contains(doc.activeElement);
    remove();
    shield.removeAttribute("aria-expanded");
    if (heldFocus) returnFocus();
  };
  signal.addEventListener("abort", close, { signal: closed.signal });
  // Focus leaves first: hiding a popover that holds focus hands it back to the shield, and the
  // shield's focus would open the popover again mid-hide.
  const dismiss = () => {
    returnFocus();
    popover.hidePopover();
  };
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
      dismiss();
    },
    { signal: closed.signal },
  );

  // source: Tab from the shield enters it, and Tab past its last link goes on from the shield,
  // not from the end of the view.
  popover.showPopover({ source: shield });
  place(popover, shield.getBoundingClientRect());
  // Preact leaves alone an attribute it never rendered, and a scroll closes the popover before
  // its row could virtualize away.
  shield.setAttribute("aria-expanded", "true");
  // Capture: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    (event) => {
      if (event.target instanceof Node && popover.contains(event.target)) return;
      if (popover.contains(doc.activeElement)) dismiss();
      else popover.hidePopover();
    },
    { capture: true, signal: closed.signal },
  );
  return { element: popover, close };
}

/** `path`'s list item, with its owners, if any, below it. */
function fileItem(doc: Document, path: string, owners: readonly CodeOwner[]): HTMLElement {
  return el(
    doc,
    "li",
    "",
    el(doc, "div", "tw:font-mono", ...pathParts(doc, path)),
    ...(owners.length > 0
      ? [
          el(
            doc,
            "div",
            "",
            ...owners.flatMap((owner, i) => [i > 0 ? ", " : "", ownerLink(doc, owner)]),
          ),
        ]
      : []),
  );
}

// ponytail: copied from conversation/reviewer-files.ts; EXC-2111's file tree replaces both.
/** `path` as a muted directory and its file name. */
function pathParts(doc: Document, path: string): (Node | string)[] {
  const nameStart = path.lastIndexOf("/") + 1;
  return nameStart === 0
    ? [path]
    : [el(doc, "span", "tw:text-fg-muted", path.slice(0, nameStart)), path.slice(nameStart)];
}
