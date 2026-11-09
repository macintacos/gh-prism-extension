/**
 * How every code owner surface draws an account it names: one link to the account's page holding
 * its 16px avatar and its name, followed, where the surface can filter, by a filter icon that
 * shows only that owner's files. Also the tooltip those icons share on one surface. Its styles
 * live in `ui/owner-identity.css`, which the host's sheet must `@import`.
 */

import type { CodeOwner, TeamAvatarOf } from "@/utils/github/code-owners";
import { el, FILTER_ICON, icon, PEOPLE_ICON } from "./dom";
import type { OwnerFilter } from "./owners-dialog";
import { place } from "./place";

/** How a surface draws code owners: where team avatars come from, and the filter, if any. */
export interface OwnerIdentities {
  readonly teamAvatar: TeamAvatarOf;
  /** Absent where nothing filters, and for the dialog's own code owner: no filter icon follows. */
  readonly filter?: OwnerFilter;
}

/** `owner`'s link and its filter icon, given a filter; their bare token when they have no page. */
export function ownerIdentity(
  doc: Document,
  owner: CodeOwner,
  { teamAvatar, filter }: OwnerIdentities,
): HTMLElement {
  return el(
    doc,
    "span",
    "gh-prism-identity",
    ownerLink(doc, owner, teamAvatar),
    ...(owner.url && filter ? [ownerFilterIcon(doc, owner.token, filter)] : []),
  );
}

/**
 * `owner`'s avatar and name without its `@`, as one link to their page in a new tab; their bare
 * token as plain text when they have no page, such as an email.
 */
export function ownerLink(
  doc: Document,
  { token, url }: CodeOwner,
  teamAvatar: TeamAvatarOf,
): HTMLElement {
  if (!url) return el(doc, "span", "gh-prism-owner-name", token);
  const name = token.slice(1);
  const avatar = token.includes("/") ? teamAvatarOf(doc, teamAvatar(token)) : userAvatar(doc, name);
  return accountLink(doc, url, avatar, el(doc, "span", "gh-prism-owner-name", name));
}

/**
 * Primer's small invisible IconButton, as a link: shows only `token`'s files, or all files, in
 * its selected fill, when the page already shows only theirs.
 */
export function ownerFilterIcon(
  doc: Document,
  token: string,
  { linkOf, navigate }: OwnerFilter,
): HTMLAnchorElement {
  const { href, shown } = linkOf(token);
  const label = shown ? "Show all files" : `Show only files owned by ${token.slice(1)}`;
  const link = el(
    doc,
    "a",
    `gh-prism-owner-filter-icon${shown ? " gh-prism-selected" : ""}`,
    icon(doc, FILTER_ICON, {}),
  );
  link.href = href;
  link.setAttribute("aria-label", label);
  link.dataset.tooltip = label;
  navigateOnPlainClick(link, href, navigate);
  return link;
}

/** The ", " between two identities in a line of them. */
export function ownerSeparator(doc: Document): HTMLElement {
  return el(doc, "span", "gh-prism-owner-separator", ", ");
}

/** A team member: their avatar, login, and display name if known, as one link to their profile. */
export function memberIdentity(doc: Document, login: string, name?: string): HTMLElement {
  const link = accountLink(
    doc,
    `https://github.com/${login}`,
    userAvatar(doc, login),
    el(doc, "span", "gh-prism-member-login", login),
  );
  if (name) link.append(" ", el(doc, "span", "gh-prism-member-name", name));
  return el(doc, "li", "gh-prism-member", link);
}

/**
 * Loads `href` through `navigate` on a plain primary click of `link`; a modified one is the
 * browser's, so Cmd-click or Ctrl-click opens a tab.
 */
export function navigateOnPlainClick(
  link: HTMLAnchorElement,
  href: string,
  navigate: (href: string) => void,
): void {
  // GitHub's router would take a plain click softly, and the owner filter reads its owner once.
  link.addEventListener("click", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    navigate(href);
  });
}

const TOOLTIP_GAP = 4;

/**
 * Shows each `[data-tooltip]` control's tooltip inside `surface` while the pointer rests on it or
 * it has keyboard focus, and an owner link's whole name when its name is cut off: one element in
 * the top layer, so it never adds to a scroller's overflow. It goes with `surface`.
 */
export function followOwnerTooltips(surface: HTMLElement): void {
  const doc = surface.ownerDocument;
  const tooltip = el(doc, "div", "gh-prism-tooltip");
  tooltip.popover = "manual";
  // The control's own name and description already say what it shows.
  tooltip.setAttribute("aria-hidden", "true");
  surface.append(tooltip);

  let open = false;
  const show = (control: HTMLElement) => {
    const text = tooltipOf(control);
    if (text === undefined) return hide();
    tooltip.textContent = text;
    if (!open) tooltip.showPopover();
    open = true;
    place(tooltip, targetOf(control));
  };
  const hide = () => {
    if (open) tooltip.hidePopover();
    open = false;
  };
  const controlAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(TOOLTIP_CONTROL) : null;

  surface.addEventListener("pointerover", ({ target }) => {
    const control = controlAt(target);
    if (control) show(control);
  });
  surface.addEventListener("pointerout", ({ target, relatedTarget }) => {
    const control = controlAt(target);
    if (!control || (relatedTarget instanceof Node && control.contains(relatedTarget))) return;
    const focused = surface.querySelector<HTMLElement>(
      ":is([data-tooltip], a.gh-prism-owner, .gh-prism-member > a):focus-visible",
    );
    if (focused) show(focused);
    else hide();
  });
  surface.addEventListener("focusin", ({ target }) => {
    const control = controlAt(target);
    if (control?.matches(":focus-visible")) show(control);
  });
  surface.addEventListener("focusout", hide);
}

const TOOLTIP_CONTROL =
  "[data-tooltip], a.gh-prism-owner:has(> .gh-prism-owner-name), .gh-prism-member > a:has(> .gh-prism-member-name)";

/**
 * `control`'s tooltip: its own, or an owner's or member's name when cut off; none for a name that
 * fits.
 */
function tooltipOf(control: HTMLElement): string | undefined {
  if (control.dataset.tooltip !== undefined) return control.dataset.tooltip;
  const name = control.querySelector<HTMLElement>(
    ":scope > :is(.gh-prism-owner-name, .gh-prism-member-name)",
  );
  return name && name.scrollWidth > name.clientWidth ? (name.textContent ?? "") : undefined;
}

/** `control`'s box, grown by the tooltip's gap above and below. */
function targetOf(control: HTMLElement): DOMRect {
  const { left, top, width, height } = control.getBoundingClientRect();
  return new DOMRect(left, top - TOOLTIP_GAP, width, height + 2 * TOOLTIP_GAP);
}

/** A link to `url` in a new tab, named by `name`, its text, after `avatar`. */
function accountLink(
  doc: Document,
  url: string,
  avatar: HTMLElement,
  name: HTMLElement,
): HTMLAnchorElement {
  const link = el(doc, "a", "gh-prism-owner", avatar, name);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

/** A team's avatar, its image in once `src` lands. */
function teamAvatarOf(doc: Document, src: Promise<string | undefined>): HTMLElement {
  const avatar = el(doc, "span", "gh-prism-avatar");
  avatar.dataset.kind = "team";
  void src.then((url) => {
    if (!url) {
      avatar.append(noAvatar(doc));
      return;
    }
    const image = avatarImage(doc, url);
    image.addEventListener("error", () => image.replaceWith(noAvatar(doc)), { once: true });
    avatar.append(image);
  });
  return avatar;
}

/** `login`'s avatar. */
function userAvatar(doc: Document, login: string): HTMLElement {
  return el(
    doc,
    "span",
    "gh-prism-avatar",
    avatarImage(doc, `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?s=32`),
  );
}

function avatarImage(doc: Document, src: string): HTMLImageElement {
  const image = el(doc, "img", "");
  image.src = src;
  image.alt = "";
  image.loading = "lazy";
  image.width = 16;
  image.height = 16;
  return image;
}

/** The avatar of a team gh-prism can't read: GitHub's people glyph. */
const noAvatar = (doc: Document) =>
  el(doc, "span", "gh-prism-avatar-none", icon(doc, PEOPLE_ICON, { width: "10", height: "10" }));
