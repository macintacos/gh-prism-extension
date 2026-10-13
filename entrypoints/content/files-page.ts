/**
 * The one script module that holds selectors into GitHub's Files view markup; the stylesheets list
 * theirs in a `GitHub hooks:` header. It holds a `PageKind` for a pull request's page and a
 * commit's, finds a Files view's page, and reads its rows; it holds no UI and imports nothing from
 * WXT. The pull request selectors come from EXC-1662's survey.
 */

const DEBOUNCE_MS = 50;
const HIDDEN_PATCH = '[class*="HiddenDiffPatch-module"]';
// A pull request's placeholder says "Load Diff"; a commit's says "Load diff".
const LOAD_DIFF_LABEL = "load diff";

/**
 * Where one kind of page, a pull request's or a commit's, keeps its Files changed markup. Callers
 * ask the page module's helpers rather than branching on a kind: a new kind is a new adapter, not
 * a new branch in each caller.
 */
export interface PageKind {
  /** Selects `FilesPage.sidebar`. */
  readonly sidebar: string;
  /** Selects `FilesPage.diffs`. */
  readonly diffs: string;
  /** The header's lines-changed counter. */
  readonly diffstat: string;
  /** A toolbar tree-toggle button; its parent wraps the toggle's buttons. */
  readonly treeToggle: string;
  /** The toggle buttons that collapse the tree in place, not the narrow layout's overlay toggle. */
  readonly treeToggleButton: string;
  /** The list in `diffs` that holds each file's entry. */
  readonly diffList: string;
  /** Every file's entry in `diffList`. */
  readonly diffEntries: string;
  /**
   * CSS selecting the entry of the file whose anchor is `anchor`; used only for a block list's
   * first file.
   */
  readonly diffEntry: (anchor: string) => string;
  /**
   * How GitHub lays out `diffList`: a flex column, or a block that opens on a toolbar and spaces
   * each entry by its place in GitHub's order.
   */
  readonly listLayout: "flex" | "block";
  /**
   * What follows the files inside the diff list, ahead of which a cover goes: a commit's
   * comments.
   */
  readonly afterDiffs?: string;
  /** The diff for `anchor`, or `null`; it may lie outside `diffs`, which `findDiff` rules out. */
  readonly diffOf: (diffs: Element, anchor: string) => Element | null;
  /** How a row's link reveals its diff: a click GitHub scrolls for, or a hash GitHub follows. */
  readonly reveal: "click" | "hash";
}

// A diff list's entry holds its file's diff; nothing else in the list does.
const HOLDS_DIFF = ':has([role="region"])';

const PR_DIFF_LIST = '[data-testid="progressive-diffs-list"]';

export const prPage = {
  sidebar: "#pr-file-tree",
  diffs: '[data-testid="diff-content"]',
  diffstat: '[class*="rightContentWrapper__"] > .d-flex',
  treeToggle: '[class*="RegularTreeToggle"]',
  treeToggleButton: '[class*="RegularTreeToggle"]',
  diffList: PR_DIFF_LIST,
  diffEntries: `${PR_DIFF_LIST} > ${HOLDS_DIFF}`,
  diffEntry: (anchor) => `${PR_DIFF_LIST} > :has(#${anchor})`,
  listLayout: "flex",
  diffOf: (diffs, anchor) => diffs.ownerDocument.getElementById(anchor),
  reveal: "click",
} satisfies PageKind;

// A commit's list while its diffs are in flow; a virtualized commit nests each diff a level deeper.
const COMMIT_DIFF_LIST = '#diff-content-parent > :has(> * > [role="region"])';

export const commitPage = {
  sidebar: "#diff_file_tree",
  diffs: "#diff-content-parent",
  diffstat: '[class*="commitFilesChangedContainer__"] > .d-flex',
  // A commit's sidebar carries a copy of the toolbar for the narrow layout.
  treeToggle: '#diff-content-parent [aria-controls="diff_file_tree"]',
  // `.d-md-none` marks the narrow layout's overlay toggle.
  treeToggleButton: '[aria-controls="diff_file_tree"]:not(.d-md-none)',
  diffList: COMMIT_DIFF_LIST,
  diffEntries: `${COMMIT_DIFF_LIST} > ${HOLDS_DIFF}`,
  diffEntry: (anchor) => `${COMMIT_DIFF_LIST} > :has(a[href="#${anchor}"])`,
  listLayout: "block",
  afterDiffs: ":scope > #comments",
  // A commit's diff has no id; its header links to the file's anchor instead.
  diffOf: (diffs, anchor) =>
    diffs.querySelector(`[role="region"] a[href="#${anchor}"]`)?.closest('[role="region"]') ?? null,
  // A click would also navigate GitHub's router, whose scroll restoration can undo the scroll to
  // the file, since a commit's diffs have no ids.
  reveal: "hash",
} satisfies PageKind;

// Both of GitHub's virtualized lists index each row they place.
const VIRTUALIZED = '[data-index] [role="region"]';

export const PAGE_KINDS: readonly PageKind[] = [prPage, commitPage];

/** What follows the files in `kind`'s diff list, such as GitHub's loader for more of them. */
export const afterEntries = (kind: PageKind): string => `${kind.diffEntries} ~ :not(${HOLDS_DIFF})`;

/** A pull request's or commit's Files changed markup, as `findFilesPage` finds it. */
export interface FilesPage {
  /** The adapter whose selectors found this page. */
  readonly kind: PageKind;
  /** The filter box, the native tree, and anything inserted beside it. */
  readonly sidebar: Element;
  /**
   * The native `ul[role=tree]`, captured with the page: an insertion anchor only. Read rows
   * through `readChangedFiles(sidebar)`, which sees the live tree. GitHub replacing it makes a
   * new page: React can re-render the sidebar's contents in place, dropping what sits beside it.
   */
  readonly tree: Element;
  /** Parent of the progressive or virtualized diff list. */
  readonly diffs: Element;
}

/** The Files changed markup in `root`, or `undefined` when any part is missing (e.g. classic). */
export function findFilesPage(root: ParentNode): FilesPage | undefined {
  for (const kind of PAGE_KINDS) {
    const sidebar = root.querySelector(kind.sidebar);
    const tree = sidebar?.querySelector('ul[role="tree"]');
    const diffs = root.querySelector(kind.diffs);
    if (sidebar && tree && diffs) return { kind, sidebar, tree, diffs };
  }
  return undefined;
}

/** Whether `anchor` takes the form of GitHub's anchor for a file's diff. */
export const isDiffAnchor = (anchor: string): boolean => /^diff-[0-9a-f]+$/.test(anchor);

/**
 * Whether GitHub lays `page`'s diffs out in a way their order can follow; false while
 * virtualized.
 */
export const reorderable = (page: FilesPage): boolean =>
  page.diffs.querySelector(VIRTUALIZED) === null;

/** Adds `node` to the end of `page`'s diff list, ahead of anything that follows the files. */
export function appendToDiffs(page: FilesPage, node: Element): void {
  const afterFiles = page.kind.afterDiffs && page.diffs.querySelector(page.kind.afterDiffs);
  if (afterFiles) afterFiles.before(node);
  else page.diffs.append(node);
}

/** The lines-changed counter in the page's header, or `undefined` when it's missing. */
export function findDiffstat(page: FilesPage): Element | undefined {
  return page.sidebar.ownerDocument.querySelector(page.kind.diffstat) ?? undefined;
}

/**
 * The toolbar's file-tree toggle: the wrapper around the buttons that collapse and expand the
 * tree, or `undefined` when it's missing.
 */
export function findTreeToggle(page: FilesPage): Element | undefined {
  return page.sidebar.ownerDocument.querySelector(page.kind.treeToggle)?.parentElement ?? undefined;
}

/** The tree-toggle button `target` sits in, when it collapses the tree in place. */
export const treeToggleButtonOf = (page: FilesPage, target: Element): HTMLElement | null =>
  target.closest<HTMLElement>(page.kind.treeToggleButton);

/** The Primer pane divider `target` sits in, or `null`. */
export const dragHandleOf = (target: Element): Element | null =>
  target.closest('[data-component="PageLayout.DragHandle"]');

/** The Primer start pane wrapper `handle` sits in, or `null`. */
export const startPaneOf = (handle: Element): Element | null =>
  handle.closest('[class*="PageLayout-PaneWrapper"][data-position="start"]');

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
  /**
   * What the change did to the file, as the row's first octicon shows it; `undefined` for an
   * octicon it doesn't map.
   */
  readonly status: FileStatus | undefined;
  /** The comment icon and count, when the file has comments. */
  readonly comments: Element | null;
}

/**
 * What a change did to a file: a subset of @pierre/trees' GitStatus, which the sections tree takes
 * as is.
 */
export type FileStatus = "added" | "deleted" | "renamed" | "modified";

const STATUS_BY_OCTICON: ReadonlyMap<string, FileStatus> = new Map([
  ["octicon-file-added", "added"],
  ["octicon-file-removed", "deleted"],
  ["octicon-file-moved", "renamed"],
  ["octicon-file-diff", "modified"],
]);

const statusOf = (icon: Element | null): FileStatus | undefined =>
  [...STATUS_BY_OCTICON].find(([octicon]) => icon?.classList.contains(octicon))?.[1];

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
        status: statusOf(row.querySelector("svg.octicon")),
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
 * The mounted diff for `link`'s file under the page's diff list, or `null` while virtualization
 * has it unmounted.
 */
export function findDiff(page: FilesPage, link: HTMLAnchorElement): Element | null {
  const id = anchorOf(link);
  if (!id) return null;
  const diff = page.kind.diffOf(page.diffs, id);
  return diff && page.diffs.contains(diff) ? diff : null;
}

/** `page`'s diff list, or `null` while it has none. */
export const findDiffList = (page: FilesPage): Element | null =>
  page.diffs.querySelector(page.kind.diffList);

/**
 * The child of `list` that holds `anchor`'s diff: the diff's parent, when that is one of `list`'s
 * children; `null` otherwise, so markup GitHub has reshaped keeps GitHub's order.
 */
export function diffEntryOf(page: FilesPage, list: Element, anchor: string): HTMLElement | null {
  const entry = page.kind.diffOf(page.diffs, anchor)?.parentElement;
  return entry instanceof HTMLElement && entry.parentElement === list ? entry : null;
}

/** The `diff-…` anchor `link` points at: it names the file's diff and prefixes its line anchors. */
const anchorOf = (link: HTMLAnchorElement) => link.getAttribute("href")?.slice(1);

/** The hunk header's row when it carries `line`'s anchor, else the line's own row. */
export function lineRowOf(
  diff: Element | null,
  link: HTMLAnchorElement,
  line: number,
): HTMLTableRowElement | null {
  const anchor = anchorOf(link);
  if (!diff || !anchor) return null;
  return diff.querySelector(`[data-line-anchor="${anchor}R${line}"]`)?.closest("tr") ?? null;
}

/** The header's first button when the diff is collapsed to its header alone, else `null`. */
export function expandButtonOf(diff: Element | null): HTMLButtonElement | null {
  if (diff?.children.length !== 1) return null;
  const button = diff.firstElementChild?.querySelector("button");
  // The toggle has no aria-expanded: its chevron-right marks a collapsed diff.
  return button?.querySelector(".octicon-chevron-right") ? button : null;
}

/** `diff` once it shows more than its header, else `null`. */
export function expandedDiff(diff: Element | null): Element | null {
  return diff && diff.children.length > 1 ? diff : null;
}

/** The Load Diff button of an unloaded diff's placeholder, else `null`. */
export function loadDiffButtonOf(diff: Element | null): HTMLButtonElement | null {
  const buttons = diff?.querySelector(HIDDEN_PATCH)?.querySelectorAll("button") ?? [];
  return [...buttons].find((b) => b.textContent?.trim().toLowerCase() === LOAD_DIFF_LABEL) ?? null;
}
