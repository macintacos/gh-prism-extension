/**
 * The one script module that holds selectors into GitHub's Files view markup; the stylesheets list
 * theirs in a `GitHub hooks:` header. It holds a `PageKind` for a pull request's page and a
 * commit's, finds a Files view's page, a pull request's classic page, or its header on its header
 * tabs, reads its rows, and follows a pull request's narrow-layout overlay; it holds no UI and
 * imports nothing from WXT. The pull request selectors come from EXC-1662's survey.
 */

/**
 * Where one kind of page, a pull request's or a commit's, keeps its Files changed markup. Callers
 * ask the page module's helpers rather than branching on a kind: a new kind is a new adapter, not
 * a new branch in each caller.
 */
export interface PageKind {
  /** Selects `FilesPage.sidebar`. */
  readonly sidebar: string;
  /**
   * Selects the narrow layout's overlay copy of `sidebar` while it is open; a kind without one
   * shows its own sidebar there.
   */
  readonly overlay?: string;
  /** Selects `FilesPage.diffs`. */
  readonly diffs: string;
  /** The header's slot for its lines-changed counter, which holds a skeleton while it loads. */
  readonly diffstatSlot: string;
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
  /** The anchor a diff region names its file by, or `undefined`. */
  readonly anchorOfDiff: (diff: Element) => string | undefined;
  /** How a row's link reveals its diff: a click GitHub scrolls for, or a hash GitHub follows. */
  readonly reveal: "click" | "hash";
}

// A diff list's entry holds its file's diff; nothing else in the list does.
const HOLDS_DIFF = ':has([role="region"])';

const PR_DIFF_LIST = '[data-testid="progressive-diffs-list"]';

/** Where a pull request's Files changed tab keeps its markup. */
export const prPage = {
  sidebar: "#pr-file-tree",
  overlay: '[role="dialog"] #pr-file-tree',
  diffs: '[data-testid="diff-content"]',
  diffstatSlot: '[class*="rightContentWrapper__"]',
  treeToggle: '[class*="RegularTreeToggle"]',
  treeToggleButton: '[class*="RegularTreeToggle"]',
  diffList: PR_DIFF_LIST,
  diffEntries: `${PR_DIFF_LIST} > ${HOLDS_DIFF}`,
  diffEntry: (anchor) => `${PR_DIFF_LIST} > :has(#${anchor})`,
  listLayout: "flex",
  diffOf: (diffs, anchor) => diffs.ownerDocument.getElementById(anchor),
  anchorOfDiff: (diff) => diff.id || undefined,
  reveal: "click",
} satisfies PageKind;

// A commit's list while its diffs are in flow; a virtualized commit nests each diff a level deeper.
const COMMIT_DIFF_LIST = '#diff-content-parent > :has(> * > [role="region"])';

/** Where a single commit's page keeps its changed files' markup. */
export const commitPage = {
  sidebar: "#diff_file_tree",
  diffs: "#diff-content-parent",
  diffstatSlot: '[class*="commitFilesChangedContainer__"]',
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
  anchorOfDiff: (diff) => diff.querySelector('a[href^="#diff-"]')?.getAttribute("href")?.slice(1),
  // A click would also navigate GitHub's router, whose scroll restoration can undo the scroll to
  // the file, since a commit's diffs have no ids.
  reveal: "hash",
} satisfies PageKind;

/** Every page kind, in the order `findFilesPage` tries them. */
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

/** A native tree and the sidebar holding it: a page's own, or the narrow layout's overlay copy. */
export type NativeTree = Pick<FilesPage, "sidebar" | "tree">;

/** The Files changed markup in `root`, or `undefined` when any part is missing (e.g. classic). */
export function findFilesPage(root: ParentNode): FilesPage | undefined {
  for (const kind of PAGE_KINDS) {
    // The overlay's portal precedes the page, and its copy of the sidebar shares the docked id.
    const sidebar = [...root.querySelectorAll(kind.sidebar)].find(
      (el) => !kind.overlay || !el.matches(kind.overlay),
    );
    const tree = sidebar?.querySelector('ul[role="tree"]');
    const diffs = root.querySelector(kind.diffs);
    if (sidebar && tree && diffs) return { kind, sidebar, tree, diffs };
  }
  return undefined;
}

/** The narrow layout's overlay copy of `page`'s tree while it is open, else `undefined`. */
export function findOverlay(page: FilesPage): NativeTree | undefined {
  if (!page.kind.overlay) return undefined;
  const sidebar = page.sidebar.ownerDocument.querySelector(page.kind.overlay);
  const tree = sidebar?.querySelector('ul[role="tree"]');
  return sidebar && tree ? { sidebar, tree } : undefined;
}

/**
 * Calls `onOpen` with each overlay copy of `page`'s tree as it mounts (and one already open),
 * with a signal that aborts once it unmounts or is replaced, until `signal` aborts. Undebounced:
 * it reports in the mutation's microtask, so the sections replace GitHub's tree before the
 * overlay first paints.
 */
export function followOverlay(
  page: FilesPage,
  onOpen: (overlay: NativeTree, closed: AbortSignal) => void,
  { signal }: { signal: AbortSignal },
): void {
  if (!page.kind.overlay) return;
  let shown: NativeTree | undefined;
  let closed: AbortController | undefined;
  const reportIfChanged = () => {
    const overlay = findOverlay(page);
    if (overlay?.sidebar === shown?.sidebar && overlay?.tree === shown?.tree) return;
    closed?.abort();
    shown = overlay;
    closed = overlay && new AbortController();
    if (overlay && closed) onOpen(overlay, closed.signal);
  };

  // ponytail: one querySelector per mutation batch on the whole document; observe only the portal
  // root if it shows up in a profile.
  const observer = new MutationObserver(reportIfChanged);
  observer.observe(page.sidebar.ownerDocument.body, { childList: true, subtree: true });
  signal.addEventListener("abort", () => {
    observer.disconnect();
    closed?.abort();
  });
  reportIfChanged();
}

/** A pull request's classic Files changed page, which gh-prism leaves alone. */
export interface ClassicPage {
  /** GitHub's toolbar above the diffs. */
  readonly toolbar: Element;
  /** The toolbar's trailing group, which holds the review controls when signed in. */
  readonly reviewTools: Element;
}

/** The classic Files changed markup in `root`, or `undefined` when any part is missing. */
export function findClassicPage(root: ParentNode): ClassicPage | undefined {
  const toolbar = root.querySelector("#files_bucket .pr-toolbar");
  const reviewTools = toolbar?.querySelector(".pr-review-tools");
  return toolbar && reviewTools ? { toolbar, reviewTools } : undefined;
}

/** Whether GitHub served `doc` to a signed-in viewer: it names the viewer's login. */
export const isSignedIn = (doc: Document): boolean =>
  Boolean(doc.head.querySelector('meta[name="user-login"]')?.getAttribute("content"));

/** Whether `doc` shows `repo` as public; false when private, internal, or unconfirmed. */
export function isPublicRepo(doc: Document, repo: { owner: string; repo: string }): boolean {
  const meta = (name: string) =>
    doc.head
      .querySelector(`meta[name="octolytics-dimension-repository_${name}"]`)
      ?.getAttribute("content");
  return (
    meta("public") === "true" &&
    meta("nwo")?.toLowerCase() === `${repo.owner}/${repo.repo}`.toLowerCase()
  );
}

// Both of GitHub's virtualized lists index each row they place.
const VIRTUALIZED = '[data-index] [role="region"]';

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

/** Where a page's diffstat sits: its document and the selector for the header's counter slot. */
export interface Header {
  readonly doc: Document;
  /** Selects the header's slot for its lines-changed counter. */
  readonly diffstatSlot: string;
}

/** `page`'s header, for the diffstat to stand in on. */
export const headerOf = (page: FilesPage): Header => ({
  doc: page.sidebar.ownerDocument,
  diffstatSlot: page.kind.diffstatSlot,
});

/** A pull request's header on one of its header tabs. */
export interface HeaderPage extends Header {
  /** The header's slot for its counter; GitHub replacing it makes a new page. */
  readonly slot: Element;
}

/** The pull request header in `doc`, or `undefined` while its counter's slot is missing. */
export function findHeaderPage(doc: Document): HeaderPage | undefined {
  const slot = doc.querySelector(prPage.diffstatSlot);
  return slot ? { doc, diffstatSlot: prPage.diffstatSlot, slot } : undefined;
}

const findDiffstatSlot = ({ doc, diffstatSlot }: Header): Element | null =>
  doc.querySelector(diffstatSlot);

/** The lines-changed counter in the header, or `undefined` while it's missing. */
export function findDiffstat(header: Header): Element | undefined {
  return findDiffstatSlot(header)?.querySelector(":scope > .d-flex") ?? undefined;
}

/**
 * Calls `onChange` when the counter's slot gains or loses a child, as when GitHub's counter
 * replaces its skeleton, until `signal` aborts.
 */
export function observeDiffstat(
  header: Header,
  onChange: () => void,
  { signal }: { signal: AbortSignal },
): void {
  const slot = findDiffstatSlot(header);
  if (!slot) return;
  const observer = new MutationObserver(onChange);
  observer.observe(slot, { childList: true });
  signal.addEventListener("abort", () => observer.disconnect());
}

/**
 * The toolbar's file-tree toggle: the wrapper around the buttons that collapse and expand the
 * tree, or `undefined` when it's missing.
 */
export function findTreeToggle(page: FilesPage): Element | undefined {
  return page.sidebar.ownerDocument.querySelector(page.kind.treeToggle)?.parentElement ?? undefined;
}

/**
 * The filter row's child holding GitHub's filter-options button, or `undefined` when it's missing.
 */
export const findFilterOptions = (page: FilesPage): Element | undefined =>
  page.sidebar
    .querySelector('#diff-file-tree-filter button[aria-haspopup="true"]')
    ?.closest("#diff-file-tree-filter > *") ?? undefined;

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

const DEBOUNCE_MS = 50;

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

const TREE_ATTRIBUTES = ["aria-current", "aria-label"];

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

/** Whether `anchor` takes the form of GitHub's anchor for a file's diff. */
export const isDiffAnchor = (anchor: string): boolean => /^diff-[0-9a-f]+$/.test(anchor);

/** The `diff-…` anchor `link` points at: it names the file's diff and prefixes its line anchors. */
export const anchorOf = (link: HTMLAnchorElement): string | undefined =>
  link.getAttribute("href")?.slice(1);

/**
 * The diff anchor of the file whose route-data `pathDigest` is `pathDigest`: its region's id and
 * its tree link's hash.
 */
export const anchorOfDigest = (pathDigest: string): string => `diff-${pathDigest}`;

/**
 * `page`'s mounted diff regions, keyed by their files' anchors. Regions whose anchor is not a
 * file's diff anchor, such as a line anchor, are left out.
 */
export function mountedDiffs(page: FilesPage): Map<string, Element> {
  const regions = page.diffs.querySelectorAll('[role="region"]');
  return new Map(
    [...regions].flatMap((region) => {
      const anchor = page.kind.anchorOfDiff(region);
      return anchor && isDiffAnchor(anchor) ? [[anchor, region] as const] : [];
    }),
  );
}

// `__` keeps `diffHeaderWrapperWithMiniHeaderAndToolbar__` out.
const STICKY_HEADER = '[role="region"] > [class*="diffHeaderWrapper__"]';

/**
 * The px band GitHub's sticky chrome covers at the top of the viewport: the `top` GitHub sticks
 * each file header at, or 0 with no header mounted.
 */
export function coveredTop(page: FilesPage): number {
  const header = page.diffs.querySelector(STICKY_HEADER);
  if (!header) return 0;
  return parseFloat(getComputedStyle(header).top) || 0;
}

/**
 * Calls `onChange` on a window resize or a change to `doc.body`'s `style`, where GitHub writes
 * `--base-sticky-header-height`, until `signal` aborts.
 */
export function observeCoveredTop(
  doc: Document,
  onChange: () => void,
  { signal }: { signal: AbortSignal },
): void {
  doc.defaultView?.addEventListener("resize", onChange, { signal });
  const observer = new MutationObserver(onChange);
  observer.observe(doc.body, { attributes: true, attributeFilter: ["style"] });
  signal.addEventListener("abort", () => observer.disconnect());
}

// aria-label reads "Viewed" or "Not Viewed"; other header buttons carry aria-pressed too.
const VIEWED_TOGGLE = '[class*="diff-file-header__"] button[aria-pressed][aria-label$="Viewed"]';
const VIEWED_COUNTER = '[class*="file-controls__"] [class*="ProgressContainer__"]';

/**
 * Each mounted diff's Viewed state as its header's toggle shows it, by file anchor; diffs without
 * a toggle are left out.
 */
export function readViewed(page: FilesPage): Map<string, boolean> {
  return new Map(
    [...mountedDiffs(page)].flatMap(([anchor, region]) => {
      const toggle = region.querySelector(VIEWED_TOGGLE);
      return toggle ? [[anchor, showsViewed(toggle)] as const] : [];
    }),
  );
}

/** Whether a Viewed toggle shows its file viewed. */
export const showsViewed = (toggle: Element): boolean =>
  toggle.getAttribute("aria-pressed") === "true";

/**
 * The Viewed toggle in `link`'s file's mounted header, or `null` while the diff is unmounted or
 * the page offers no Viewed. An unloaded diff's header keeps its toggle.
 */
export const viewedToggleOf = (
  page: FilesPage,
  link: HTMLAnchorElement,
): HTMLButtonElement | null =>
  findDiff(page, link)?.querySelector<HTMLButtonElement>(VIEWED_TOGGLE) ?? null;

/**
 * Whether the page offers Viewed: GitHub's "N / M viewed" counter, or any header's toggle, is
 * present.
 */
export const viewedOffered = (page: FilesPage): boolean =>
  page.sidebar.ownerDocument.querySelector(VIEWED_COUNTER) !== null ||
  page.diffs.querySelector(VIEWED_TOGGLE) !== null;

/**
 * Calls `onChange` when a header's Viewed toggle flips under `diffs`, until `signal` aborts; no
 * other attribute change, and no mount, counts.
 */
export function observeViewed(
  diffs: Node,
  onChange: () => void,
  { signal }: { signal: AbortSignal },
): void {
  const observer = new MutationObserver((records) => {
    if (records.some(({ target }) => target instanceof Element && target.matches(VIEWED_TOGGLE)))
      onChange();
  });
  observer.observe(diffs, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  signal.addEventListener("abort", () => observer.disconnect());
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

// A pull request's placeholder says "Load Diff"; a commit's says "Load diff".
const LOAD_DIFF_LABEL = "load diff";

/** The Load Diff button of an unloaded diff's placeholder, else `null`. */
export function loadDiffButtonOf(diff: Element | null): HTMLButtonElement | null {
  const buttons = diff?.querySelectorAll("button") ?? [];
  return [...buttons].find((b) => b.textContent?.trim().toLowerCase() === LOAD_DIFF_LABEL) ?? null;
}
