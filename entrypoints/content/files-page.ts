/**
 * Locates the Files changed markup of a pull request or a single commit, follows it across
 * navigation, and reveals a diff line in it. GitHub renders the same tree and diff list on both
 * pages under different ids, so everything built on `FilesPage` serves both. Selectors come from
 * EXC-1662's survey of GitHub's PR UI; this module holds no UI of its own and imports nothing
 * from WXT, so other features can reuse it.
 */

import type { DiffRef } from "@/utils/pr-ref";

const PR_SIDEBAR = "#pr-file-tree";
const COMMIT_SIDEBAR = "#diff_file_tree";
const FILES_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/([^/]*).*)?$/;
const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})\/?$/;
const DEBOUNCE_MS = 50;
// Long enough for popstate's ~200 ms early fire and a slow cold render.
const SETTLE_MS = 10_000;
// ponytail: one fixed 5 s wait per step; make it adaptive if slow networks miss it.
const REVEAL_TIMEOUT_MS = 5_000;
const HIDDEN_PATCH = '[class*="HiddenDiffPatch-module"]';
// A pull request's placeholder says "Load Diff"; a commit's says "Load diff".
const LOAD_DIFF_LABEL = "load diff";
// A longer trip jumps to this share of the viewport short of its end, then glides the rest.
const GLIDE_VIEWPORTS = 0.5;

/** The diff a Files changed URL names, and whether a commit or range narrows a pull request's. */
export interface FilesRoute {
  readonly diff: DiffRef;
  /**
   * A pull request's URL narrows it to one commit or a range: `/changes/<sha>` or
   * `/changes/<base>..<head>`.
   */
  readonly commitFiltered: boolean;
}

/**
 * The pull request and commit filter a Files changed `pathname` names, or the single commit a
 * commit page names; `undefined` anywhere else.
 */
export function readFilesRoute(pathname: string): FilesRoute | undefined {
  const [, owner, repo, prNumber, filter] = FILES_PATH.exec(pathname) ?? [];
  if (owner !== undefined && repo !== undefined && prNumber !== undefined)
    return { diff: { owner, repo, number: Number(prNumber) }, commitFiltered: Boolean(filter) };
  const [, commitOwner, commitRepo, headSha] = COMMIT_PATH.exec(pathname) ?? [];
  if (commitOwner === undefined || commitRepo === undefined || headSha === undefined)
    return undefined;
  return { diff: { owner: commitOwner, repo: commitRepo, headSha }, commitFiltered: false };
}

/**
 * Whether `pathname` is a pull request's Files changed tab, any commit or range included, or a
 * commit page.
 */
export function isFilesPath(pathname: string): boolean {
  return readFilesRoute(pathname) !== undefined;
}

/** A pull request's or commit's Files changed markup, as `findFilesPage` finds it. */
export interface FilesPage {
  /**
   * `#pr-file-tree` or a commit's `#diff_file_tree`: the filter box, the native tree, and anything
   * inserted beside it.
   */
  readonly sidebar: Element;
  /**
   * The native `ul[role=tree]`, captured with the page: an insertion anchor only. Read rows
   * through `readChangedFiles(sidebar)`, which sees the live tree. GitHub replacing it makes a
   * new page: React can re-render the sidebar's contents in place, dropping what sits beside it.
   */
  readonly tree: Element;
  /**
   * `[data-testid="diff-content"]`, or a commit's `#diff-content-parent`: parent of the
   * progressive or virtualized diff list.
   */
  readonly diffs: Element;
}

/** The Files changed markup in `root`, or `undefined` when any part is missing (e.g. classic). */
export function findFilesPage(root: ParentNode): FilesPage | undefined {
  const sidebar = root.querySelector(PR_SIDEBAR) ?? root.querySelector(COMMIT_SIDEBAR);
  const tree = sidebar?.querySelector('ul[role="tree"]');
  const diffs =
    root.querySelector('[data-testid="diff-content"]') ??
    root.querySelector("#diff-content-parent");
  return sidebar && tree && diffs ? { sidebar, tree, diffs } : undefined;
}

/**
 * The lines-changed counter in the pull request's or commit's header, or `undefined` when it's
 * missing.
 */
export function findDiffstat(root: ParentNode): Element | undefined {
  return (
    root.querySelector(
      ':is([class*="PullRequestHeader-module__rightContentWrapper"], [class*="CommitHeader-module__commitFilesChangedContainer"]) > .d-flex',
    ) ?? undefined
  );
}

/**
 * The toolbar's file-tree toggle: the wrapper around the buttons that collapse and expand the
 * tree, or `undefined` when it's missing.
 */
export function findTreeToggle(root: ParentNode): Element | undefined {
  const toggle =
    root.querySelector('[class*="RegularTreeToggle"]') ??
    // A commit's sidebar carries a copy of the toolbar for the narrow layout.
    root.querySelector('#diff-content-parent [aria-controls="diff_file_tree"]');
  return toggle?.parentElement ?? undefined;
}

/**
 * A file row in the native tree. Its nodes are GitHub's live, React-owned elements: clone
 * them, never move or mutate them.
 */
export interface ChangedFile {
  /** The full repository path. */
  readonly path: string;
  /** The native row's link; `revealDiff` scrolls to the file's diff through it. */
  readonly link: HTMLAnchorElement;
  /** The row is `aria-current`: its diff is the one in view. */
  readonly active: boolean;
  /** The row's first octicon: added, modified, moved, and so on. */
  readonly statusIcon: Element | null;
  /** The comment icon and count, when the file has comments. */
  readonly comments: Element | null;
}

/**
 * The files the native tree under `sidebar` currently shows, in its order. Filtering and
 * collapsed directories remove rows from the DOM, so hidden files are absent.
 */
export function readChangedFiles(sidebar: ParentNode): ChangedFile[] {
  // Scoped to the tree: the filter-options button also carries aria-expanded.
  const rows = sidebar.querySelectorAll('ul[role="tree"] [role="treeitem"]:not([aria-expanded])');
  return [...rows].flatMap((row) => {
    const link = row.querySelector('a[href^="#diff-"]');
    if (!(link instanceof HTMLAnchorElement)) return [];
    return [
      {
        path: row.id,
        link,
        active: row.getAttribute("aria-current") === "true",
        statusIcon: row.querySelector("svg.octicon"),
        comments: row.querySelector(".octicon-comment")?.parentElement ?? null,
      },
    ];
  });
}

const TREE_ATTRIBUTES = ["aria-current", "aria-label"];

interface ObserveOptions {
  readonly signal: AbortSignal;
  /** Mutations whose target sits inside `ignore` do not count. */
  readonly ignore?: Node;
}

/** Calls `onChange` 50 ms after the last mutation `init` observes under `target`. */
function observeDebounced(
  target: Node,
  init: MutationObserverInit,
  onChange: () => void,
  { signal, ignore }: ObserveOptions,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((records) => {
    if (records.every((r) => ignore?.contains(r.target))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
  observer.observe(target, init);
  signal.addEventListener("abort", () => {
    observer.disconnect();
    clearTimeout(timer);
  });
}

/**
 * Calls `onChange` 50 ms after the last child-list change under `target`, or change to
 * `aria-current` or `aria-label` there, until `signal` aborts.
 */
export function observeTree(
  target: Node,
  onChange: () => void,
  { signal, ignore }: ObserveOptions,
): void {
  observeDebounced(
    target,
    { childList: true, subtree: true, attributes: true, attributeFilter: TREE_ATTRIBUTES },
    onChange,
    { signal, ignore },
  );
}

/**
 * Calls `onChange` 50 ms after any child-list change under `diffs` (a diff mounting or unmounting,
 * or rows arriving in one), until `signal` aborts. Attribute changes inside a diff do not count:
 * diff internals churn them constantly.
 */
export function observeDiffs(
  diffs: Node,
  onChange: () => void,
  { signal }: { signal: AbortSignal },
): void {
  observeDebounced(diffs, { childList: true, subtree: true }, onChange, { signal });
}

/**
 * The mounted diff for `link`'s file under `diffs`, or `null` while virtualization has it
 * unmounted.
 */
export function findDiff(diffs: Element, link: HTMLAnchorElement): Element | null {
  const id = anchorOf(link);
  if (!id) return null;
  // A commit's diff has no id; its header links to the file's anchor instead.
  const diff =
    diffs.ownerDocument.getElementById(id) ??
    diffs.querySelector(`[role="region"] a[href="#${id}"]`)?.closest('[role="region"]');
  return diff && diffs.contains(diff) ? diff : null;
}

/** The `diff-…` anchor `link` points at: it names the file's diff and prefixes its line anchors. */
const anchorOf = (link: HTMLAnchorElement) => link.getAttribute("href")?.slice(1);

/**
 * Clicks `link`, the native tree row's link, and glides the window to where GitHub scrolls the
 * file's diff instead of letting it jump there; on a commit page, follows the link's hash instead.
 * Once `signal` aborts, it no longer glides.
 */
export function revealDiff(link: HTMLAnchorElement, { signal }: { signal: AbortSignal }): void {
  if (link.closest(COMMIT_SIDEBAR)) {
    followHash(link, signal);
    return;
  }
  const win = link.ownerDocument.defaultView;
  const from = win?.scrollY ?? 0;
  link.click();
  if (!win || signal.aborted) return;
  // GitHub scrolls in an animation frame its click handler requests; this one runs right after
  // it, before the jump is painted.
  const frame = win.requestAnimationFrame(() => glideFrom(win, from));
  signal.addEventListener("abort", () => win.cancelAnimationFrame(frame), { once: true });
}

/**
 * Moves a commit page to `link`'s file the way GitHub's own code does: it replaces the URL's hash
 * and announces it, and GitHub glides to the file and marks it current. A click would also
 * navigate GitHub's router, whose scroll restoration can undo that scroll, since a commit's diffs
 * have no ids. GitHub ignores an unchanged hash, so a current file is first announced as left.
 */
function followHash(link: HTMLAnchorElement, signal: AbortSignal): void {
  const win = link.ownerDocument.defaultView;
  const hash = link.getAttribute("href");
  if (!win || !hash || signal.aborted) return;
  if (win.location.hash !== hash) replaceHash(win, hash);
  else retakeHash(win, { signal });
}

/**
 * Has GitHub take `win`'s URL hash as if it had just arrived, scrolling to what it names. GitHub
 * ignores an unchanged hash, so the hash is first announced as left. Once `signal` aborts, it no
 * longer announces the hash's return.
 */
export function retakeHash(win: Window, { signal }: { signal: AbortSignal }): void {
  const hash = win.location.hash;
  if (!hash || signal.aborted) return;
  replaceHash(win, "");
  const timer = win.setTimeout(() => replaceHash(win, hash));
  signal.addEventListener("abort", () => win.clearTimeout(timer), { once: true });
}

function replaceHash(win: Window, hash: string): void {
  const oldURL = win.location.href;
  const url = new URL(oldURL);
  url.hash = hash;
  win.history.replaceState(win.history.state, "", url);
  win.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
}

/** Turns the window's jump from `from` to where it is now into a glide over the last stretch. */
function glideFrom(win: Window, from: number): void {
  if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = win.scrollY;
  const reach = win.innerHeight * GLIDE_VIEWPORTS;
  win.scrollTo({ top: Math.min(Math.max(from, to - reach), to + reach), behavior: "instant" });
  win.scrollTo({ top: to, behavior: "smooth" });
}

/**
 * Glides the file's diff to `line`, centred. Mounts, expands or loads the diff first when GitHub
 * has not rendered that far, and falls back to the file's header when no row carries the line.
 * `link` is the native tree row's link, through which `revealDiff` mounts the diff; `line` is a
 * 1-based head-file line. Never rejects; once `signal` aborts, it neither clicks nor scrolls
 * again.
 */
export async function revealDiffLine(
  diffs: Element,
  link: HTMLAnchorElement,
  line: number,
  { signal }: { signal: AbortSignal },
): Promise<void> {
  if (signal.aborted) return;
  // Re-found each time: GitHub may replace a region when it expands or loads it.
  const diff = () => findDiff(diffs, link);
  const row = () => lineRow(diff(), anchorOf(link), line);
  if (!diff()) {
    revealDiff(link, { signal }); // GitHub mounts a virtualized diff and scrolls to its header
    if (!(await untilFound(diffs, diff, signal))) return;
  }
  if (!row() && expandDiff(diff())) await untilFound(diffs, () => uncollapsed(diff()), signal);
  if (signal.aborted) return;
  let target = row();
  if (!target && loadDiff(diff())) target = await untilFound(diffs, row, signal);
  if (signal.aborted) return;
  if (target) centre(target);
  else revealDiff(link, { signal }); // the file's header
}

function centre(row: Element): void {
  const win = row.ownerDocument.defaultView;
  const from = win?.scrollY ?? 0;
  row.scrollIntoView({ block: "center", behavior: "instant" });
  if (win) glideFrom(win, from);
}

/** The hunk header's row when it carries `line`'s anchor, else the line's own row. */
function lineRow(
  diff: Element | null,
  anchor: string | undefined,
  line: number,
): HTMLTableRowElement | null {
  if (!diff || !anchor) return null;
  return diff.querySelector(`[data-line-anchor="${anchor}R${line}"]`)?.closest("tr") ?? null;
}

/**
 * Clicks the header's first button when the diff is collapsed to its header alone; returns
 * whether it clicked.
 */
function expandDiff(diff: Element | null): boolean {
  if (diff?.children.length !== 1) return false;
  const button = diff.firstElementChild?.querySelector("button");
  // The toggle has no aria-expanded: its chevron-right marks a collapsed diff.
  if (!button?.querySelector(".octicon-chevron-right")) return false;
  button.click();
  return true;
}

function uncollapsed(diff: Element | null): Element | null {
  return diff && diff.children.length > 1 ? diff : null;
}

/** Clicks the Load Diff button of an unloaded diff's placeholder; returns whether it clicked. */
function loadDiff(diff: Element | null): boolean {
  const buttons = diff?.querySelector(HIDDEN_PATCH)?.querySelectorAll("button") ?? [];
  const button = [...buttons].find((b) => b.textContent?.trim().toLowerCase() === LOAD_DIFF_LABEL);
  if (!button) return false;
  button.click();
  return true;
}

/**
 * Resolves with `find()` once it is non-null, checked now and after each debounced mutation
 * under `diffs`. Resolves with `find()`'s value at `REVEAL_TIMEOUT_MS`, or with `null` once
 * `signal` aborts.
 */
function untilFound<T>(
  diffs: Element,
  find: () => T | null,
  signal: AbortSignal,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const watching = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (found: T | null) => {
      watching.abort(); // ends the observer, its debounce timer, and the abort listener
      clearTimeout(timer);
      resolve(found);
    };
    const check = () => {
      const found = find();
      if (found !== null) finish(found);
    };
    signal.addEventListener("abort", () => finish(null), { signal: watching.signal });
    timer = setTimeout(() => finish(find()), REVEAL_TIMEOUT_MS);
    observeDiffs(diffs, check, { signal: watching.signal });
    check();
  });
}

/** What to do with each Files changed markup GitHub renders during one visit. */
export type OnPage = (page: FilesPage, signal: AbortSignal) => void;

export interface FilesPageHandlers {
  /**
   * The Files changed tab's markup first appeared at `route`; `signal` aborts once the pathname
   * changes or leaves the tab. A hash change is not a new visit. Returns the handler for that
   * markup and each replacement GitHub renders during the visit, whose `signal` aborts once it is
   * replaced or removed.
   */
  onVisit(route: FilesRoute, signal: AbortSignal): OnPage;
  /**
   * The Files changed tab's markup never appeared. Fires at most once for each
   * `watchFilesPages` call.
   */
  onMissing(): void;
}

const isShowing = ({ sidebar, tree, diffs }: FilesPage) =>
  sidebar.isConnected && tree.isConnected && diffs.isConnected;

/**
 * Calls `onVisit` for each visit to a Files changed tab in `win`, on first load and on GitHub's
 * own `soft-nav:end` (fired once the new page has rendered) and `popstate`, until `signal`
 * aborts. Each trigger follows the markup over a settle window, since `popstate` fires before the
 * DOM swap and GitHub may re-render the markup while the page loads; a mutation observer hands
 * over a replacement before it is painted. Not WXT's location-change event: it fires at navigation
 * start, before GitHub renders, and on every hash change a file click makes.
 */
export function watchFilesPages(
  win: Window,
  handlers: FilesPageHandlers,
  signal: AbortSignal,
): void {
  let visit: { pathname: string; onPage: OnPage; controller: AbortController } | undefined;
  let shown: { page: FilesPage; controller: AbortController } | undefined;
  let timer: number | undefined;
  let missingReported = false;

  const drop = () => {
    shown?.controller.abort();
    shown = undefined;
  };

  const leave = () => {
    drop();
    visit?.controller.abort();
    visit = undefined;
  };

  const sync = () => {
    const { pathname } = win.location;
    if (visit && visit.pathname !== pathname) leave();
    if (shown && isShowing(shown.page)) return;
    const route = readFilesRoute(pathname);
    const page = route && findFilesPage(win.document);
    drop();
    if (!route || !page) return;
    if (!visit) {
      const controller = new AbortController();
      visit = { pathname, controller, onPage: handlers.onVisit(route, controller.signal) };
    }
    shown = { page, controller: new AbortController() };
    visit.onPage(page, shown.controller.signal);
  };

  const observer = new MutationObserver(sync);

  const settle = () => {
    win.clearTimeout(timer);
    sync();
    observer.observe(win.document, { childList: true, subtree: true });
    timer = win.setTimeout(() => {
      observer.disconnect();
      if (!shown && !missingReported && isFilesPath(win.location.pathname)) {
        missingReported = true;
        handlers.onMissing();
      }
    }, SETTLE_MS);
  };

  win.document.addEventListener("soft-nav:end", settle, { signal });
  win.addEventListener("popstate", settle, { signal });
  signal.addEventListener("abort", () => {
    win.clearTimeout(timer);
    observer.disconnect();
    leave();
  });
  settle();
}
