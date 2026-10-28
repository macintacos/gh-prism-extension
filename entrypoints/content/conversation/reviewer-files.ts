/**
 * The popup a code-owner shield in a pull request's Reviewers list opens on the Conversation tab,
 * listing that code owner's files, and the shield gh-prism adds beside a PR reviewer who owns
 * files where GitHub draws none.
 */

import {
  codeOwnerOf,
  ownerFilter,
  type PrCodeOwners,
  type PrReviewer,
  reviewerOf,
} from "@/utils/github/code-owners";
import {
  findReviewerRows,
  followReviewerRows,
  type ReviewerListKind,
  type ReviewerRow,
  reviewerShieldOf,
  shieldOwner,
} from "../files-page";
import { el, icon } from "../ui/dom";
import { type Card, followHoverIntent } from "../ui/hover-intent";
import { place } from "../ui/place";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./reviewer-files.css?inline";

const ID = "gh-prism-reviewer-files";
const OWN_SHIELD = "button[data-gh-prism-owner]";

/** The visit's code owners and PR reviewers, each `undefined` when its read failed. */
export interface Ownership {
  readonly codeOwners: PrCodeOwners | undefined;
  readonly prReviewers: readonly PrReviewer[] | undefined;
}

/**
 * Until `signal` aborts, opens a popup below a code-owner shield in a pull request's Reviewers
 * list, 200 ms after the pointer rests on it or at once on focus, listing the changed files that
 * code owner owns, and describes the shield with it. Opens from GitHub's shield, or from the one
 * this adds beside each PR reviewer who owns a changed file, or whom GitHub marks a code owner,
 * where GitHub draws none. Mounts a stylesheet in `doc`'s head. Opens nothing for a code owner who
 * owns no changed file, unless GitHub marks them one: then it says GitHub hides the team. Closes
 * 150 ms after the pointer leaves shield and popup, and at once on Escape, focus leaving the
 * shield, or a scroll outside it. Calls `read` at most once, when a Reviewers list first shows.
 */
export function showReviewerFiles(
  doc: Document,
  signal: AbortSignal,
  read: () => Promise<Ownership>,
): void {
  let ownership: Ownership | undefined;
  let reading: Promise<Ownership> | undefined;
  const readOnce = () => (reading ??= read().then((settled) => (ownership = settled)));

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    style.remove();
    for (const shield of doc.querySelectorAll(OWN_SHIELD)) shield.remove();
  });

  followReviewerRows(
    doc,
    (rows) => {
      if (ownership) addShields(rows, ownership);
      else if (rows.length > 0 && !reading)
        void readOnce().then((settled) => {
          if (!signal.aborted) addShields(findReviewerRows(doc), settled);
        });
    },
    { signal },
  );

  followHoverIntent(doc, signal, {
    triggerOf: (target) => target.closest<HTMLElement>(OWN_SHIELD) ?? reviewerShieldOf(target),
    show: async (shield) => {
      const owned = ownedFiles(await readOnce(), ownerOf(shield));
      return owned && show(shield, owned);
    },
  });
}

/** The token of the code owner `shield` marks: gh-prism's own, or GitHub's. */
const ownerOf = (shield: HTMLElement): string => shield.dataset.ghPrismOwner ?? shieldOwner(shield);

/** What a code owner's popup lists. */
interface OwnedFiles {
  /** The changed files they own. */
  readonly paths: readonly string[];
  /** The teams GitHub names for them that own one of `paths`. */
  readonly teams: readonly string[];
  /** Whether CODEOWNERS names them for one of `paths` themselves. */
  readonly direct: boolean;
}

/**
 * What `token`'s popup lists from `ownership`, with no paths when GitHub marks `token` a code owner
 * but names no team that owns a changed file; `undefined` when there is nothing to show.
 */
function ownedFiles(
  { codeOwners, prReviewers = [] }: Ownership,
  token: string,
): OwnedFiles | undefined {
  if (!codeOwners) return undefined;
  const changed = [...codeOwners.keys()];
  const paths = changed.filter(ownerFilter(codeOwners, token, prReviewers));
  const reviewer = reviewerOf(prReviewers, token);
  if (paths.length === 0 && !reviewer?.codeOwner) return undefined;
  return {
    paths,
    teams: (reviewer?.teams ?? []).filter((team) =>
      changed.some(ownerFilter(codeOwners, team, [])),
    ),
    direct: changed.some(ownerFilter(codeOwners, token, [])),
  };
}

/** How each Reviewers list draws its icons, so gh-prism's shield matches GitHub's in it. */
const SHIELD_LOOKS: Record<ReviewerListKind, { readonly classes: string; readonly wrap?: string }> =
  {
    // GitHub's own classes for its shield in the classic sidebar.
    classic: {
      classes: "gh-prism-reviewer-shield mr-2 btn-link muted-icon",
      wrap: "reviewers-status-icon",
    },
    // Primer's small invisible IconButton, as the overview draws its shield.
    overview: {
      classes:
        "gh-prism-reviewer-shield tw:inline-grid tw:place-items-center tw:size-7 tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
    },
  };

// Octicons shield-lock-16 (MIT, GitHub Inc.), 19.15.0, as GitHub draws its own shield.
const SHIELD_LOCK =
  "m8.533.133 5.25 1.68A1.75 1.75 0 0 1 15 3.48V7c0 1.566-.32 3.182-1.303 4.682-.983 1.498-2.585 2.813-5.032 3.855a1.697 1.697 0 0 1-1.33 0c-2.447-1.042-4.049-2.357-5.032-3.855C1.32 10.182 1 8.566 1 7V3.48a1.75 1.75 0 0 1 1.217-1.667l5.25-1.68a1.748 1.748 0 0 1 1.066 0Zm-.61 1.429.001.001-5.25 1.68a.251.251 0 0 0-.174.237V7c0 1.36.275 2.666 1.057 3.859.784 1.194 2.121 2.342 4.366 3.298a.196.196 0 0 0 .154 0c2.245-.957 3.582-2.103 4.366-3.297C13.225 9.666 13.5 8.358 13.5 7V3.48a.25.25 0 0 0-.174-.238l-5.25-1.68a.25.25 0 0 0-.153 0ZM9.5 6.5c0 .536-.286 1.032-.75 1.3v2.45a.75.75 0 0 1-1.5 0V7.8A1.5 1.5 0 1 1 9.5 6.5Z";

/**
 * Adds gh-prism's shield to each of `rows` whose PR reviewer has something to show in `ownership`
 * and no shield yet, just before the row's last icon, where GitHub puts its own.
 */
function addShields(rows: readonly ReviewerRow[], ownership: Ownership): void {
  for (const { kind, token, shield, icons } of rows) {
    if (shield || icons.querySelector(OWN_SHIELD)) continue;
    const owned = ownedFiles(ownership, token);
    if (!owned || !reviewerOf(ownership.prReviewers ?? [], token)) continue;
    const added = shieldFor(icons.ownerDocument, kind, token, owned);
    const last = icons.lastElementChild;
    if (last) last.before(added);
    else icons.append(added);
  }
}

/** A shield marking `token` a code owner, drawn as `kind`'s list draws GitHub's. */
function shieldFor(
  doc: Document,
  kind: ReviewerListKind,
  token: string,
  { teams, direct }: OwnedFiles,
): HTMLButtonElement {
  const { classes, wrap } = SHIELD_LOOKS[kind];
  const glyph = icon(doc, SHIELD_LOCK, { class: "octicon octicon-shield-lock" });
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
 * Shows the popup listing `owned` below `shield` and names it as `shield`'s description, closing
 * it on a scroll outside it.
 */
function show(shield: HTMLElement, owned: OwnedFiles): Card {
  const doc = shield.ownerDocument;
  const popover = el(
    doc,
    "div",
    "gh-prism-reviewer-files tw:inset-auto tw:m-0 tw:w-max tw:max-w-[360px] tw:max-h-[min(320px,calc(100vh-16px))] tw:overflow-y-auto tw:p-4 tw:text-body-medium tw:leading-body-medium tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:border tw:border-border-default tw:rounded-medium tw:wrap-anywhere",
    ...popupBody(doc, owned),
  );
  popover.id = ID;
  popover.popover = "manual";
  doc.body.append(popover);
  popover.showPopover();
  place(popover, shield.getBoundingClientRect());
  shield.setAttribute("aria-describedby", ID);

  const closed = new AbortController();
  const close = () => {
    if (closed.signal.aborted) return;
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
 * The popup's content: the count, the teams that make them an owner, and one row per file; or why
 * there is none.
 */
function popupBody(doc: Document, { paths, teams, direct }: OwnedFiles): Node[] {
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
  const through = teams.flatMap((team, i) => [i > 0 ? ", " : "", teamLink(doc, team)]);
  return [
    el(doc, "p", "tw:mt-0 tw:mb-2 tw:font-semibold", `Code owner of ${files} in this pull request`),
    ...(teams.length > 0
      ? [
          el(
            doc,
            "p",
            "tw:-mt-1 tw:mb-2 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
            direct ? "Directly and through " : "Through ",
            ...through,
          ),
        ]
      : []),
    el(
      doc,
      "ul",
      "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1 tw:text-body-small tw:leading-body-small tw:font-mono",
      ...paths.map((path) => el(doc, "li", "", ...pathParts(doc, path))),
    ),
  ];
}

/** `team`'s token, linking to its team page in a new tab when it has one. */
function teamLink(doc: Document, team: string): Node | string {
  const { url } = codeOwnerOf(team);
  if (!url) return team;
  const link = el(doc, "a", "tw:text-[color:var(--fgColor-accent)]", team);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/** `path` as a muted directory and its file name. */
function pathParts(doc: Document, path: string): (Node | string)[] {
  const nameStart = path.lastIndexOf("/") + 1;
  return nameStart === 0
    ? [path]
    : [el(doc, "span", "tw:text-fg-muted", path.slice(0, nameStart)), path.slice(nameStart)];
}
