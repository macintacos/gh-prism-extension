/**
 * The code owner details dialog a click on a code owners shield or the code owners button opens:
 * its opener's listing, then a box per owning team listing its members. It exists only while
 * open, and mounts in the page's body so a shield in a shadow root and one in the light DOM share
 * it. It also holds the hover popups' hint that points here, and `ownerFilterAction`, the
 * link drawn as a button that filters Files changed to the code owner a Reviewers shield marks.
 */

import {
  codeOwnerOf,
  isOwner,
  type TeamAvatarOf,
  type TeamMembersOf,
} from "@/utils/github/code-owners";
import type { OwnerFilterLink } from "@/utils/github/files-route";
import type { TeamRosterOf } from "@/utils/github/team-roster";
import { el, FILTER_ICON, icon, X_ICON } from "./dom";
import { prismMark } from "./mark";
import {
  followOwnerTooltips,
  navigateOnPlainClick,
  type OwnerIdentities,
  ownerLink,
} from "./owner-identity";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./owners-dialog.css?inline";
import { teamBox } from "./team-box";

/** What the code owner details dialog shows, and where focus goes once it closes. */
export interface OwnersDialogContent {
  /** What the dialog lists above the teams, built by its opener's module. */
  readonly summary: readonly Node[];
  /** The `@org/team` tokens whose members it lists, in order. */
  readonly teams: readonly string[];
  /** Reads each of `teams`' members; never rejects. */
  readonly teamMembers: TeamMembersOf;
  /** Reads each of `teams`' avatars; never rejects. */
  readonly teamAvatar: TeamAvatarOf;
  /** Reads a team's whole roster, only on Show all or a member search; never rejects. */
  readonly teamRoster: TeamRosterOf;
  /** Where focus goes once it closes. */
  readonly returnFocus: () => void;
  /** The page's lifetime; the dialog goes with it. */
  readonly signal: AbortSignal;
  /** Filters Files changed by a code owner; without it, nothing offers to. */
  readonly filter?: OwnerFilter;
}

/**
 * The dialog's options: headed by `title`, or about one code owner, `owner`, whose identity heads
 * it and whose filter action its footer holds, not its box.
 */
export type OwnersDialogOptions = OwnersDialogContent &
  ({ readonly title: string; readonly owner?: undefined } | { readonly owner: string });

/** How an action filters a pull request's Files changed to one code owner's files. */
export interface OwnerFilter {
  /** Where the action for `token` leads. */
  readonly linkOf: (token: string) => OwnerFilterLink;
  /** Loads `href` as a new page: the owner filter reads its owner once per page. */
  readonly navigate: (href: string) => void;
}

const TITLE_ID = "gh-prism-owners-dialog-title";

/** Opens the code owner details dialog over `doc`, until it closes or `signal` aborts. */
export function openOwnersDialog(doc: Document, options: OwnersDialogOptions): void {
  const {
    summary,
    teams,
    teamMembers,
    teamAvatar,
    teamRoster,
    returnFocus,
    signal,
    filter,
    owner,
  } = options;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  // The footer already offers the dialog's own code owner's files.
  const identitiesOf = (team: string): OwnerIdentities =>
    owner !== undefined && isOwner(team, { token: owner })
      ? { teamAvatar }
      : { teamAvatar, filter };
  const dialog = ownersDialog(doc, {
    title: owner === undefined ? options.title : ownerLink(doc, codeOwnerOf(owner), teamAvatar),
    summary,
    teams: teams.map((team) =>
      teamBox(
        doc,
        team,
        { members: teamMembers(team), roster: () => teamRoster(team) },
        identitiesOf(team),
      ),
    ),
    footer: filter && owner !== undefined ? ownerFilterAction(doc, owner, filter) : undefined,
  });

  const closed = new AbortController();
  const remove = () => {
    closed.abort();
    dialog.remove();
    style.remove();
  };
  dialog.addEventListener("close", () => {
    remove();
    returnFocus();
  });

  doc.head.append(style);
  doc.body.append(dialog);
  dialog.showModal();
  signal.addEventListener("abort", remove, { signal: closed.signal });
}

// Each matches its popup's own padding; the popup keeps no bottom padding, so a long list
// scrolls under the footer.
const HINT_FOOTER = {
  small:
    "gh-prism-owners-hint tw:sticky tw:bottom-0 tw:-mx-3 tw:mt-3 tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
  medium:
    "gh-prism-owners-hint tw:sticky tw:bottom-0 tw:-mx-4 tw:mt-4 tw:px-4 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
} as const;

// The medium footer as a row beside a 28px action, in 4px padding rather than 8px.
const ACTION_FOOTER =
  "gh-prism-owners-hint tw:sticky tw:bottom-0 tw:-mx-4 tw:mt-4 tw:px-4 tw:py-1 tw:flex tw:items-center tw:gap-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]";

/**
 * The footer a hover popup ends in, hinting that a click on its shield opens the dialog, with
 * `action` beside the hint in the medium inset.
 */
export function detailsHint(
  doc: Document,
  inset: keyof typeof HINT_FOOTER,
  action?: HTMLElement,
): HTMLElement {
  const hint = el(
    doc,
    "p",
    "tw:flex-1 tw:m-0 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
    "Click the shield for details",
  );
  return action
    ? el(doc, "div", ACTION_FOOTER, hint, prismMark(doc), action)
    : el(doc, "div", HINT_FOOTER[inset], hint, prismMark(doc));
}

/**
 * Primer's small invisible Button, as a link: shows only `token`'s files on Files changed, or all
 * of them when the page already shows only theirs. A plain click loads it as a new page through
 * `filter`; a modified one is the browser's.
 */
export function ownerFilterAction(
  doc: Document,
  token: string,
  { linkOf, navigate }: OwnerFilter,
): HTMLAnchorElement {
  const { href, shown } = linkOf(token);
  const link = el(
    doc,
    "a",
    "gh-prism-owner-filter tw:shrink-0 tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:rounded-medium tw:text-[color:var(--button-invisible-fgColor-rest)] tw:text-body-small tw:font-medium tw:no-underline tw:hover:no-underline tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2 tw:[&>svg]:text-[color:var(--button-invisible-iconColor-rest)]",
    icon(doc, FILTER_ICON, {}),
    shown ? "Show all files" : "Show only their files",
  );
  link.href = href;
  navigateOnPlainClick(link, href, navigate);
  return link;
}

/**
 * Primer's Dialog, `title`, text or an owner's identity, over `summary` and `teams`, closing on Esc
 * or a click outside it.
 */
function ownersDialog(
  doc: Document,
  {
    title,
    summary,
    teams,
    footer,
  }: {
    title: string | HTMLElement;
    summary: readonly Node[];
    teams: readonly HTMLElement[];
    footer: HTMLElement | undefined;
  },
): HTMLDialogElement {
  // An identity holds one line, so it can't wrap as a text title does.
  const heading = el(
    doc,
    "h2",
    typeof title === "string"
      ? "tw:flex-1 tw:m-0 tw:py-1.5 tw:px-2 tw:text-body-medium tw:leading-body-medium tw:font-semibold tw:wrap-anywhere"
      : "gh-prism-identity tw:flex-1 tw:min-w-0 tw:m-0 tw:py-1 tw:px-2 tw:text-body-medium tw:leading-body-medium tw:font-semibold",
    title,
  );
  heading.id = TITLE_ID;

  // Primer's medium invisible IconButton.
  const closeButton = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-[var(--control-medium-size,32px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X_ICON, {}),
  );
  closeButton.type = "button";
  // First focus on ✕, not on a one-owner title's new-tab link.
  closeButton.autofocus = true;
  closeButton.setAttribute("aria-label", "Close");
  closeButton.addEventListener("click", () => dialog.close());

  // No display utility on the dialog itself: it would show it closed.
  const dialog = el(
    doc,
    "dialog",
    "gh-prism-owners-dialog tw:w-[640px] tw:min-w-[296px] tw:max-w-[calc(100dvw-64px)] tw:max-h-[calc(100dvh-64px)] tw:p-0 tw:overflow-hidden tw:[border:0] tw:rounded-[var(--borderRadius-large,12px)] tw:bg-[var(--overlay-bgColor)] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:text-body-medium tw:leading-body-medium",
    el(
      doc,
      "div",
      "tw:flex tw:flex-col tw:max-h-[calc(100dvh-64px)]",
      el(
        doc,
        "div",
        "tw:flex tw:items-start tw:pt-[11px] tw:pb-2 tw:px-2 tw:[box-shadow:0_1px_0_var(--borderColor-default)]",
        heading,
        closeButton,
      ),
      el(
        doc,
        "div",
        "tw:flex tw:flex-col tw:gap-4 tw:min-h-0 tw:overflow-y-auto tw:p-4 tw:wrap-anywhere",
        el(doc, "div", "", ...summary),
        ...(teams.length > 0 ? [el(doc, "div", "tw:flex tw:flex-col tw:gap-3", ...teams)] : []),
      ),
      el(
        doc,
        "div",
        "gh-prism-owners-dialog-footer tw:flex tw:items-center tw:justify-between tw:p-2 tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
        prismMark(doc),
        ...(footer ? [footer] : []),
      ),
    ),
  );
  dialog.setAttribute("aria-labelledby", TITLE_ID);
  dialog.setAttribute("closedby", "any");
  followOwnerTooltips(dialog);
  return dialog;
}
