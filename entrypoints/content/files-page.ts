/**
 * Locates a pull request's Files changed markup and follows it across navigation. Selectors
 * come from EXC-1662's survey of GitHub's PR UI; this module holds no UI of its own and
 * imports nothing from WXT, so other features can reuse it.
 */

const FILES_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/(changes|files)(\/|$)/;
const DEBOUNCE_MS = 50;
const POLL_MS = 100;
// Long enough for popstate's ~200 ms early fire and a slow cold render.
const SETTLE_POLLS = 10_000 / POLL_MS;

/** Whether `pathname` is a pull request's Files changed tab, any commit or range included. */
export function isFilesPath(pathname: string): boolean {
  return FILES_PATH.test(pathname);
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
  /** The native row's accessible label, e.g. "engine.rs has 1 comment". */
  readonly label: string;
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
        label: row.getAttribute("aria-label") ?? "",
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
 * Calls `onChange` 50 ms after a diff mounts or unmounts anywhere under `diffs`, until `signal`
 * aborts. Attribute changes inside a diff do not count: diff internals churn them constantly.
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

export interface FilesPageHandlers {
  /** A Files changed page is on screen; `signal` aborts when it is replaced, removed, or left. */
  onPage(page: FilesPage, signal: AbortSignal): void;
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
  let shown: { page: FilesPage; controller: AbortController } | undefined;
  let timer: number | undefined;
  let missingReported = false;

  const drop = () => {
    shown?.controller.abort();
    shown = undefined;
  };

  const sync = () => {
    if (!isFilesPath(win.location.pathname)) return drop();
    const page = findFilesPage(win.document);
    if (page && shown && sameMarkup(page, shown.page)) return;
    drop();
    if (!page) return;
    shown = { page, controller: new AbortController() };
    handlers.onPage(page, shown.controller.signal);
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
