/**
 * gh-prism's code owners button, which opens the code owner details dialog for the whole pull
 * request, and its place in Files changed's toolbar. Its base look and tooltip live in
 * `ui/pr-owners.css`, which each host's sheet `@import`s and places with its own rule; on Files
 * changed that is `conversation/panel.css`.
 */

import {
  type OwnedPullRequest,
  ownsAnyFile,
  type PrCodeOwners,
  type PrReviewer,
} from "@/utils/github/code-owners";
import { describePullRequest } from "../sidebar/owners-popover";
import { el, icon, SHIELD_LOCK } from "./dom";
import { type OwnersDialogOptions, openOwnersDialog } from "./owners-dialog";

const CLASS = "gh-prism-pr-owners";
/** Every code owners button, the toolbar's and the Reviewers headings'. */
export const PR_OWNERS = `.${CLASS}`;
/** Names the Reviewers list a heading's button sits in; the toolbar's has none. */
export const PR_OWNERS_KIND = "data-gh-prism-list";
const TOOLBAR_BUTTON = `${PR_OWNERS}:not([${PR_OWNERS_KIND}])`;

/** The dialog's options a whole pull request's code owners dialog takes from its opener. */
export type PrOwnersOptions = Omit<OwnersDialogOptions, "title" | "summary" | "teams" | "owner">;

/** What the toolbar's code owners button reads to show and open. */
export interface PrOwnersReads {
  codeOwners: Promise<PrCodeOwners | undefined>;
  prReviewers: Promise<readonly PrReviewer[] | undefined>;
  teamMembers: OwnersDialogOptions["teamMembers"];
  teamAvatar: OwnersDialogOptions["teamAvatar"];
  filter?: OwnersDialogOptions["filter"];
}

/** Wires `button` to call `open` on a press the page re-mounted it under. */
export type PrOwnersPressGuard = (button: HTMLElement, open: () => void) => void;

/** gh-prism's code owners button, named and tool-tipped by its label. */
export function prOwnersButton(doc: Document): HTMLButtonElement {
  const button = el(doc, "button", CLASS, icon(doc, SHIELD_LOCK, {}));
  button.type = "button";
  button.setAttribute("aria-label", "Code owners");
  button.setAttribute("aria-haspopup", "dialog");
  return button;
}

/** Opens the whole pull request's code owner details dialog over `doc`. */
export const openPrOwners = (
  doc: Document,
  ownership: OwnedPullRequest,
  options: PrOwnersOptions,
) =>
  openOwnersDialog(doc, {
    ...describePullRequest(doc, ownership, {
      teamAvatar: options.teamAvatar,
      filter: options.filter,
    }),
    ...options,
  });

/**
 * For the whole of `visit`, a guard that opens a wired button on a press the page re-mounted it
 * under; the press is forgotten once the pointer is released or cancelled anywhere.
 */
export function prOwnersPressGuard(doc: Document, visit: AbortSignal): PrOwnersPressGuard {
  let pressed: HTMLElement | undefined;
  // After the button's own pointerup, which bubbles up to here.
  const forget = () => (pressed = undefined);
  doc.addEventListener("pointerup", forget, { signal: visit });
  doc.addEventListener("pointercancel", forget, { signal: visit });
  return (button, open) => {
    button.addEventListener("pointerdown", () => (pressed = button));
    button.addEventListener("pointerup", () => {
      if (pressed && !pressed.isConnected) open();
    });
  };
}

/**
 * Once `codeOwners` and `prReviewers` settle, puts the code owners button right after `anchor`
 * when `codeOwners` names an owner for a changed file and `anchor` is still in the page, until
 * `signal` aborts. `guard` is the visit's, so a press outlives the page that started it.
 */
export function showPrOwnersButton(
  anchor: HTMLElement,
  signal: AbortSignal,
  {
    codeOwners,
    prReviewers,
    guard,
    ...dialogOptions
  }: PrOwnersReads & { guard: PrOwnersPressGuard },
): void {
  void Promise.all([codeOwners, prReviewers]).then(([owners, reviewers]) => {
    const ownership = { codeOwners: owners, prReviewers: reviewers };
    if (signal.aborted || !anchor.isConnected || !ownsAnyFile(ownership)) return;
    const doc = anchor.ownerDocument;

    const button = prOwnersButton(doc);
    const open = () =>
      openPrOwners(doc, ownership, {
        ...dialogOptions,
        returnFocus: () => doc.querySelector<HTMLElement>(TOOLBAR_BUTTON)?.focus(),
        signal,
      });
    button.addEventListener("click", open);
    // Hydrating the toolbar on a press can swap the button mid-press, and then no click fires.
    guard(button, open);

    // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier button.
    for (const stale of doc.querySelectorAll(TOOLBAR_BUTTON)) stale.remove();
    anchor.after(button);
    signal.addEventListener("abort", () => button.remove());
  });
}
