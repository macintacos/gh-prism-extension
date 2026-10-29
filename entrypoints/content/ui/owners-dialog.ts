/**
 * The code owner details dialog a click on a code owners shield opens: the shield's own listing,
 * then an excerpt of each owning team's members. It exists only while open, and mounts in the
 * page's body so a shield in a shadow root and one in the light DOM share it. It also holds
 * `ownerLink`, the token link every code-owner surface shares, and the hover popups' hint that
 * points here, and `ownerFilterAction`, the link that filters Files changed to one code owner.
 */

import {
  type CodeOwner,
  codeOwnerOf,
  isOwner,
  type TeamMembers,
  type TeamMembersOf,
} from "@/utils/github/code-owners";
import type { OwnerFilterLink } from "@/utils/github/files-route";
import { el, icon, X_ICON } from "./dom";
import { prismMark } from "./mark";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./owners-dialog.css?inline";

/** What the code owner details dialog shows, and where focus goes once it closes. */
export interface OwnersDialogOptions {
  /** The dialog's heading, which names it. */
  readonly title: string;
  /** What the shield's popover lists, built by the shield's own module. */
  readonly summary: readonly Node[];
  /** The `@org/team` tokens whose members it excerpts, in order. */
  readonly teams: readonly string[];
  /** Reads each of `teams`' members; never rejects. */
  readonly teamMembers: TeamMembersOf;
  /** Where focus goes once it closes. */
  readonly returnFocus: () => void;
  /** The page's lifetime; the dialog goes with it. */
  readonly signal: AbortSignal;
  /** Filters Files changed by a code owner; without it, nothing offers to. */
  readonly filter?: OwnerFilter;
  /** The code owner the dialog is about, whose filter action its footer holds. */
  readonly owner?: string;
}

/** How an action filters a pull request's Files changed to one code owner's files. */
export interface OwnerFilter {
  /** Where the action for `token` leads. */
  readonly linkOf: (token: string) => OwnerFilterLink;
  /** Loads `href` as a new page: the owner filter reads its owner once per page. */
  readonly navigate: (href: string) => void;
}

const TITLE_ID = "gh-prism-owners-dialog-title";

/** Opens the code owner details dialog over `doc`, until it closes or `signal` aborts. */
export function openOwnersDialog(
  doc: Document,
  { title, summary, teams, teamMembers, returnFocus, signal, filter, owner }: OwnersDialogOptions,
): void {
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const actionFor = (token: string) =>
    filter && !(owner !== undefined && isOwner(token, { token: owner }))
      ? ownerFilterAction(doc, token, filter)
      : undefined;
  const dialog = ownersDialog(doc, {
    title,
    summary,
    teams: teams.map((team) => teamBlock(doc, team, teamMembers(team), actionFor(team))),
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

/** `owner`'s token, linking to its user or team page in a new tab when it has one. */
export function ownerLink(doc: Document, { token, url }: CodeOwner): Node | string {
  if (!url) return token;
  return newTabLink(doc, token, url);
}

// Each matches its popup's own padding; the popup keeps no bottom padding, so a long list
// scrolls under the footer.
const HINT_FOOTER = {
  small:
    "gh-prism-owners-hint tw:sticky tw:bottom-0 tw:-mx-3 tw:mt-3 tw:px-3 tw:py-2 tw:flex tw:items-center tw:gap-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
  medium:
    "gh-prism-owners-hint tw:sticky tw:bottom-0 tw:-mx-4 tw:mt-4 tw:px-4 tw:py-2 tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:0_-1px_0_var(--borderColor-default)]",
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
    ? el(doc, "div", ACTION_FOOTER, hint, action)
    : el(doc, "div", HINT_FOOTER[inset], hint);
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): filter. */
const FILTER_ICON =
  "M.75 3h14.5a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5ZM3 7.75A.75.75 0 0 1 3.75 7h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 3 7.75Zm3 4a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z";

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
  // GitHub's router would take a plain click softly, and the owner filter reads its owner once.
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(href);
  });
  return link;
}

/** Primer's Dialog, `title` over `summary` and `teams`, closing on Esc or a click outside it. */
function ownersDialog(
  doc: Document,
  {
    title,
    summary,
    teams,
    footer,
  }: {
    title: string;
    summary: readonly Node[];
    teams: readonly HTMLElement[];
    footer: HTMLElement | undefined;
  },
): HTMLDialogElement {
  const heading = el(
    doc,
    "h2",
    "tw:flex-1 tw:m-0 tw:py-1.5 tw:px-2 tw:text-body-medium tw:leading-body-medium tw:font-semibold tw:wrap-anywhere",
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
  closeButton.setAttribute("aria-label", "Close");
  closeButton.addEventListener("click", () => dialog.close());

  // No display utility on the dialog itself: it would show it closed.
  const dialog = el(
    doc,
    "dialog",
    "gh-prism-owners-dialog tw:w-[480px] tw:min-w-[296px] tw:max-w-[calc(100dvw-64px)] tw:max-h-[calc(100dvh-64px)] tw:p-0 tw:overflow-hidden tw:[border:0] tw:rounded-[var(--borderRadius-large,12px)] tw:bg-[var(--overlay-bgColor)] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:text-body-medium tw:leading-body-medium",
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
        ...teams,
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
  return dialog;
}

/**
 * `team`'s linked token, with `action` beside it, over its `members`' excerpt, which fills once
 * the read settles.
 */
function teamBlock(
  doc: Document,
  team: string,
  members: Promise<TeamMembers | undefined>,
  action: HTMLElement | undefined,
): HTMLElement {
  const owner = codeOwnerOf(team);
  const heading = el(
    doc,
    "h3",
    "tw:m-0 tw:text-body-medium tw:font-semibold",
    ownerLink(doc, owner),
  );
  const block = el(
    doc,
    "section",
    "tw:flex tw:flex-col tw:gap-2 tw:pt-4 tw:[box-shadow:0_-1px_0_var(--borderColor-muted)]",
    action
      ? el(doc, "div", "tw:flex tw:items-center tw:justify-between tw:gap-2", heading, action)
      : heading,
  );
  void members.then((read) => block.append(...excerpt(doc, owner.url, read)));
  return block;
}

const MEMBER_CAP = 15;

/** The first members `read` lists, linked, then `teamUrl` for the rest; or why there are none. */
function excerpt(
  doc: Document,
  teamUrl: string | undefined,
  read: TeamMembers | undefined,
): Node[] {
  const muted = (text: string) => el(doc, "p", "tw:m-0 tw:text-fg-muted", text);
  if (!read) return [muted("GitHub doesn't show you this team's members.")];
  if (read.total === 0) return [muted("This team has no members.")];

  const shown = read.members.slice(0, MEMBER_CAP);
  const list = el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-wrap tw:gap-x-3 tw:gap-y-1",
    ...shown.map((login) =>
      el(doc, "li", "", newTabLink(doc, `@${login}`, `https://github.com/${login}`)),
    ),
  );
  return read.total > shown.length && teamUrl
    ? [list, el(doc, "p", "tw:m-0", newTabLink(doc, `See all ${read.total} members`, teamUrl))]
    : [list];
}

/** `text` linking to `url` in a new tab, with no opener. */
function newTabLink(doc: Document, text: string, url: string): HTMLAnchorElement {
  const link = el(doc, "a", "tw:text-[color:var(--fgColor-accent)]", text);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
