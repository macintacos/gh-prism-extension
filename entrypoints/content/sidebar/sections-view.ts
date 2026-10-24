/**
 * Mirrors GitHub's Files changed tree as sections, each a file tree of its own. The native tree
 * stays mounted but hidden as the source of truth, or the narrow layout's overlay copy of it while
 * that is open: each render re-reads it, and file clicks go to its row's link, whose handler mounts
 * a virtualized diff that a bare hash jump would not. A file whose hunks span sections is listed,
 * marked Partial, in each; clicking it there reveals the first of that section's hunks. Docs &
 * Comments ends with a sub-section listing Implementation's files again by their comment lines.
 */

import type { FileTreeRowDecoration } from "@pierre/trees";
import type { LineCounts } from "@/utils/github/pr-diff";
import {
  type CommentLines,
  commentLinesOf,
  landingOf,
  revealLineOf,
  totalsOf,
} from "@/utils/intent/landing";
import type { IntentResult, PathOnlyReason } from "@/utils/intent/read";
import { SECTIONS, type SectionKey } from "@/utils/sections";
import { revealDiff, revealDiffLine, revealUntil } from "../diffs/reveal";
import { markViewed } from "../diffs/viewed";
import {
  type FilesPage,
  type NativeTree,
  readChangedFiles,
  reorderable,
  viewedToggleOf,
} from "../files-page";
import { el, icon } from "../ui/dom";
import { lineTotals } from "../ui/line-counts";
import { type LoadingView, loadingView } from "../ui/loading-view";
import { markSection, SECTION_CATALOG, sectionIcon } from "../ui/section-catalog";
import type { FileSection, LandingView } from "../visit/land";
import { SectionTree, type TreeFile } from "./section-tree";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./sections-view.css?inline";

type FileEntry = FileSection["entries"][number];

/** Docs & Comments' sub-section listing Implementation's files by their comment lines. */
const COMMENT_LINES = "comment-lines";

/** What lists files under a header of its own: a section, or the comment-lines sub-section. */
type ListingKey = SectionKey | typeof COMMENT_LINES;

interface Listing {
  readonly key: ListingKey;
  readonly entries: readonly FileEntry[];
}

/** The sidebar's sections view, as `showSections` mounts it. */
interface SectionsView extends LandingView {
  /** The view's `<nav>`. */
  readonly root: Element;
  /** Marks the files whose diffs are on screen: their hairline piece (a top-level file's row edge), or a collapsed listing's header. */
  onScreen(paths: ReadonlySet<string>): void;
  /**
   * Called whenever the viewed set changes, from the moment the page offers Viewed: dims the rows
   * of the files GitHub shows as Viewed, gives every file row a checkbox, and, once any file is
   * viewed, counts each listing's viewed files in its header.
   */
  viewed(paths: ReadonlySet<string>): void;
}

interface ShownListing {
  readonly root: HTMLElement;
  readonly counter: HTMLElement;
  readonly host: HTMLElement;
  readonly tree: SectionTree;
}

interface BuildOptions {
  readonly order: number;
  readonly previous: Element | null;
  readonly files: readonly TreeFile[];
  readonly active: string | undefined;
}

const FIXED_ORDER_COPY = "Diffs keep GitHub's order: gh-prism can't reorder this many files.";

const PATH_ONLY_COPY: Record<PathOnlyReason, string> = {
  "commit-filtered":
    "Grouped by path. Docstring-only and inline-test changes are detected when viewing all commits.",
  "no-access":
    "Grouped by path. Sign in to GitHub to detect docstring-only and inline-test changes.",
  "rate-limited":
    "Grouped by path. GitHub is rate-limiting requests; reload to detect docstring-only and inline-test changes.",
  "too-large":
    "Grouped by path. This diff is too large to check for docstring-only and inline-test changes.",
  failed:
    "Grouped by path. The diff didn't load; reload to detect docstring-only and inline-test changes.",
};

/**
 * The notices above the sections once intent lands as `result`: why they follow paths alone, then
 * why the diffs keep GitHub's order.
 */
function noticesOf(result: IntentResult, canReorder: boolean): string[] {
  return [
    ...(result.ok ? [] : [PATH_ONLY_COPY[result.problem]]),
    ...(canReorder ? [] : [FIXED_ORDER_COPY]),
  ];
}

const ADDED = "var(--fgColor-success)";
const REMOVED = "var(--fgColor-danger)";
const UNCHANGED = "var(--fgColor-muted)";
// section-tree.css styles these parts by the custom property each color names.
const MARKER = "var(--gh-prism-marker-fg)";
const COMMENTS = "var(--gh-prism-comment-fg)";

/**
 * A row's comment count, Partial or Binary marker, and lines added and removed, as known. Partial
 * marks a row whose lines are only some of its file's. Its title, which the row's accessible name
 * ends with, says each in words.
 */
function decorationOf({ file, share, lines, moved }: FileEntry): FileTreeRowDecoration | undefined {
  const parts: { text: string; color: string }[] = [];
  const phrases: string[] = [];

  const comments = file.comments?.textContent?.trim();
  if (comments) {
    parts.push({ text: comments, color: COMMENTS });
    phrases.push(`${comments} comment${comments === "1" ? "" : "s"}`);
  }

  const partial = share !== undefined || moved !== undefined;
  if (partial) {
    parts.push({ text: "Partial", color: MARKER });
    phrases.push("Partial: other sections hold the rest");
  }

  if (lines === "binary") {
    parts.push({ text: "Binary", color: MARKER });
    phrases.push("Binary file: no line counts");
  } else if (lines && lines.added + lines.removed > 0) {
    const { added, removed } = lines;
    parts.push(
      { text: `+${added}`, color: added > 0 ? ADDED : UNCHANGED },
      { text: `−${removed}`, color: removed > 0 ? REMOVED : UNCHANGED },
    );
    phrases.push(`${added} added, ${removed} removed${partial ? " in this section" : ""}`);
  }

  if (parts.length === 0) return undefined;
  return { text: parts.map(({ text }) => text).join(" "), title: phrases.join(". "), parts };
}

const treeFilesOf = ({ entries }: Listing): TreeFile[] =>
  entries.map((entry) => ({
    path: entry.file.path,
    status: entry.file.status,
    decoration: decorationOf(entry),
  }));

/** Lucide chevron-down (ISC licence). */
export const chevron = (doc: Document): SVGSVGElement =>
  icon(doc, "m6 9 6 6 6-6", {
    class: "gh-prism-chevron",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });

/** A header's file count, as a pill. */
const counterPill = (doc: Document) =>
  el(
    doc,
    "span",
    "gh-prism-counter tw:shrink-0 tw:min-w-5 tw:py-0 tw:px-1.5 tw:rounded-[2em] tw:bg-[var(--counter-bgColor-muted)] tw:text-fg-default tw:text-body-small tw:font-medium tw:leading-body-small tw:text-center",
  );

/**
 * A section, `order` places from the top, whose header button shows and hides an empty host for
 * its tree. `expand` sets which it does. The button leads with the section's icon, which the
 * stylesheet swaps for the chevron while it is hovered or focused, and ends with the `lines` it
 * adds and removes, if known.
 */
function sectionShell(
  doc: Document,
  key: SectionKey,
  { order, lines }: { order: number; lines: LineCounts | undefined },
) {
  const counter = counterPill(doc);
  const glyph = el(
    doc,
    "span",
    "gh-prism-glyph tw:grid tw:shrink-0 tw:text-[color:var(--gh-prism-hue)]",
    sectionIcon(doc, key),
    chevron(doc),
  );
  const name = el(doc, "span", "gh-prism-section-label tw:truncate", SECTION_CATALOG[key].label);
  const toggle = el(
    doc,
    "button",
    "gh-prism-section-toggle tw:flex tw:items-center tw:gap-2 tw:w-full tw:h-9 tw:py-0 tw:px-3 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-default tw:[font:inherit] tw:text-start tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
    glyph,
    name,
    counter,
  );
  if (lines) toggle.append(lineTotals(doc, lines));
  toggle.type = "button";

  const header = el(
    doc,
    "h3",
    "gh-prism-section-header tw:m-0 tw:text-body-medium tw:font-semibold",
    toggle,
  );
  header.id = `gh-prism-heading-${key}`;

  const host = el(doc, "div", "gh-prism-tree");
  const files = el(doc, "div", "gh-prism-files tw:overflow-clip tw:pb-1", host);
  files.id = `gh-prism-files-${key}`;
  toggle.setAttribute("aria-controls", files.id);

  const root = el(
    doc,
    "section",
    "gh-prism-section tw:rounded-medium tw:border tw:border-hue-edge tw:bg-[var(--gh-prism-tint)] tw:shadow-[var(--shadow-resting-small)]",
    header,
    files,
  );
  root.setAttribute("aria-labelledby", header.id);
  markSection(root, key);
  root.style.setProperty("--gh-prism-order", String(order));

  const expand = (expanded: boolean) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    files.inert = !expanded;
  };
  return { root, counter, host, toggle, expand };
}

/** Octicons 19.15.0 comment (MIT, GitHub Inc.). */
const COMMENT_ICON =
  "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z";

/**
 * The comment-lines sub-section, nested under Docs & Comments' tree: a smaller header whose button
 * shows and hides an empty host for its tree, led by a comment icon that swaps for the chevron as
 * a section's does, and ending with the comment `lines` it lists, if known. `expand` sets which it
 * does.
 */
function commentLinesShell(doc: Document, lines: LineCounts | undefined) {
  const counter = counterPill(doc);
  const glyph = el(
    doc,
    "span",
    "gh-prism-glyph tw:grid tw:shrink-0 tw:text-[color:var(--gh-prism-hue)]",
    icon(doc, COMMENT_ICON, { class: "gh-prism-section-icon" }),
    chevron(doc),
  );
  const toggle = el(
    doc,
    "button",
    "gh-prism-comment-lines-toggle tw:flex tw:items-center tw:gap-2 tw:w-full tw:h-7 tw:py-0 tw:px-3 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:[font:inherit] tw:text-start tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
    glyph,
    el(doc, "span", "tw:truncate", "Implementation comments"),
    counter,
  );
  if (lines) toggle.append(lineTotals(doc, lines));
  toggle.type = "button";

  const header = el(
    doc,
    "h4",
    "gh-prism-comment-lines-header tw:m-0 tw:text-body-small tw:font-semibold",
    toggle,
  );
  header.id = `gh-prism-heading-${COMMENT_LINES}`;

  const host = el(doc, "div", "gh-prism-tree");
  const files = el(doc, "div", "gh-prism-files tw:overflow-clip", host);
  files.id = `gh-prism-files-${COMMENT_LINES}`;
  toggle.setAttribute("aria-controls", files.id);

  const root = el(doc, "div", "gh-prism-comment-lines", header, files);
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", header.id);

  const expand = (expanded: boolean) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    files.inert = !expanded;
  };
  return { root, counter, host, toggle, expand };
}

/**
 * The comment-lines sub-section's listing among `sections`, while the landing has `commentLines`:
 * Implementation's entries whose comment lines moved, each counting only those, and so Partial.
 */
function commentLinesListing(
  sections: readonly FileSection[],
  commentLines: CommentLines | undefined,
): Listing[] {
  if (!commentLines) return [];
  const implementation = sections.find(({ key }) => key === "implementation")?.entries ?? [];
  const entries = implementation.flatMap((entry) =>
    entry.moved ? [{ ...entry, lines: entry.moved }] : [],
  );
  return [{ key: COMMENT_LINES, entries }];
}

/**
 * Writes the file count of `entries` into a listing header's `counter`, or, once `viewed` holds
 * any path, how many of them are viewed, as `N/M` with the words for screen readers. An empty
 * `viewed` (nothing viewed yet, or a page that offers no Viewed) keeps the bare count. Leaves the
 * DOM alone when unchanged.
 */
function showCount(
  counter: HTMLElement,
  entries: readonly FileEntry[],
  viewed: ReadonlySet<string>,
): void {
  const total = entries.length;
  if (viewed.size === 0) {
    if (counter.textContent !== String(total)) counter.textContent = String(total);
    return;
  }

  const viewedHere = entries.filter(({ file }) => viewed.has(file.path)).length;
  const words = `${viewedHere} of ${total} viewed`;
  if (counter.querySelector(".sr-only")?.textContent === words) return;

  const doc = counter.ownerDocument;
  const figure = el(doc, "span", "", `${viewedHere}/${total}`);
  figure.setAttribute("aria-hidden", "true");
  counter.replaceChildren(figure, el(doc, "span", "sr-only", words));
}

/** Placeholder rows for the sidebar's file list. */
const listSkeleton = (doc: Document) =>
  el(doc, "div", "gh-prism-skeleton", ...Array.from({ length: 5 }, () => el(doc, "span", "")));

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

function isAltClick(event: MouseEvent): boolean {
  return event.button === 0 && event.altKey && !(event.metaKey || event.ctrlKey || event.shiftKey);
}

/** A file as one listing lists it. */
interface ListedFile {
  readonly listing: ListingKey;
  readonly path: string;
}

/**
 * The listing holding the innermost of `elements`: the comment-lines sub-section, which nests in
 * Docs & Comments, before the section around it.
 */
function listingOf(elements: readonly HTMLElement[]): ListingKey | undefined {
  const holder = elements.find((node) =>
    node.matches(".gh-prism-comment-lines, .gh-prism-section"),
  );
  if (holder?.classList.contains("gh-prism-comment-lines")) return COMMENT_LINES;
  return SECTIONS.find((key) => key === holder?.dataset.section);
}

/** The file row and listing a click inside a tree landed on. */
function clickedFile(event: Event): ListedFile | undefined {
  const elements = event.composedPath().filter((node) => node instanceof HTMLElement);
  const row = elements.find((node) => node.dataset.type === "item");
  const listing = listingOf(elements);
  const path = row?.dataset.itemPath;
  return row?.dataset.itemType === "file" && listing && path ? { listing, path } : undefined;
}

/** The file whose Viewed checkbox a click inside a tree landed on, and its listing. */
function clickedCheckbox(event: Event): ListedFile | undefined {
  const elements = event.composedPath().filter((node) => node instanceof HTMLElement);
  const box = elements.find((node) => node.matches("input[data-item-checkbox]"));
  const listing = listingOf(elements);
  const path = box?.dataset.itemCheckbox;
  return listing && path ? { listing, path } : undefined;
}

/**
 * Calls `onMove` whenever `view` may have moved against the viewport, until `signal` aborts: on a
 * scroll of anything holding it, a window resize, or a change in its own size.
 */
function followViewport(view: HTMLElement, onMove: () => void, signal: AbortSignal): void {
  const doc = view.ownerDocument;
  // Capture, for the sidebar's pane or the window: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    (event) => {
      if (event.target instanceof Node && event.target.contains(view)) onMove();
    },
    { capture: true, signal },
  );
  // A section or directory above a tree changing height moves where the tree has stuck.
  const resized = new ResizeObserver(onMove);
  resized.observe(view);
  doc.defaultView?.addEventListener("resize", onMove, { signal });
  signal.addEventListener("abort", () => resized.disconnect());
}

/**
 * Mounts the sidebar's sections view in `page` until `signal` aborts, and returns its hooks: a
 * progress bar while intent is pending; on landing, notices for path-only sections or diffs kept
 * in GitHub's order; then a tree per listing, each split file listed in every section its hunks
 * land in, with the lines each share adds and removes. All of it anchors below a leading
 * what's-new block when the nav holds one.
 */
export function showSections(page: FilesPage, signal: AbortSignal): SectionsView {
  const doc = page.sidebar.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const view = el(
    doc,
    "nav",
    "gh-prism-sections tw:flex tw:flex-col tw:gap-1.5 tw:text-body-medium tw:[interpolate-size:allow-keywords]",
  );
  view.setAttribute("aria-label", "Changed files by section");

  const shown = new Map<ListingKey, ShownListing>();
  // Outlives the sections themselves, so one that empties and comes back stays collapsed.
  const collapsed = new Set<ListingKey>([
    ...SECTIONS.flatMap((key) => (SECTION_CATALOG[key].startsCollapsed ? [key] : [])),
    COMMENT_LINES,
  ]);
  let loading: LoadingView | undefined;
  let landing = landingOf(undefined);
  let commentLines: CommentLines | undefined;
  // The reveal in flight. A newer file click, or the view's abort, cancels it.
  let jump: AbortController | undefined;
  let clicked: ListedFile | undefined;
  // Only a new current file scrolls the sidebar; re-renders would pull it back mid-scroll.
  let scrolledTo: string | undefined;
  let onScreen: ReadonlySet<string> = new Set();
  let viewed: ReadonlySet<string> = new Set();
  let offered = false;
  // The files whose box click is still settling; their boxes ignore clicks.
  const marking = new Set<string>();
  let latestListings: readonly Listing[] = [];

  /**
   * Marks each section that lists a file on screen; sections-view.css shows it on a collapsed
   * header. The comment-lines sub-section's files are all Implementation's, which marks them.
   */
  const markHeaders = () => {
    for (const { key, entries } of latestListings) {
      if (key === COMMENT_LINES) continue;
      const listsOnScreen = entries.some(({ file }) => onScreen.has(file.path));
      shown.get(key)?.root.toggleAttribute("data-on-screen", listsOnScreen);
    }
  };

  /** Writes each shown listing's count into its header. */
  const countHeaders = () => {
    for (const { key, entries } of latestListings) {
      const current = shown.get(key);
      if (current) showCount(current.counter, entries, viewed);
    }
  };

  let source: NativeTree = page;
  const nativeLinkOf = (path: string) =>
    readChangedFiles(source.sidebar).find((file) => file.path === path)?.link;

  const open = ({ listing, path }: ListedFile) => {
    const native = nativeLinkOf(path);
    if (!native) return;
    clicked = { listing, path };
    jump?.abort();

    // A comment-lines row stands for its whole file, never one section's share.
    const line = listing === COMMENT_LINES ? undefined : revealLineOf(landing, path, listing);
    jump = new AbortController();
    if (line === undefined) revealDiff(page, native, { signal: jump.signal });
    else void revealDiffLine(page, native, line, { signal: jump.signal });
  };

  const showMarking = () => {
    for (const { tree } of shown.values()) tree.showMarking(new Set(marking));
  };

  /**
   * Has GitHub mark `path` Viewed, or not, by clicking its header's toggle, revealing its diff
   * first when the header isn't in the page. Its boxes show pending until the page settles, and
   * their checked state never comes from the click, only from what `viewed` reads back off the
   * page.
   */
  const mark = async ({ listing, path }: ListedFile) => {
    const native = nativeLinkOf(path);
    if (signal.aborted || !native || !offered || marking.has(path)) return;
    const want = !viewed.has(path);
    clicked = { listing, path };
    jump?.abort();

    marking.add(path);
    showMarking();

    const toggle = viewedToggleOf(page, native) ?? (await revealToggle(path, native));
    if (toggle) await markViewed(page, native, want, { signal });

    if (signal.aborted) return;
    marking.delete(path);
    showMarking();
  };

  /**
   * Marks the file a click asks for, deferred past the click's dispatch: cancelling a box's click
   * restores its checkedness as the dispatch ends, which would undo a render from GitHub's
   * microtask flip. A double-click's second click is dropped, since GitHub honors a click during a
   * pending save.
   */
  const markFrom = (event: MouseEvent, file: ListedFile) => {
    if (event.detail <= 1) setTimeout(() => void mark(file));
  };

  /**
   * Reveals `native`'s diff as a row click does and resolves with its Viewed toggle, or `null` once
   * a newer click, the view's abort, or the timeout ends the wait.
   */
  const revealToggle = async (path: string, native: HTMLAnchorElement) => {
    jump = new AbortController();
    // The box's row is already in view, so the file turning current mustn't scroll the sidebar;
    // if the reveal fails, a later turn to current still should.
    const previous = scrolledTo;
    scrolledTo = path;
    const toggle = await revealUntil(page, native, () => viewedToggleOf(page, native), {
      signal: jump.signal,
    });
    if (!toggle && !signal.aborted && scrolledTo === path) scrolledTo = previous;
    return toggle;
  };

  // The comment-lines sub-section comes last, so it never moves a section, and it is built after
  // the Docs & Comments tree it nests under.
  const render = (sections: readonly FileSection[]) => {
    const listings = [...sections, ...commentLinesListing(sections, commentLines)];
    dropAllBut(listings);
    let previous =
      [...view.querySelectorAll(".gh-prism-notice")].at(-1) ??
      view.querySelector(".gh-prism-whats-new");
    for (const [order, listing] of listings.entries())
      previous = showListing(listing, order, previous);
    scrollToCurrent(listings);
    latestListings = listings;
    markHeaders();
    countHeaders();
  };

  const dropAllBut = (listings: readonly Listing[]) => {
    for (const [key, { root, tree }] of shown) {
      if (listings.some((listing) => listing.key === key)) continue;
      tree.cleanUp();
      root.remove();
      shown.delete(key);
    }
  };

  /** Updates `listing`'s tree, or builds it as listing `order` after `previous`. Returns its root. */
  const showListing = (listing: Listing, order: number, previous: Element | null) => {
    const files = treeFilesOf(listing);
    const active = listing.entries.find(({ file }) => file.active)?.file.path;
    let current = shown.get(listing.key);
    if (current) {
      current.tree.update(files, active);
    } else {
      current = buildListing(listing.key, { order, previous, files, active });
      shown.set(listing.key, current);
    }
    return current.root;
  };

  const totalOf = (section: SectionKey) =>
    totalsOf(landing).find((total) => total.section === section)?.lines;

  /**
   * Mounts listing `key`'s shell, a section's after `previous` and the comment-lines sub-section's
   * under Docs & Comments' tree, then its tree of `files` inside it.
   */
  const buildListing = (
    key: ListingKey,
    { order, previous, files, active }: BuildOptions,
  ): ShownListing => {
    // Set once: a listing is only built after intent lands, and the landed lines never change.
    const { root, counter, host, toggle, expand } =
      key === COMMENT_LINES
        ? commentLinesShell(doc, commentLines?.lines)
        : sectionShell(doc, key, { order, lines: totalOf(key) });
    expand(!collapsed.has(key));
    toggle.addEventListener("click", () => {
      const expanded = collapsed.has(key);
      if (expanded) collapsed.delete(key);
      else collapsed.add(key);
      expand(expanded);
    });

    if (key === COMMENT_LINES) shown.get("docs")?.host.after(root);
    else if (previous) previous.after(root);
    else view.prepend(root);
    const tree = new SectionTree(host, files, active);
    tree.showOnScreen(onScreen);
    if (offered) tree.showViewed(viewed);
    if (marking.size > 0) tree.showMarking(new Set(marking));
    return { root, counter, host, tree };
  };

  /** Whether `key`'s rows are out of sight; the sub-section's hide with Docs & Comments'. */
  const hidden = (key: ListingKey) =>
    collapsed.has(key) || (key === COMMENT_LINES && collapsed.has("docs"));

  // A file listed more than once, split or with comment lines, scrolls the sidebar in one listing.
  const scrollToCurrent = (listings: readonly Listing[]) => {
    const active = listings.flatMap(({ entries }) => entries).find(({ file }) => file.active)
      ?.file.path;
    if (active === undefined || active === scrolledTo) return;

    const listing = listings.filter(
      ({ key, entries }) => !hidden(key) && entries.some(({ file }) => file.path === active),
    );
    const target =
      listing.find(({ key }) => clicked?.path === active && clicked.listing === key) ?? listing[0];
    if (!target) return;

    shown.get(target.key)?.tree.scrollToRow(active);
    scrolledTo = active;
  };

  view.addEventListener(
    "click",
    (event) => {
      const box = clickedCheckbox(event);
      if (box) {
        // The box shows only what GitHub's page shows, never the click.
        event.preventDefault();
        markFrom(event, box);
        return;
      }

      const file = clickedFile(event);
      if (file && isPlainLeftClick(event)) open(file);
    },
    { signal },
  );
  // Once rows have boxes, an Alt-click on a file row does what its box's click does, and nothing
  // else. Captured ahead of the tree, which would select and focus the row; the press is
  // cancelled too, or the row takes focus anyway.
  const takesAltClick = (event: MouseEvent) => offered && isAltClick(event);
  view.addEventListener(
    "mousedown",
    (event) => {
      if (takesAltClick(event) && clickedFile(event)) event.preventDefault();
    },
    { capture: true, signal },
  );
  view.addEventListener(
    "click",
    (event) => {
      const file = takesAltClick(event) ? clickedFile(event) : undefined;
      if (!file) return;
      // Prevented too: Chrome downloads a link that is Alt-clicked.
      event.preventDefault();
      event.stopPropagation();
      markFrom(event, file);
    },
    { capture: true, signal },
  );
  followViewport(
    view,
    () => {
      for (const { tree } of shown.values()) tree.sync();
    },
    signal,
  );
  // Only the page's own scroll: the sidebar's pane scrolls to follow focus, whose folder must stay lit.
  doc.addEventListener(
    "scroll",
    (event) => {
      if (event.target !== doc) return;
      for (const { tree } of shown.values()) tree.clearPointed();
    },
    { capture: true, signal },
  );

  // A DOM clone of the sidebar, such as a restored snapshot, can carry an earlier view.
  for (const stale of page.sidebar.querySelectorAll(".gh-prism-sections")) stale.remove();
  page.tree.before(view);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    for (const { tree } of shown.values()) tree.cleanUp();
    view.remove();
    style.remove();
    jump?.abort();
  });

  return {
    root: view,
    pending() {
      loading = loadingView(doc, listSkeleton(doc));
      view.setAttribute("aria-busy", "true");
      view.append(loading.root);
    },
    progress(progress) {
      loading?.progress(progress);
    },
    landed(result) {
      landing = landingOf(result);
      commentLines = commentLinesOf(landing);
      if (loading) {
        loading.root.remove();
        loading = undefined;
        view.removeAttribute("aria-busy");
        view.toggleAttribute("data-reveal", true);
      }

      const notices = noticesOf(result, reorderable(page)).map((text) =>
        el(
          doc,
          "p",
          "gh-prism-notice tw:m-0 tw:pt-1.5 tw:px-2 tw:pb-1 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
          text,
        ),
      );
      const whatsNew = view.querySelector(".gh-prism-whats-new");
      if (whatsNew) whatsNew.after(...notices);
      else view.prepend(...notices);
    },
    sections: render,
    shownIn(native) {
      source = native;
      view.removeAttribute("data-reveal");
      native.tree.before(view);
      // A fresh scroll container doesn't carry the old one's position.
      scrolledTo = undefined;
      // A move need not resize the view, so its ResizeObserver may not fire.
      for (const { tree } of shown.values()) tree.sync();
    },
    onScreen(paths) {
      onScreen = paths;
      for (const { tree } of shown.values()) tree.showOnScreen(paths);
      markHeaders();
    },
    viewed(paths) {
      viewed = paths;
      offered = true;
      for (const { tree } of shown.values()) tree.showViewed(paths);
      countHeaders();
    },
  };
}
