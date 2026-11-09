/**
 * The popover a code owners shield opens on hover or focus, listing a file's owners, or a folder's
 * files grouped by their owners; it exists only while open.
 *
 * It sits beside its shield, which is marked expanded while it is open. It closes on Escape inside
 * it, on a click outside it, on any scroll outside it, once `signal` aborts, or on a call of the
 * returned card's `close`. Closing removes it with its listeners and clears the shield's mark, and,
 * unless a click closed it, hands focus it held to `returnFocus`.
 *
 * Also `describePullRequest`, the whole pull request's code owner details summary.
 */

import {
  type CodeOwner,
  isOwner,
  type OwnedPullRequest,
  owningTeams,
  type PrReviewer,
  reviewingFor,
  reviewsFor,
} from "@/utils/github/code-owners";
import { EYE_ICON, el, icon } from "../ui/dom";
import { fileList } from "../ui/file-list";
import type { Card } from "../ui/hover-intent";
import {
  followOwnerTooltips,
  type OwnerIdentities,
  ownerIdentity,
  ownerSeparator,
} from "../ui/owner-identity";
import { detailsHint, type OwnersDialogContent } from "../ui/owners-dialog";
import { place } from "../ui/place";

/** Octicons 19.15.0 (MIT, GitHub Inc.): alert. */
const ALERT_ICON =
  "M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z";

export interface FileOwnersAt {
  readonly path: string;
  readonly owners: readonly CodeOwner[];
}

/**
 * What a shield lists: a folder's files, its path ending in `/` and its files by full path in the
 * tree's order, a section's files under its label, or a file's owners under its base name.
 */
export type ShieldListing =
  | { readonly folder: string; readonly files: readonly FileOwnersAt[] }
  | { readonly section: string; readonly files: readonly FileOwnersAt[] }
  | { readonly name: string; readonly owners: readonly CodeOwner[] };

interface PopoverOptions {
  /** Where the popover mounts: the sections view's root, which styles it. */
  readonly root: Element;
  /** The page's lifetime; the popover goes with it. */
  readonly signal: AbortSignal;
  /** Moves focus to the shield's row, as the popover closes while holding focus. */
  readonly returnFocus: () => void;
  /** How it draws the owners it names. */
  readonly identities: OwnerIdentities;
}

/** What `listing` shows, its owners drawn by `identities`: its name, its list, and its teams. */
export function describeListing(
  doc: Document,
  listing: ShieldListing,
  identities: OwnerIdentities,
) {
  if ("section" in listing)
    return {
      title: `Code owners of files in ${listing.section}`,
      list: folderList(doc, "", listing.files, identities),
      teams: owningTeams(listing.files.flatMap(({ owners }) => owners)),
    };
  return "folder" in listing
    ? {
        title: `Code owners of files in ${listing.folder.slice(0, -1)}`,
        list: folderList(doc, listing.folder, listing.files, identities),
        teams: owningTeams(listing.files.flatMap(({ owners }) => owners)),
      }
    : {
        title: `Code owners of ${listing.name}`,
        list: ownersList(doc, listing.owners, identities),
        teams: owningTeams(listing.owners),
      };
}

/** Opens the popover listing `listing`. */
// ponytail: builds every file under a folder on each open, thousands of nodes at GitHub's
// 3,000-file cap; cap the list with a "+N more" line,
// or virtualize it with `@pierre/trees`, if that hitches.
export function openListing(
  shield: HTMLElement,
  listing: ShieldListing,
  options: PopoverOptions,
): Card {
  const { title, list } = describeListing(shield.ownerDocument, listing, options.identities);
  return openPopover(shield, title, list, options);
}

/** `owners`, one per line. */
function ownersList(
  doc: Document,
  owners: readonly CodeOwner[],
  identities: OwnerIdentities,
): HTMLElement {
  return el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1 tw:leading-6",
    ...owners.map((owner) => el(doc, "li", "", ownerIdentity(doc, owner, identities))),
  );
}

/**
 * What the whole pull request's code owner details dialog shows: every changed file in
 * `codeOwners`, in its order, grouped by owner set as a folder's are, each owner a PR reviewer
 * reviews for marked, and each owned group none reviews for tagged, with a call-out counting
 * those files, and the owning teams. Without `prReviewers`, only the groups.
 */
// ponytail: builds every changed file on each open, thousands of nodes at GitHub's 3,000-file
// cap; cap the list with a "+N more" line, or virtualize it, if that hitches.
export function describePullRequest(
  doc: Document,
  { codeOwners, prReviewers }: OwnedPullRequest,
  identities: OwnerIdentities,
): { title: string } & Pick<OwnersDialogContent, "summary" | "teams"> {
  const files = [...codeOwners].map(([path, { owners }]) => ({ path, owners }));
  const groups = byOwnerSet(files);
  const filesWithoutPrReviewer = prReviewers
    ? groups
        .filter(({ owners }) => noPrReviewerReviewsFor(owners, prReviewers))
        .flatMap(({ paths }) => paths).length
    : 0;

  const list = groupList(doc, "", groups, identities, prReviewers);
  return {
    title: "Code owners of this pull request",
    summary:
      filesWithoutPrReviewer > 0
        ? [noPrReviewerCallOut(doc, filesWithoutPrReviewer), list]
        : [list],
    teams: owningTeams(files.flatMap(({ owners }) => owners)),
  };
}

/** Whether `owners` has owners and no PR reviewer in `reviewers` reviews for any of them. */
const noPrReviewerReviewsFor = (owners: readonly CodeOwner[], reviewers: readonly PrReviewer[]) =>
  owners.length > 0 && !owners.some((owner) => reviewers.some((r) => reviewsFor(r, owner)));

/** The line counting the `count` files no PR reviewer owns, above the groups. */
function noPrReviewerCallOut(doc: Document, count: number): HTMLElement {
  return el(
    doc,
    "p",
    "tw:mt-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-body-small tw:leading-6",
    icon(doc, ALERT_ICON, { class: "tw:shrink-0 tw:text-fg-muted" }),
    count === 1
      ? "1 file has no current reviewer among its code owners"
      : `${count} files have no current reviewer among their code owners`,
  );
}

/** `files` grouped by owner set, each set's owners heading its files' tree relative to `folder`. */
const folderList = (
  doc: Document,
  folder: string,
  files: readonly FileOwnersAt[],
  identities: OwnerIdentities,
) => groupList(doc, folder, byOwnerSet(files), identities);

/**
 * `groups`, each set's owners heading its files' tree relative to `folder`, with `reviewers`' marks
 * and tags when given.
 */
function groupList(
  doc: Document,
  folder: string,
  groups: readonly OwnerSetGroup[],
  identities: OwnerIdentities,
  reviewers?: readonly PrReviewer[],
): HTMLElement {
  return el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-3",
    ...groups.map(({ owners, paths }) =>
      el(
        doc,
        "li",
        "tw:pl-4",
        ownersHeading(doc, owners, identities, reviewers),
        fileList(
          doc,
          paths.map((path) => path.slice(folder.length)),
        ),
      ),
    ),
  );
}

interface OwnerSetGroup {
  readonly owners: readonly CodeOwner[];
  readonly paths: readonly string[];
}

/**
 * `files` by owner set, ignoring the owners' order and case: in the order of each set's first file,
 * with that file's owners in their CODEOWNERS order, and files that have none last.
 */
function byOwnerSet(files: readonly FileOwnersAt[]): OwnerSetGroup[] {
  const sets = [...Map.groupBy(files, ownerSetKey).values()].map((group) => ({
    owners: group[0]?.owners ?? [],
    paths: group.map(({ path }) => path),
  }));
  return sets.toSorted((a, b) => Number(a.owners.length === 0) - Number(b.owners.length === 0));
}

// CODEOWNERS tokens hold no whitespace, and owners compare ignoring case, as isOwner does.
const ownerSetKey = ({ owners }: FileOwnersAt) =>
  owners
    .map(({ token }) => token.toLowerCase())
    .sort()
    .join(" ");

/**
 * `Owned by` and `owners` comma-separated, or "No code owner" when there are none. With
 * `reviewers`, each owner one of them reviews for is marked, and a set none of them reviews for is
 * tagged.
 */
function ownersHeading(
  doc: Document,
  owners: readonly CodeOwner[],
  identities: OwnerIdentities,
  reviewers?: readonly PrReviewer[],
): HTMLElement {
  const marked = (owner: CodeOwner) => {
    const reviewing = reviewers ? reviewingFor(reviewers, owner) : [];
    return reviewing.length === 0 ? [] : [reviewerMark(doc, owner, reviewing)];
  };

  // A 24px line, the avatars' height, so a wrapped heading's lines stay evenly spaced.
  const heading = el(
    doc,
    "h3",
    "tw:mt-0 tw:mb-1 tw:-ml-4 tw:text-body-small tw:leading-6 tw:font-normal tw:text-fg-muted",
    ...(owners.length > 0
      ? [
          "Owned by ",
          ...owners.flatMap((owner, i) => [
            i > 0 ? ownerSeparator(doc) : "",
            ownerIdentity(doc, owner, identities),
            ...marked(owner),
          ]),
          ...(reviewers && noPrReviewerReviewsFor(owners, reviewers) ? [noPrReviewerTag(doc)] : []),
        ]
      : ["No code owner"]),
  );

  // Named by what it shows: its filter icons' labels would otherwise join the name.
  heading.setAttribute("aria-label", heading.textContent ?? "");
  return heading;
}

/**
 * The eye after `owner`, whom `reviewing` (never empty) review for; its hidden words join the
 * heading's accessible name, and its tooltip says the same.
 */
function reviewerMark(
  doc: Document,
  owner: CodeOwner,
  reviewing: readonly PrReviewer[],
): HTMLElement {
  const words = reviewing.some(({ token }) => isOwner(token, owner))
    ? "Reviewing"
    : `Reviewing through ${reviewing.map(({ token }) => token.slice(1)).join(", ")}`;

  const mark = el(
    doc,
    "span",
    "tw:inline-flex tw:align-middle tw:ml-1 tw:text-fg-muted",
    icon(doc, EYE_ICON, {}),
    // Leading space: the heading's name is built from its text.
    el(doc, "span", "tw:sr-only", ` (${words})`),
  );

  mark.dataset.reviewing = "";
  mark.dataset.tooltip = words;
  return mark;
}

/** The tag after a set's owners when no PR reviewer reviews for any of them. */
function noPrReviewerTag(doc: Document): HTMLElement {
  const tag = el(
    doc,
    "span",
    "tw:inline-block tw:align-middle tw:ml-2 tw:px-1.5 tw:rounded-[2em] tw:text-body-small tw:font-medium tw:leading-body-small tw:text-fg-muted tw:border tw:border-border-default",
    // Leading space: the heading's name is built from its text.
    " No reviewer",
  );
  tag.dataset.unreviewed = "";
  return tag;
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
    "gh-prism-owners tw:inset-auto tw:m-0 tw:box-border tw:max-w-[min(400px,calc(100vw-16px))] tw:max-h-[calc(100vh-16px)] tw:overflow-y-auto tw:pt-3 tw:px-3 tw:pb-0 tw:text-body-small tw:leading-body-small tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:rounded-medium tw:[border:0] tw:[box-shadow:var(--shadow-floating-small)] tw:wrap-anywhere",
    el(doc, "h2", "tw:mt-0 tw:mb-2 tw:text-body-small tw:font-semibold", "Code owners"),
    body,
    detailsHint(doc, "small"),
  );
  popover.popover = "auto";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", label);
  popover.tabIndex = -1;
  followOwnerTooltips(popover);
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
