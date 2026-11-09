/**
 * The popup a code-owner shield in a pull request's Reviewers list or beside a comment's author
 * opens on the Conversation tab, in its panel's frame, and on Files changed, listing that code
 * owner's files, the code owner details dialog its click opens, the shields gh-prism adds beside a
 * PR reviewer who owns files where GitHub draws none and beside a comment author who owns files,
 * and the code owners button beside each Reviewers heading.
 */

import {
  codeOwnerOf,
  filesOwnedBy,
  type OwnedFiles,
  type OwnedPullRequest,
  type Ownership,
  ownershipOf,
  ownsAnyFile,
  reviewerOf,
  type TeamAvatarOf,
  type TeamMembersOf,
} from "@/utils/github/code-owners";
import type { TeamRosterOf } from "@/utils/github/team-roster";
import {
  type CommentAuthor,
  findOwnerSpots,
  followOwnerSpots,
  type OwnerSpots,
  type ReviewerListKind,
  type ReviewerRow,
  type ReviewersHeading,
  reviewerShieldOf,
  shieldOwner,
} from "../files-page";
import { el, icon, SHIELD_LOCK } from "../ui/dom";
import { fileList } from "../ui/file-list";
import { type Card, followHoverIntent } from "../ui/hover-intent";
import { followOwnerTooltips, type OwnerIdentities, ownerIdentity } from "../ui/owner-identity";
import { ownerTeams } from "../ui/owner-teams";
import {
  detailsHint,
  type OwnerFilter,
  openOwnersDialog,
  ownerFilterAction,
} from "../ui/owners-dialog";
import { place } from "../ui/place";
import { openPrOwners, PR_OWNERS, PR_OWNERS_KIND, prOwnersButton } from "../ui/pr-owners";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./reviewer-files.css?inline";

const ID = "gh-prism-reviewer-files";
const OWN_SHIELD = "button[data-gh-prism-owner]";
// Keep in sync with reviewer-files.css's [data-gh-prism-list] rules.
const HEADING_BUTTON = `${PR_OWNERS}[${PR_OWNERS_KIND}]`;

/**
 * Until `signal` aborts, opens a popup below a code-owner shield in a pull request's Reviewers
 * list, 200 ms after the pointer rests on it or at once on focus, listing the changed files that
 * code owner owns, and describes the shield with it. Opens from GitHub's shield, or from the one
 * this adds beside each PR reviewer who owns a changed file, or whom GitHub marks a code owner,
 * where GitHub draws none, or beside each comment author `findAuthors` finds who owns a changed
 * file: a PR reviewer as their Reviewers row shows, anyone else looked up once through
 * `teamMembers`. Mounts a stylesheet in `doc`'s head. Opens nothing for a code owner who owns no
 * changed file, unless GitHub marks them one: then it says GitHub hides the team. Tab from the
 * shield enters the popup.
 * Closes 150 ms after the pointer leaves shield and popup, and at once on Escape, focus leaving
 * both, or a scroll outside it, moving focus it held to the shield. A click on the shield opens
 * the code owner details dialog instead, listing owning teams' members through `teamMembers`.
 * Draws teams' avatars through `teamAvatar`, and the dialog reads a team's whole roster through
 * `teamRoster`. Puts the code owners button beside each Reviewers heading once `read` names a code
 * owner for a changed file; it opens the whole pull request's code owner details dialog. Calls `read` at most once, when a Reviewers list, its heading, or a
 * comment author first shows. Given `filter`, popup and dialog offer to show only the code owner's
 * files, when they list any, and each team they name filters from its name.
 */
export function showReviewerFiles(
  doc: Document,
  signal: AbortSignal,
  {
    read,
    teamMembers,
    teamAvatar,
    teamRoster,
    filter,
    findAuthors,
  }: {
    read: () => Promise<Ownership>;
    findAuthors: (doc: Document) => CommentAuthor[];
    teamMembers: TeamMembersOf;
    teamAvatar: TeamAvatarOf;
    teamRoster: TeamRosterOf;
    filter?: OwnerFilter;
  },
): void {
  const identities: OwnerIdentities = { teamAvatar, filter };
  let ownership: Ownership | undefined;
  // Settled with ownership, so a mutation batch never rescans the code owners.
  let ownedPr: OwnedPullRequest | undefined;
  let reading: Promise<Ownership> | undefined;
  const readOnce = () =>
    (reading ??= read().then((settled) => {
      ownership = settled;
      if (ownsAnyFile(settled)) ownedPr = settled;
      return settled;
    }));

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    style.remove();
    for (const own of doc.querySelectorAll(`${OWN_SHIELD}, ${HEADING_BUTTON}`)) own.remove();
  });

  const shieldAt = (target: Element) =>
    target.closest<HTMLElement>(OWN_SHIELD) ?? reviewerShieldOf(target);
  let closeCard = () => {};
  // Firefox fires no focusout when the page removes the focused shield, so watch for it.
  let focusedShield: HTMLElement | null = null;
  doc.addEventListener(
    "focusin",
    ({ target }) => (focusedShield = target instanceof Element ? shieldAt(target) : null),
    { signal },
  );
  doc.addEventListener("focusout", () => (focusedShield = null), { signal });

  // Each comment author's answer by lowercased token; `Ownership` never changes once settled.
  const authorAnswers = new Map<string, "pending" | { owned?: OwnedFiles }>();

  /**
   * What comment author `token`'s shield shows: a PR reviewer's files as their Reviewers row shows
   * them, anyone else's once their lookup settles, starting it, once, if it hasn't.
   */
  function authorOwned(settled: Ownership, token: string): OwnedFiles | undefined | "pending" {
    const key = token.toLowerCase();
    const answer = authorAnswers.get(key);
    if (answer) return answer === "pending" ? answer : answer.owned;

    const { codeOwners, prReviewers } = settled;
    if (!codeOwners || reviewerOf(prReviewers ?? [], token)) {
      const owned = ownedFiles(settled, token);
      authorAnswers.set(key, { owned });
      return owned;
    }
    authorAnswers.set(key, "pending");
    void ownershipOf({ codeOwners, prReviewers }, token, teamMembers).then((owned) => {
      authorAnswers.set(key, { owned: owned.paths.length > 0 ? owned : undefined });
      if (!signal.aborted) addAuthorShields(findAuthors(doc), settled);
    });
    return "pending";
  }

  /**
   * Adds gh-prism's shield after each of `authors`' names that has none yet and whose author owns
   * changed files. Synchronous, so overlapping batches can't draw a header two shields.
   */
  function addAuthorShields(authors: readonly CommentAuthor[], settled: Ownership): void {
    for (const { kind, token, name } of authors) {
      if (name.nextElementSibling?.matches(OWN_SHIELD)) continue;
      const owned = authorOwned(settled, token);
      if (owned && owned !== "pending")
        name.after(shieldFor(doc, COMMENT_SHIELD_LOOKS[kind], token, owned));
    }
  }

  /** What `shield`'s popup and dialog show; a comment shield is drawn only once settled. */
  const ownedOf = (shield: HTMLElement, settled: Ownership): OwnedFiles | undefined => {
    const token = ownerOf(shield);
    const owned = shield.matches(".gh-prism-comment-shield")
      ? authorOwned(settled, token)
      : ownedFiles(settled, token);
    return owned === "pending" ? undefined : owned;
  };

  const addEverySpot = (
    { rows, authors, headings }: OwnerSpots,
    settled: Ownership,
    ownedPr: OwnedPullRequest | undefined,
  ) => {
    addShields(rows, settled);
    addAuthorShields(authors, settled);
    if (ownedPr) addPrOwnersButtons(headings);
  };
  followOwnerSpots(
    doc,
    (spots) => {
      if (focusedShield && !focusedShield.isConnected) {
        focusedShield = null;
        closeCard();
      }
      const { rows, authors, headings } = spots;
      if (ownership) addEverySpot(spots, ownership, ownedPr);
      else if (!reading && (rows.length > 0 || authors.length > 0 || headings.length > 0))
        void readOnce().then((settled) => {
          if (!signal.aborted) addEverySpot(findOwnerSpots(doc, findAuthors), settled, ownedPr);
        });
    },
    { findAuthors, signal },
  );

  doc.addEventListener(
    "click",
    ({ target }) => {
      const button = target instanceof Element ? target.closest(HEADING_BUTTON) : null;
      if (!button || !ownedPr) return;
      const kind = button.getAttribute(PR_OWNERS_KIND);
      openPrOwners(doc, ownedPr, {
        teamMembers,
        teamAvatar,
        teamRoster,
        filter,
        // GitHub may have replaced the form while the dialog was open.
        returnFocus: () =>
          doc.querySelector<HTMLElement>(`${PR_OWNERS}[${PR_OWNERS_KIND}="${kind}"]`)?.focus(),
        signal,
      });
    },
    { signal },
  );

  followHoverIntent(doc, signal, {
    triggerOf: shieldAt,
    show: async (shield) => {
      const token = ownerOf(shield);
      const owned = ownedOf(shield, await readOnce());
      const action =
        filter && owned && owned.paths.length > 0
          ? ownerFilterAction(doc, token, filter)
          : undefined;
      const card = owned && show(shield, popupBody(doc, owned, identities), action);
      if (card) closeCard = card.close;
      return card;
    },
  });

  // On the document: GitHub replaces the classic sidebar's nodes mid-visit. In the capture phase:
  // the new Files changed page's React root stops a review thread's clicks from bubbling.
  let latestClick = 0;
  doc.addEventListener(
    "click",
    async ({ target }) => {
      const shield = target instanceof Element ? shieldAt(target) : null;
      if (!shield) return;
      const thisClick = ++latestClick;

      const token = ownerOf(shield);
      const owned = ownedOf(shield, await readOnce());
      if (signal.aborted || thisClick !== latestClick || !owned) return;

      closeCard();
      openOwnersDialog(doc, {
        summary: popupBody(doc, owned, identities),
        teams: token.includes("/") ? [token] : owned.teams,
        teamMembers,
        teamAvatar,
        teamRoster,
        filter: owned.paths.length > 0 ? filter : undefined,
        owner: token,
        // Focus back on the shield opens its card again, as focus does anywhere here.
        returnFocus: () => shield.focus({ preventScroll: true }),
        signal,
      });
    },
    { capture: true, signal },
  );
}

/** The token of the code owner `shield` marks: gh-prism's own, or GitHub's. */
const ownerOf = (shield: HTMLElement): string => shield.dataset.ghPrismOwner ?? shieldOwner(shield);

/**
 * What `token`'s popup lists from `ownership`, with no paths when GitHub marks `token` a code owner
 * but names no team that owns a changed file; `undefined` when there is nothing to show.
 */
function ownedFiles(
  { codeOwners, prReviewers = [] }: Ownership,
  token: string,
): OwnedFiles | undefined {
  if (!codeOwners) return undefined;
  const reviewer = reviewerOf(prReviewers, token);
  const owned = filesOwnedBy(codeOwners, token, reviewer?.teams ?? []);
  return owned.paths.length === 0 && !reviewer?.codeOwner ? undefined : owned;
}

/** A shield's classes, and the class of a span wrapping its glyph, if any. */
interface ShieldLook {
  readonly classes: string;
  readonly wrap?: string;
}

/** How each Reviewers list draws its icons, so gh-prism's shield matches GitHub's in it. */
const SHIELD_LOOKS: Record<ReviewerListKind, ShieldLook> = {
  // GitHub's own classes for its shield in the classic sidebar.
  classic: {
    classes: "gh-prism-reviewer-shield mr-2 btn-link muted-icon",
    wrap: "reviewers-status-icon",
  },
  // The 16px invisible IconButton the overview draws its shield and status icons as.
  overview: {
    classes:
      "gh-prism-reviewer-shield tw:inline-grid tw:place-items-center tw:size-4 tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
  },
};

/** How a comment header draws gh-prism's shield in each page layout. */
const COMMENT_SHIELD_LOOKS: Record<ReviewerListKind, ShieldLook> = {
  // GitHub's classic shield, without the Reviewers row's status-icon wrapper.
  classic: { classes: "gh-prism-comment-shield btn-link" },
  // Primer's invisible IconButton at the ActivityHeader title row's 20px, on the overview and the
  // new Files changed.
  overview: {
    classes:
      "gh-prism-comment-shield tw:inline-grid tw:place-items-center tw:size-5 tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
  },
};

/**
 * Adds gh-prism's shield to each of `rows` whose PR reviewer has something to show in `ownership`
 * and no shield yet, just before the row's last icon, where GitHub puts its own, and removes it
 * from a row where GitHub has since drawn its own.
 */
function addShields(rows: readonly ReviewerRow[], ownership: Ownership): void {
  for (const { kind, token, shield, icons } of rows) {
    const own = icons.querySelector(OWN_SHIELD);
    if (shield) own?.remove();
    if (shield || own) continue;
    const owned = ownedFiles(ownership, token);
    if (!owned || !reviewerOf(ownership.prReviewers ?? [], token)) continue;
    const added = shieldFor(icons.ownerDocument, SHIELD_LOOKS[kind], token, owned);
    const last = icons.lastElementChild;
    if (last) last.before(added);
    else icons.append(added);
  }
}

/** Adds the code owners button before each of `headings` that lacks one. */
function addPrOwnersButtons(headings: readonly ReviewersHeading[]): void {
  for (const { kind, heading } of headings) {
    if (heading.previousElementSibling?.matches(HEADING_BUTTON)) continue;
    const button = prOwnersButton(heading.ownerDocument);
    button.setAttribute(PR_OWNERS_KIND, kind);
    heading.before(button);
  }
}

/** A shield marking `token` a code owner, drawn with `look`. */
function shieldFor(
  doc: Document,
  { classes, wrap }: ShieldLook,
  token: string,
  { teams, direct }: OwnedFiles,
): HTMLButtonElement {
  const glyph = icon(doc, SHIELD_LOCK, {
    class: "octicon octicon-shield-lock",
  });
  const shield = el(doc, "button", classes, wrap ? el(doc, "span", wrap, glyph) : glyph);
  shield.type = "button";
  shield.dataset.ghPrismOwner = token;
  const through = teams.length > 0 && !direct ? ` through ${teams.map(bare).join(", ")}` : "";
  shield.setAttribute("aria-label", `${bare(token)} is a code owner${through}`);
  return shield;
}

/** `token` without its leading `@`, as GitHub names an account in its labels. */
const bare = (token: string) => token.replace(/^@/, "");

/**
 * Shows the popup holding `body` below `shield`, ending in `action` if given, and names it as
 * `shield`'s description, closing it on a scroll outside it.
 */
function show(shield: HTMLElement, body: readonly Node[], action: HTMLElement | undefined): Card {
  const doc = shield.ownerDocument;
  const popover = el(
    doc,
    "div",
    "gh-prism-reviewer-files tw:inset-auto tw:m-0 tw:w-max tw:max-w-[min(440px,calc(100vw-16px))] tw:box-border tw:max-h-[min(320px,calc(100vh-16px))] tw:overflow-y-auto tw:pt-4 tw:px-4 tw:pb-0 tw:text-body-medium tw:leading-body-medium tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:border tw:border-border-default tw:rounded-medium tw:wrap-anywhere",
    ...body,
    detailsHint(doc, "medium", action),
  );
  popover.id = ID;
  popover.popover = "manual";
  followOwnerTooltips(popover);
  // Firefox tabs into any scroller. Keep this one a Tab stop only where Chromium does: when no
  // control inside can scroll it.
  if (popover.querySelector("a[href], button")) popover.tabIndex = -1;
  doc.body.append(popover);
  // source: Tab from the shield enters it, and Tab past its end goes on from the shield.
  popover.showPopover({ source: shield });
  place(popover, shield.getBoundingClientRect());
  shield.setAttribute("aria-describedby", ID);

  const closed = new AbortController();
  const close = () => {
    if (closed.signal.aborted) return;
    // Removed while it holds focus, it would drop focus to the body.
    if (popover.contains(doc.activeElement)) shield.focus({ preventScroll: true });
    closed.abort();
    popover.remove();
    shield.removeAttribute("aria-describedby");
  };
  // Capture: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    ({ target }) => {
      if (!(target instanceof Node && popover.contains(target))) close();
    },
    { capture: true, signal: closed.signal },
  );
  return { element: popover, close };
}

/**
 * The popup's content: the count, the teams that make them an owner, drawn by `identities`, and
 * the files grouped under their folders; or why there are none.
 */
function popupBody(
  doc: Document,
  { paths, teams, direct }: OwnedFiles,
  identities: OwnerIdentities,
): Node[] {
  if (paths.length === 0)
    return [
      el(
        doc,
        "p",
        "tw:m-0 tw:text-fg-muted",
        "GitHub doesn't show you which team makes them a code owner, so their files aren't listed.",
      ),
    ];

  const files = paths.length === 1 ? "1 file" : `${paths.length} files`;
  return [
    el(doc, "p", "tw:mt-0 tw:mb-2 tw:font-semibold", `Code owner of ${files} in this pull request`),
    ...(teams.length > 0 ? [throughLine(doc, teams, direct, identities)] : []),
    fileList(doc, paths),
  ];
}

/**
 * The line under a code owner's file count naming the `teams` that make them one, `direct` when
 * CODEOWNERS names them too: one team's identity inline, or two or more counted by "N teams".
 */
export function throughLine(
  doc: Document,
  teams: readonly string[],
  direct: boolean,
  identities: OwnerIdentities,
): HTMLElement {
  const [only] = teams;
  // A 24px line, the avatars' height; -6px keeps it under the count line.
  return el(
    doc,
    "p",
    "tw:-mt-1.5 tw:mb-2 tw:text-body-small tw:leading-6 tw:text-fg-muted",
    direct ? "Directly and through " : "Through ",
    teams.length === 1 && only
      ? ownerIdentity(doc, codeOwnerOf(only), identities)
      : ownerTeams(doc, teams, identities),
  );
}
