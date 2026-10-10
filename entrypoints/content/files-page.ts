/**
 * Locates a pull request's Files changed markup and follows it across navigation. Selectors
 * come from EXC-1662's survey of GitHub's PR UI; this module holds no UI of its own.
 */

const FILES_PATH = /^\/[^/]+\/[^/]+\/pull\/\d+\/(changes|files)(\/|$)/;
const DEBOUNCE_MS = 50;
const POLL_MS = 100;
// A 10 s window: covers popstate firing ~200 ms before the DOM swap, and a slow cold render.
const SETTLE_POLLS = 100;

/** Whether `pathname` is a pull request's Files changed tab, any commit or range included. */
export function isFilesPath(pathname: string): boolean {
  return FILES_PATH.test(pathname);
}

export interface FilesPage {
  /** `#pr-file-tree`: the filter box, the native tree, and anything inserted beside it. */
  readonly sidebar: Element;
  /** The native `ul[role=tree]`. */
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

export interface ChangedFile {
  /** The full repository path. */
  readonly path: string;
  /** The native row's link; `.click()` scrolls to the file's diff. */
  readonly link: HTMLAnchorElement;
  /** The native row's accessible label, e.g. "engine.rs has 1 comment". */
  readonly label: string;
  readonly active: boolean;
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

/**
 * Calls `onChange` once `DEBOUNCE_MS` after the last mutation in `target`'s subtree (rows,
 * `aria-current`, `aria-label`), ignoring mutations inside `ignore`, until `signal` aborts.
 */
export function observe(
  target: Node,
  onChange: () => void,
  signal: AbortSignal,
  ignore?: Node,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((records) => {
    if (records.every((r) => ignore?.contains(r.target))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });
  observer.observe(target, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-current", "aria-label"],
  });
  signal.addEventListener("abort", () => {
    observer.disconnect();
    clearTimeout(timer);
  });
}

export interface FilesPageHandlers {
  /** A Files changed page is on screen; `signal` aborts when it is replaced or left. */
  onPage(page: FilesPage, signal: AbortSignal): void;
  /** The Files changed tab's markup never appeared. */
  onMissing(): void;
}

/**
 * Shows each Files changed page in `win` (first load, `soft-nav:end`, `popstate`) until
 * `signal` aborts. Each trigger polls for the markup over a settle window, since `popstate`
 * fires before the DOM swap.
 */
export function watchFilesPages(
  win: Window,
  handlers: FilesPageHandlers,
  signal: AbortSignal,
): void {
  let shown: { sidebar: Element; controller: AbortController } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const drop = () => {
    shown?.controller.abort();
    shown = undefined;
  };

  const sync = () => {
    if (!isFilesPath(win.location.pathname)) return drop();
    const page = findFilesPage(win.document);
    if (!page || page.sidebar === shown?.sidebar) return;
    drop();
    shown = { sidebar: page.sidebar, controller: new AbortController() };
    handlers.onPage(page, shown.controller.signal);
  };

  const poll = (left: number) => {
    sync();
    if (left > 0) {
      timer = setTimeout(() => poll(left - 1), POLL_MS);
    } else if (!shown && isFilesPath(win.location.pathname)) {
      handlers.onMissing();
    }
  };

  const settle = () => {
    clearTimeout(timer);
    poll(SETTLE_POLLS);
  };

  win.document.addEventListener("soft-nav:end", settle, { signal });
  win.addEventListener("popstate", settle, { signal });
  signal.addEventListener("abort", () => {
    clearTimeout(timer);
    drop();
  });
  settle();
}
