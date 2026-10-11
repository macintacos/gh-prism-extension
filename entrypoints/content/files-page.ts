/**
 * Locates a pull request's Files changed markup, follows it across navigation, and reveals a
 * diff line in it. Selectors come from EXC-1662's survey of GitHub's PR UI; this module holds
 * no UI of its own and imports nothing from WXT, so other features can reuse it.
 */

import type { PrRef } from "@/utils/pr-ref";

const FILES_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/([^/]*).*)?$/;
const DEBOUNCE_MS = 50;
const POLL_MS = 100;
// Long enough for popstate's ~200 ms early fire and a slow cold render.
const SETTLE_POLLS = 10_000 / POLL_MS;
// ponytail: one fixed 5 s wait per step; make it adaptive if slow networks miss it.
const REVEAL_TIMEOUT_MS = 5_000;
const HIDDEN_PATCH = '[class*="HiddenDiffPatch-module"]';
const LOAD_DIFF_LABEL = "Load Diff";

/** The pull request a Files changed URL names, and whether a commit or range narrows it. */
export interface FilesRoute {
  readonly pr: PrRef;
  /** The URL names one commit or a range: `/changes/<sha>` or `/changes/<base>..<head>`. */
  readonly commitFiltered: boolean;
}

/**
 * The pull request and commit filter a Files changed `pathname` names, or `undefined` off
 * that tab.
 */
export function readFilesRoute(pathname: string): FilesRoute | undefined {
  const [, owner, repo, prNumber, filter] = FILES_PATH.exec(pathname) ?? [];
  if (owner === undefined || repo === undefined || prNumber === undefined) return undefined;
  return { pr: { owner, repo, number: Number(prNumber) }, commitFiltered: Boolean(filter) };
}

/** Whether `pathname` is a pull request's Files changed tab, any commit or range included. */
export function isFilesPath(pathname: string): boolean {
  return readFilesRoute(pathname) !== undefined;
}

/** A pull request's Files changed markup, as `findFilesPage` finds it. */
export interface FilesPage {
  /** `#pr-file-tree`: the filter box, the native tree, and anything inserted beside it. */
  readonly sidebar: Element;
  /**
   * The native `ul[role=tree]`, captured with the page: an insertion anchor only. Read rows
   * through `readChangedFiles(sidebar)`, which sees the live tree.
   */
  readonly tree: Element;
  /** `[data-testid="diff-content"]`: parent of the progressive or virtualized diff list. */
  readonly diffs: Element;
}

/** The Files changed markup in `root`, or `undefined` when any part is missing (e.g. classic). */
export function findFilesPage(root: ParentNode): FilesPage | undefined {
  const sidebar = root.querySelector("#pr-file-tree");
  const tree = sidebar?.querySelector('ul[role="tree"]');
  const diffs = root.querySelector('[data-testid="diff-content"]');
  return sidebar && tree && diffs ? { sidebar, tree, diffs } : undefined;
}

/** The lines-changed counter in the pull request's header, or `undefined` when it's missing. */
export function findDiffstat(root: ParentNode): Element | undefined {
  return (
    root.querySelector('[class*="PullRequestHeader-module__rightContentWrapper"] > .d-flex') ??
    undefined
  );
}

function sameMarkup(a: FilesPage, b: FilesPage): boolean {
  return a.sidebar === b.sidebar && a.diffs === b.diffs;
}

/**
 * A file row in the native tree. Its nodes are GitHub's live, React-owned elements: clone
 * them, never move or mutate them.
 */
export interface ChangedFile {
  /** The full repository path. */
  readonly path: string;
  /** The native row's link; `.click()` scrolls to the file's diff. */
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
  const id = link.getAttribute("href")?.slice(1);
  if (!id) return null;
  const diff = diffs.ownerDocument.getElementById(id);
  return diff && diffs.contains(diff) ? diff : null;
}

/**
 * Scrolls the file's diff to `line`, centred. Mounts, expands or loads the diff first when GitHub
 * has not rendered that far, and falls back to the file's header when no row carries the line.
 * `link` is the native tree row's link, whose click mounts the diff; `line` is a 1-based
 * head-file line. Never rejects; once `signal` aborts, it neither clicks nor scrolls again.
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
  const row = () => lineRow(diff(), line);
  if (!diff()) {
    link.click(); // GitHub mounts a virtualized diff and scrolls to its header
    if (!(await untilFound(diffs, diff, signal))) return;
  }
  if (!row() && expandDiff(diff())) await untilFound(diffs, () => uncollapsed(diff()), signal);
  if (signal.aborted) return;
  let target = row();
  if (!target && loadDiff(diff())) target = await untilFound(diffs, row, signal);
  if (signal.aborted) return;
  if (target) target.scrollIntoView({ block: "center" });
  else link.click(); // the file's header
}

/** The hunk header's row when it carries `line`'s anchor, else the line's own row. */
function lineRow(diff: Element | null, line: number): HTMLTableRowElement | null {
  if (!diff) return null;
  return diff.querySelector(`[data-line-anchor="${diff.id}R${line}"]`)?.closest("tr") ?? null;
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
  const button = [...buttons].find((b) => b.textContent?.trim() === LOAD_DIFF_LABEL);
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

export interface FilesPageHandlers {
  /**
   * A Files changed page is on screen at `route`; `signal` aborts when it is replaced, removed,
   * or left. A new pathname under the same markup is a new page; a hash change is not.
   */
  onPage(page: FilesPage, route: FilesRoute, signal: AbortSignal): void;
  /**
   * The Files changed tab's markup never appeared. Fires at most once for each
   * `watchFilesPages` call.
   */
  onMissing(): void;
}

/**
 * Calls `onPage` for each Files changed page in `win`, on first load and on GitHub's own
 * `soft-nav:end` (fired once the new page has rendered) and `popstate`, until `signal` aborts.
 * Each trigger polls for the markup over a settle window, since `popstate` fires before the
 * DOM swap. Not WXT's location-change event: it fires at navigation start, before GitHub
 * renders, and on every hash change a file click makes.
 */
export function watchFilesPages(
  win: Window,
  handlers: FilesPageHandlers,
  signal: AbortSignal,
): void {
  let shown: { page: FilesPage; pathname: string; controller: AbortController } | undefined;
  let timer: number | undefined;
  let missingReported = false;

  const drop = () => {
    shown?.controller.abort();
    shown = undefined;
  };

  const sync = () => {
    const { pathname } = win.location;
    const route = readFilesRoute(pathname);
    if (!route) return drop();
    const page = findFilesPage(win.document);
    if (page && shown && sameMarkup(page, shown.page) && shown.pathname === pathname) return;
    drop();
    if (!page) return;
    shown = { page, pathname, controller: new AbortController() };
    handlers.onPage(page, route, shown.controller.signal);
  };

  const poll = (pollsLeft: number) => {
    sync();
    if (pollsLeft > 0) {
      timer = win.setTimeout(() => poll(pollsLeft - 1), POLL_MS);
    } else if (!shown && !missingReported && isFilesPath(win.location.pathname)) {
      missingReported = true;
      handlers.onMissing();
    }
  };

  const settle = () => {
    win.clearTimeout(timer);
    poll(SETTLE_POLLS);
  };

  win.document.addEventListener("soft-nav:end", settle, { signal });
  win.addEventListener("popstate", settle, { signal });
  signal.addEventListener("abort", () => {
    win.clearTimeout(timer);
    drop();
  });
  settle();
}
