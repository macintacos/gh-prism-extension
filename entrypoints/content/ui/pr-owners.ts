/**
 * gh-prism's code owners button, which opens the code owner details dialog for the whole pull
 * request, and its place in Files changed's toolbar.
 */

import type {
  PrCodeOwners,
  PrReviewer,
  TeamAvatarOf,
  TeamMembersOf,
} from "@/utils/github/code-owners";
import { type FilesPage, findFilesToolbar } from "../files-page";
import { describePullRequest } from "../sidebar/owners-popover";
import { el, icon, SHIELD_LOCK } from "./dom";
import { type OwnerFilter, openOwnersDialog } from "./owners-dialog";

/** How the whole pull request's code owner details dialog reads teams and filters Files changed. */
export interface PrOwnersReads {
  readonly teamMembers: TeamMembersOf;
  readonly teamAvatar: TeamAvatarOf;
  readonly filter?: OwnerFilter;
}

const BUTTON = "gh-prism-pr-owners";

/** Whether `codeOwners` names a code owner for at least one changed file. */
export const ownsAnyFile = (codeOwners: PrCodeOwners | undefined): codeOwners is PrCodeOwners =>
  codeOwners !== undefined && [...codeOwners.values()].some(({ owners }) => owners.length > 0);

/** gh-prism's code owners button, drawn with `classes`, named and tool-tipped by its label. */
export function prOwnersButton(doc: Document, classes: string): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    `${BUTTON} ${classes}`,
    icon(doc, SHIELD_LOCK, { class: "tw:text-fg-muted" }),
  );
  button.type = "button";
  button.setAttribute("aria-label", "Code owners");
  button.setAttribute("aria-haspopup", "dialog");
  return button;
}

/** Opens the whole pull request's code owner details dialog over `doc`, until it closes or `signal` aborts. */
export function openPrOwners(
  doc: Document,
  ownership: { codeOwners: PrCodeOwners; prReviewers: readonly PrReviewer[] | undefined },
  {
    teamMembers,
    teamAvatar,
    filter,
    returnFocus,
    signal,
  }: PrOwnersReads & { returnFocus: () => void; signal: AbortSignal },
): void {
  const { title, summary, teams } = describePullRequest(doc, ownership, { teamAvatar, filter });
  openOwnersDialog(doc, {
    title,
    summary,
    teams,
    teamMembers,
    teamAvatar,
    filter,
    returnFocus,
    signal,
  });
}

/**
 * Once `codeOwners` and `prReviewers` settle, puts the code owners button right after the toolbar's
 * Conversation button, when `codeOwners` names an owner for a changed file, until `signal` aborts.
 * Without the Conversation button, there's nowhere to put it.
 */
export function showPrOwnersButton(
  page: FilesPage,
  signal: AbortSignal,
  {
    codeOwners,
    prReviewers,
    ...reads
  }: PrOwnersReads & {
    codeOwners: Promise<PrCodeOwners | undefined>;
    prReviewers: Promise<readonly PrReviewer[] | undefined>;
  },
): void {
  void Promise.all([codeOwners, prReviewers]).then(([owners, reviewers]) => {
    const conversation = findFilesToolbar(page)?.querySelector(".gh-prism-conversation-button");
    if (signal.aborted || !conversation || !ownsAnyFile(owners)) return;
    const doc = conversation.ownerDocument;

    // Primer's small default Button, like the Conversation button before it.
    const button = prOwnersButton(
      doc,
      "tw:relative tw:shrink-0 tw:inline-flex tw:items-center tw:justify-center tw:h-[var(--control-small-size,28px)] tw:min-w-[var(--control-small-size,28px)] tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:rounded-medium tw:bg-[var(--button-default-bgColor-rest)] tw:[box-shadow:var(--button-default-shadow-resting)] tw:cursor-pointer tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    );
    const open = () =>
      openPrOwners(
        doc,
        { codeOwners: owners, prReviewers: reviewers },
        {
          ...reads,
          returnFocus: () => doc.querySelector<HTMLElement>(`.${BUTTON}`)?.focus(),
          signal,
        },
      );
    button.addEventListener("click", open);
    // Hydrating the toolbar on a press can swap the button mid-press, and then no click fires.
    let pressed = false;
    button.addEventListener("pointerdown", () => (pressed = true));
    doc.addEventListener(
      "pointerup",
      () => {
        if (pressed && !button.isConnected) open();
        pressed = false;
      },
      { signal },
    );

    // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier button.
    for (const stale of doc.querySelectorAll(`.${BUTTON}`)) stale.remove();
    conversation.after(button);
    signal.addEventListener("abort", () => button.remove());
  });
}
