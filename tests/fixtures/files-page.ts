import { findFilesPage, readChangedFiles } from "../../entrypoints/content/files-page";
// The `?raw` import is required: `readFileSync` throws under happy-dom.
import classicFixture from "./classic-files-page.html?raw";
import commitFixture from "./commit-page.html?raw";
import fixture from "./files-page.html?raw";
import filterMenuFixture from "./filter-menu.html?raw";
import filterMenuNotOwnerFixture from "./filter-menu-not-owner.html?raw";
import overlayFixture from "./pr-overlay.html?raw";
import viewedCommitFilterFixture from "./viewed-commit-filter-page.html?raw";
import viewedFixture from "./viewed-files-page.html?raw";

/** Replaces `document.body` with the Files changed markup. */
export function loadFixture(): void {
  document.body.innerHTML = fixture;
}

/**
 * Replaces `document.body` with a signed-in pull request's Files changed markup, one file
 * Viewed.
 */
export function loadViewedFixture(): void {
  document.body.innerHTML = viewedFixture;
}

/** Replaces `document.body` with the signed-in Files changed markup filtered to one commit. */
export function loadViewedCommitFilterFixture(): void {
  document.body.innerHTML = viewedCommitFilterFixture;
}

/** The viewed fixture's diff anchor for `config/app.toml`, marked Viewed. */
export const VIEWED_APP_TOML =
  "diff-c9bd6e09f349b0f93c557afe2376f4a9345a21b5daed12c6af0a714773aba693";

/** The viewed fixture's diff anchor for `src/lib.rs`, not Viewed. */
export const VIEWED_LIB_RS =
  "diff-b1a35a68f14e696205874893c07fd24fdb88882b47c23cc0e0c80a30c7d53759";

/** The viewed fixture's diff anchor for `Cargo.lock`, not Viewed. */
export const VIEWED_CARGO_LOCK =
  "diff-13ee4b2252c9e516a0547f2891aa2105c3ca71c6d7a1e682c69be97998dfc87e";

/**
 * Opens the narrow layout's overlay ahead of the page, as GitHub's portal precedes it, holding a
 * copy of the docked tree; returns the overlay's `#pr-file-tree`.
 */
export function openOverlay(): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = overlayFixture;
  const portal = template.content.querySelector("#__primerPortalRoot__");
  const docked = document.querySelector('#pr-file-tree ul[role="tree"]');
  const sidebar = portal?.querySelector<HTMLElement>("#pr-file-tree");
  const slot = sidebar?.querySelector('[class*="FileTreeScrollable"] ul[role="tree"]');
  if (!portal || !sidebar || !docked || !slot) throw new Error("fixture has no overlay or tree");
  const tree = docked.cloneNode(true);
  if (!(tree instanceof Element)) throw new Error("docked tree is not an element");
  slot.replaceWith(tree);
  document.body.prepend(portal);
  return sidebar;
}

/** Closes the overlay `openOverlay` opened. */
export function closeOverlay(): void {
  document.getElementById("__primerPortalRoot__")?.remove();
}

/**
 * Opens GitHub's filter menu ahead of the page, as Primer's portal precedes it: `owner` when you
 * own a changed file, `notOwner` when you don't. Ties the fixture's filter-options button to the
 * menu, as GitHub does on open, and returns the menu's `ul[role="menu"]`.
 */
export function openFilterMenu(kind: "owner" | "notOwner"): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = kind === "owner" ? filterMenuFixture : filterMenuNotOwnerFixture;
  const portal = template.content.querySelector("#__primerPortalRoot__");
  const list = portal?.querySelector<HTMLElement>('ul[role="menu"]');
  const button = document.querySelector('#diff-file-tree-filter button[aria-haspopup="true"]');
  const labelledBy = list?.getAttribute("aria-labelledby");
  if (!portal || !list || !button || !labelledBy) throw new Error("fixture has no filter menu");
  button.id = labelledBy;
  document.body.prepend(portal);
  return list;
}

/**
 * Adds GitHub's owned-by group, and the divider after it, behind the first divider of an open
 * `notOwner` menu, as GitHub does once its code-owners read lands.
 */
export function addOwnedByGroup(list: Element): void {
  const template = document.createElement("template");
  template.innerHTML = filterMenuFixture;
  const group = template.content
    .querySelector('[aria-keyshortcuts="o"]')
    ?.closest('[data-component="ActionList.Group"]');
  const divider = group?.nextElementSibling;
  const first = list.querySelector('[data-component="ActionList.Divider"]');
  if (!group || !divider || !first) throw new Error("fixture has no owned-by group");
  first.after(group, divider);
}

/** Closes the menu `openFilterMenu` opened, as Primer unmounts it. */
export function closeFilterMenu(): void {
  document.getElementById("__primerPortalRoot__")?.remove();
}

/** The fixture element with `id`; throws when the fixture lacks it. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el;
}

/**
 * Replaces the document with a pull request's classic Files changed page as `login` sees it;
 * GitHub leaves the login empty for a signed-out viewer.
 */
export function loadClassicFixture(login: string): void {
  document.head.innerHTML = `<meta name="user-login" content="${login}">`;
  document.body.innerHTML = classicFixture;
}

/**
 * Replaces `document.body` with a pull request header's counter slot as its header tabs show it,
 * holding the counter `text`.
 */
export function loadHeaderFixture(text = "+36 -10"): void {
  document.body.innerHTML = `<div class="rightContentWrapper__x"><div class="d-flex">${text}</div></div>`;
}

/** Replaces `document.body` with a single commit's markup. */
export function loadCommitFixture(): void {
  document.body.innerHTML = commitFixture;
}

/** The pull request fixture's diff list; throws when the fixture lacks it. */
export const diffList = (): Element => {
  const diffs = document.querySelector('[data-testid="diff-content"]');
  if (!diffs) throw new Error("fixture has no diff list");
  return diffs;
};

/** The Files changed markup `findFilesPage` finds in the document; throws when it finds none. */
export const foundPage = () => {
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture has no Files changed markup");
  return page;
};

/** The commit fixture's diff anchor for `bin/caret-launcher`. */
export const LAUNCHER_DIFF =
  "diff-90df21c5f2396574b17d2f1696a2e63cee454ee37910c7b254a81d44449cdaa4";

/** The native row link for the changed file at `path`; throws when there is none. */
export const linkTo = (path: string): HTMLAnchorElement => {
  const found = readChangedFiles(document).find((f) => f.path === path);
  if (!found) throw new Error(`no changed file ${path}`);
  return found.link;
};
