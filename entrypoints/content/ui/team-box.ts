/**
 * A team's box in the code owner details dialog: a header naming the team, with its member count
 * and, for a large team, a member search toggle, over its members. A large team shows its first
 * five, then a button that shows all of them; showing all, or searching, reads the team's whole
 * roster, with display names, when GitHub's first list didn't hold everyone.
 */

import { type CodeOwner, codeOwnerOf, type TeamMembers } from "@/utils/github/code-owners";
import type { TeamMember } from "@/utils/github/team-roster";
import { el, icon, SEARCH_ICON } from "./dom";
import { memberIdentity, type OwnerIdentities, ownerFilterIcon, ownerLink } from "./owner-identity";

/** What a team's box reads: its members as GitHub first lists them, and on demand its roster. */
export interface TeamReads {
  readonly members: Promise<TeamMembers | undefined>;
  /** Never rejects. */
  readonly roster: () => Promise<readonly TeamMember[] | undefined>;
}

/** The most members a team shows whole; a larger one shows `COLLAPSED_COUNT`, then Show all. */
const FULL_COUNT = 9;
const COLLAPSED_COUNT = 8;
const LOADING_DELAY_MS = 150;

/**
 * `team`'s box: a header naming it, drawn by `identities`, over its members, which fill in with
 * their count once `reads.members` settles.
 */
export function teamBox(
  doc: Document,
  team: string,
  reads: TeamReads,
  { teamAvatar, filter }: OwnerIdentities,
): HTMLElement {
  const owner = codeOwnerOf(team);
  const count = el(
    doc,
    "span",
    "tw:shrink-0 tw:ml-2 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
  );
  // The filter icon stays out of the heading, which its label would otherwise join. The header's
  // corners sit 1px inside the box's, so the fill meets the border without clipping.
  const header = el(
    doc,
    "div",
    "tw:flex tw:items-center tw:min-h-6 tw:py-1.5 tw:px-3 tw:bg-bg-muted tw:rounded-t-[calc(var(--borderRadius-medium)-1px)] tw:last:rounded-b-[calc(var(--borderRadius-medium)-1px)]",
    el(
      doc,
      "div",
      "gh-prism-identity tw:flex-1 tw:min-w-0",
      el(
        doc,
        "h3",
        "tw:inline tw:m-0 tw:text-body-medium tw:leading-body-medium tw:font-normal",
        ownerLink(doc, owner, teamAvatar),
      ),
      ...(owner.url && filter ? [ownerFilterIcon(doc, owner.token, filter)] : []),
    ),
    count,
  );
  const box = el(doc, "section", "tw:border tw:border-border-default tw:rounded-medium", header);

  void reads.members.then((read) => {
    if (read && read.total > 0)
      count.textContent = read.total === 1 ? "1 member" : `${read.total} members`;
    if (!read) box.append(muted(doc, "GitHub doesn't show you this team's members."));
    else if (read.total === 0) box.append(muted(doc, "This team has no members."));
    else {
      const members = memberList(doc, owner, read, reads.roster);
      if (members.toggle) header.append(members.toggle);
      box.append(members.body);
    }
  });
  return box;
}

const BODY = "tw:py-2 tw:px-3 tw:border-t tw:border-border-default";

/** The box's body holding only `text`, muted. */
const muted = (doc: Document, text: string) =>
  el(doc, "div", BODY, el(doc, "p", "tw:m-0 tw:text-fg-muted", text));

/** The roster read's progress: not asked for, under way, failed, or landed. */
type Roster = "unread" | "loading" | "failed" | readonly TeamMember[];

/**
 * The members `read` lists, collapsed past `FULL_COUNT`, and for such a team a search toggle for
 * the header. Showing all or searching reads `readRoster` once, unless `read` lists everyone.
 */
function memberList(
  doc: Document,
  owner: CodeOwner,
  read: TeamMembers,
  readRoster: TeamReads["roster"],
): { body: HTMLElement; toggle?: HTMLElement } {
  const listed: readonly TeamMember[] = read.members.map((login) => ({ login }));
  // A team with a search reads its roster for display names, even when `listed` holds everyone.
  let roster: Roster = read.total <= FULL_COUNT ? listed : "unread";
  let expanded = read.total <= FULL_COUNT;
  let searching = false;
  // Logins whose rows the unsearched list has shown, so a row enters only on its first showing,
  // and those whose entrance is still running, so a re-render keeps it going.
  const rows: RowsShown = { seen: new Set(), entering: new Set() };

  const known = () => (typeof roster === "string" ? listed : roster);
  const list = el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:grid tw:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] tw:gap-x-4 tw:gap-y-1",
  );
  const noMatch = el(doc, "p", "tw:m-0 tw:text-fg-muted");
  noMatch.setAttribute("role", "status");
  const search = memberSearch(doc, owner);
  const body = el(doc, "div", BODY, search.box, list, noMatch);
  list.addEventListener("animationend", ({ target }) => {
    const login = target instanceof Element ? loginOf(target) : undefined;
    if (login) rows.entering.delete(login);
  });

  const loadRoster = () => {
    if (roster !== "unread") return;
    roster = "loading";
    void readRoster().then((answer) => {
      roster = answer ?? "failed";
      render({ enter: true });
    });
  };

  const showAll = el(
    doc,
    "button",
    "gh-prism-show-all tw:h-6 tw:p-0 tw:[font:inherit] tw:leading-6 tw:[border:0] tw:[background:none] tw:text-left tw:text-[color:var(--fgColor-accent)] tw:cursor-pointer tw:hover:underline tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:rounded-[4px]",
    "Show all members",
  );
  showAll.type = "button";
  showAll.addEventListener("click", () => {
    expanded = true;
    loadRoster();
    render({ enter: true });
    list.children[COLLAPSED_COUNT]?.querySelector("a")?.focus();
  });

  const items = (): HTMLElement[] => {
    const query = search.input.value.trim().toLowerCase();
    if (query)
      return known()
        .filter((member) => matches(member, query))
        .map(row);
    if (!expanded)
      return [...known().slice(0, COLLAPSED_COUNT).map(row), el(doc, "li", "", showAll)];
    const rest = read.total - known().length;
    if (roster === "loading" && rest > 0)
      return [...known().map(row), held(doc, `Loading ${rest} more members…`)];
    if (roster !== "loading" && rest > 0 && owner.url)
      return [
        ...known().map(row),
        el(doc, "li", "", newTabLink(doc, `See all ${read.total} members`, owner.url)),
      ];
    return known().map(row);
  };
  const row = ({ login, name }: TeamMember) => memberIdentity(doc, login, name);

  /** Redraws the list; given `enter`, the unsearched list's rows not shown before enter. */
  const render = ({ enter = false } = {}) => {
    const active = list.contains(doc.activeElement) ? doc.activeElement : null;
    const focused = active?.closest("li.gh-prism-member a")?.getAttribute("href");
    const onShowAll = active === showAll;
    const shown = items();
    list.replaceChildren(...shown);
    const query = search.input.value.trim();
    if (!query) markEntering(shown, rows, enter);
    noMatch.textContent = query && shown.length === 0 ? `No members match “${query}”.` : "";
    noMatch.hidden = noMatch.textContent === "";
    list.hidden = !noMatch.hidden;
    search.status(statusOf(roster, listed.length));
    // A re-render replaces the rows; focus follows its member, or stays on Show all.
    if (focused) list.querySelector<HTMLElement>(`a[href="${CSS.escape(focused)}"]`)?.focus();
    else if (onShowAll && showAll.isConnected) showAll.focus();
  };

  search.input.addEventListener("input", () => render());
  search.input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || search.input.value === "") return;
    // Ahead of the dialog's own Escape, which would close it.
    event.preventDefault();
    event.stopPropagation();
    search.input.value = "";
    render();
  });

  render();
  if (read.total <= FULL_COUNT) return { body };

  const toggle = searchToggle(doc, owner, search.input.id);
  toggle.addEventListener("click", () => {
    searching = !searching;
    toggle.setAttribute("aria-expanded", String(searching));
    search.box.hidden = !searching;
    search.input.value = "";
    if (searching) loadRoster();
    render();
    if (searching) search.input.focus();
  });
  return { body, toggle };
}

/** The logins the unsearched list has shown, and those whose rows are still entering. */
interface RowsShown {
  readonly seen: Set<string>;
  readonly entering: Set<string>;
}

/**
 * Records each of `rows`' members as seen, marking to enter those still entering and, given
 * `enter`, those not seen before.
 */
function markEntering(rows: readonly HTMLElement[], shown: RowsShown, enter: boolean): void {
  for (const row of rows) {
    const login = loginOf(row);
    if (!login) continue;
    if (enter && !shown.seen.has(login)) shown.entering.add(login);
    if (shown.entering.has(login)) row.classList.add("gh-prism-member-enter");
    shown.seen.add(login);
  }
}

const loginOf = (row: Element) =>
  row.closest("li")?.querySelector(".gh-prism-member-login")?.textContent ?? undefined;

/** How far a roster read got, as the search's status line says it. */
type SearchStatus = { kind: "idle" } | { kind: "loading" } | { kind: "failed"; listed: number };

const statusOf = (roster: Roster, listed: number): SearchStatus =>
  roster === "loading"
    ? { kind: "loading" }
    : roster === "failed"
      ? { kind: "failed", listed }
      : { kind: "idle" };

/** Whether `member`'s login or display name contains `query`, already lowercased. */
const matches = ({ login, name }: TeamMember, query: string) =>
  login.toLowerCase().includes(query) || (name?.toLowerCase().includes(query) ?? false);

/** A muted row reading `text` once `LOADING_DELAY_MS` passes, so a fast read never flashes it. */
function held(doc: Document, text: string): HTMLElement {
  const item = el(doc, "li", "gh-prism-members-status tw:leading-6 tw:text-fg-muted");
  setTimeout(() => (item.textContent = text), LOADING_DELAY_MS);
  return item;
}

/**
 * Primer's small TextInput filtering `owner`'s members, hidden until its toggle shows it, over a
 * muted line saying how far the roster read got.
 */
function memberSearch(
  doc: Document,
  owner: CodeOwner,
): {
  box: HTMLElement;
  input: HTMLInputElement;
  status: (state: SearchStatus) => void;
} {
  const input = el(
    doc,
    "input",
    "tw:block tw:w-full tw:box-border tw:h-[var(--control-small-size,28px)] tw:px-2 tw:border tw:border-solid tw:border-[var(--control-borderColor-rest)] tw:rounded-medium tw:bg-[var(--bgColor-default)] tw:text-fg-default tw:text-body-small tw:focus:outline-2 tw:focus:outline-[var(--focus-outlineColor)] tw:focus:-outline-offset-1",
  );
  // type="text", not "search": the browser would clear a search field on Escape itself.
  input.type = "text";
  // A dialog holds each team once, so its token makes a unique id.
  input.id = `gh-prism-member-search-${owner.token.slice(1).replace(/[^\w-]/g, "-")}`;
  input.placeholder = "Filter members";
  input.setAttribute("aria-label", `Filter members of ${owner.token.slice(1)}`);
  input.autocomplete = "off";

  const line = el(doc, "p", "tw:m-0 tw:mt-1 tw:text-body-small tw:text-fg-muted");
  line.setAttribute("role", "status");
  line.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const status = (state: SearchStatus) => {
    clearTimeout(timer);
    line.textContent = "";
    line.hidden = state.kind === "idle";
    if (state.kind === "loading")
      timer = setTimeout(() => (line.textContent = "Loading members…"), LOADING_DELAY_MS);
    else if (state.kind === "failed")
      line.textContent = `Couldn't read every member's name. Showing matches among the first ${state.listed}.`;
  };

  const box = el(doc, "div", "tw:mb-2", input, line);
  box.hidden = true;
  return { box, input, status };
}

/** Primer's small invisible IconButton showing and hiding `owner`'s member search, `controls`. */
function searchToggle(doc: Document, owner: CodeOwner, controls: string): HTMLButtonElement {
  const toggle = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-6 tw:ml-1 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:hover:text-fg-default tw:aria-expanded:bg-[var(--control-transparent-bgColor-selected)] tw:aria-expanded:text-fg-default tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, SEARCH_ICON, {}),
  );
  toggle.type = "button";
  const name = `Filter members of ${owner.token.slice(1)}`;
  toggle.setAttribute("aria-label", name);
  toggle.dataset.tooltip = name;
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", controls);
  return toggle;
}

/** `text` linking to `url` in a new tab, with no opener. */
function newTabLink(doc: Document, text: string, url: string): HTMLAnchorElement {
  const link = el(
    doc,
    "a",
    "tw:inline-flex tw:items-center tw:min-h-6 tw:text-[color:var(--fgColor-accent)]",
    text,
  );
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
