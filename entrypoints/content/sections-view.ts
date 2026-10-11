/**
 * Mirrors GitHub's Files changed tree as sections, each a file tree of its own. The native tree
 * stays mounted but hidden as the source of truth: each render re-reads it, and file clicks go to
 * its row's link, whose handler mounts a virtualized diff that a bare hash jump would not. A file
 * whose hunks span sections is listed, marked Partial, in each; clicking it there reveals the
 * first of that section's hunks.
 */

import type { FileTreeRowDecoration, GitStatus } from "@pierre/trees";
import type { LineCounts } from "@/utils/pr-diff";
import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import { orderDiffs } from "./diff-order";
import { type DiffstatChoice, linesBySection, lineTotals, showDiffstat } from "./diffstat-view";
import { el, icon } from "./dom";
import {
  type ChangedFile,
  type FilesPage,
  findDiffstat,
  observeTree,
  readChangedFiles,
  revealDiff,
  revealDiffLine,
} from "./files-page";
import type {
  FileLines,
  IntentProgress,
  IntentResult,
  PathOnlyReason,
  Placement,
  SectionShare,
} from "./intent";
import { sectionIcon } from "./section-icons";
import { SectionTree, type TreeFile } from "./section-tree";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sections-view.css?raw";

/** A file as one section lists it: whole, or with the share of a split that lands in this section. */
interface FileEntry {
  readonly file: ChangedFile;
  readonly share?: SectionShare;
}

interface FileSection {
  readonly key: SectionKey;
  readonly label: string;
  readonly entries: FileEntry[];
}

interface ShownSection {
  readonly root: HTMLElement;
  readonly counter: HTMLElement;
  readonly tree: SectionTree;
}

/**
 * Reads where the changed files land, reporting its progress through `onProgress`. Returns the
 * result itself, not a promise, when it has already landed.
 */
export type PendingIntent = (
  onProgress: (progress: IntentProgress) => void,
) => IntentResult | Promise<IntentResult>;

/**
 * Starts `read` now and lets each view that follows it share that one read: a view joining
 * mid-read starts at the latest progress, and one joining after it lands gets the result itself.
 */
export function shareIntent(read: PendingIntent): PendingIntent {
  let latest: IntentProgress | undefined;
  let result: IntentResult | undefined;
  // ponytail: a dropped view's follower stays until the visit ends, updating detached nodes;
  // unfollow on the view's signal if remounts ever pile up.
  const followers = new Set<(progress: IntentProgress) => void>();
  const landing = Promise.resolve(
    read((progress) => {
      latest = progress;
      for (const follow of followers) follow(progress);
    }),
  ).then((landed) => (result = landed));
  return (onProgress) => {
    if (result) return result;
    if (latest) onProgress(latest);
    followers.add(onProgress);
    return landing;
  };
}

export interface SectionsOptions {
  readonly intent: PendingIntent;
  /** The header counter's view, shared by every page in the tab. */
  readonly diffstat: DiffstatChoice;
}

const NO_PLACEMENTS: ReadonlyMap<string, Placement> = new Map();
const NO_LINES: ReadonlyMap<string, FileLines> = new Map();

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

const STATUS_BY_OCTICON: ReadonlyMap<string, GitStatus> = new Map([
  ["octicon-file-added", "added"],
  ["octicon-file-removed", "deleted"],
  ["octicon-file-moved", "renamed"],
  ["octicon-file-diff", "modified"],
]);

const ADDED = "var(--fgColor-success)";
const REMOVED = "var(--fgColor-danger)";
const UNCHANGED = "var(--fgColor-muted)";
// section-tree.css styles these parts by the custom property each color names.
const MARKER = "var(--gh-prism-marker-fg)";
const COMMENTS = "var(--gh-prism-comment-fg)";

/**
 * Non-empty sections in `SECTIONS` order, each with its entries in native-tree order. A file placed
 * whole goes to that section whatever its path says; a split file is listed in each section its
 * hunks land in.
 */
function groupBySection(
  files: readonly ChangedFile[],
  placements: ReadonlyMap<string, Placement>,
): FileSection[] {
  const placed = files.flatMap((file) => {
    const placement = placements.get(file.path);
    return placement?.kind === "split"
      ? placement.shares.map((share) => ({ section: share.section, entry: { file, share } }))
      : [{ section: placement?.section ?? classify(file.path), entry: { file } }];
  });
  const bySection = Map.groupBy(placed, ({ section }) => section);
  return SECTIONS.flatMap(({ key, label }) => {
    const sectionPlaced = bySection.get(key);
    return sectionPlaced ? [{ key, label, entries: sectionPlaced.map(({ entry }) => entry) }] : [];
  });
}

const statusOf = (icon: Element | null): GitStatus | undefined =>
  [...STATUS_BY_OCTICON].find(([octicon]) => icon?.classList.contains(octicon))?.[1];

/**
 * A row's comment count, Partial or Binary marker, and lines added and removed, as known. Its
 * title, which the row's accessible name ends with, says each in words.
 */
function decorationOf(
  { file, share }: FileEntry,
  lines: FileLines | undefined,
): FileTreeRowDecoration | undefined {
  const parts: { text: string; color: string }[] = [];
  const phrases: string[] = [];
  const comments = file.comments?.textContent?.trim();
  if (comments) {
    parts.push({ text: comments, color: COMMENTS });
    phrases.push(`${comments} comment${comments === "1" ? "" : "s"}`);
  }
  if (share) {
    parts.push({ text: "Partial", color: MARKER });
    phrases.push("Partial: other sections hold the rest");
  }
  const counted = share?.lines ?? lines;
  if (counted === "binary") {
    parts.push({ text: "Binary", color: MARKER });
    phrases.push("Binary file: no line counts");
  } else if (counted && counted.added + counted.removed > 0) {
    const { added, removed } = counted;
    parts.push(
      { text: `+${added}`, color: added > 0 ? ADDED : UNCHANGED },
      { text: `−${removed}`, color: removed > 0 ? REMOVED : UNCHANGED },
    );
    phrases.push(`${added} added, ${removed} removed${share ? " in this section" : ""}`);
  }
  if (parts.length === 0) return undefined;
  return { text: parts.map(({ text }) => text).join(" "), title: phrases.join(". "), parts };
}

const treeFilesOf = ({ entries }: FileSection, lines: ReadonlyMap<string, FileLines>): TreeFile[] =>
  entries.map((entry) => ({
    path: entry.file.path,
    status: statusOf(entry.file.statusIcon),
    decoration: decorationOf(entry, lines.get(entry.file.path)),
  }));

/** Lucide chevron-down (ISC licence). */
const chevron = (doc: Document): SVGSVGElement =>
  icon(doc, "m6 9 6 6 6-6", {
    class: "gh-prism-chevron",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });

/**
 * A section, `order` places from the top, whose header button shows and hides an empty host for
 * its tree. `expand` sets which it does. The button leads with the section's icon, which the
 * stylesheet swaps for the chevron while it is hovered or focused, and ends with the `lines` it
 * adds and removes, if known.
 */
function sectionShell(
  doc: Document,
  { key, label }: FileSection,
  { order, lines }: { order: number; lines: LineCounts | undefined },
) {
  const counter = el(doc, "span", "gh-prism-counter");
  const glyph = el(doc, "span", "gh-prism-glyph", sectionIcon(doc, key), chevron(doc));
  const name = el(doc, "span", "gh-prism-section-label", label);
  const toggle = el(doc, "button", "gh-prism-section-toggle", glyph, name, counter);
  if (lines) toggle.append(lineTotals(doc, lines));
  toggle.type = "button";
  const header = el(doc, "h3", "gh-prism-section-header", toggle);
  header.id = `gh-prism-heading-${key}`;
  const host = el(doc, "div", "gh-prism-tree");
  const files = el(doc, "div", "gh-prism-files", host);
  files.id = `gh-prism-files-${key}`;
  toggle.setAttribute("aria-controls", files.id);
  const root = el(doc, "section", "gh-prism-section", header, files);
  root.setAttribute("aria-labelledby", header.id);
  root.dataset.section = key;
  root.style.setProperty("--gh-prism-order", String(order));
  const expand = (expanded: boolean) => {
    toggle.setAttribute("aria-expanded", String(expanded));
    files.inert = !expanded;
  };
  return { root, counter, host, toggle, expand };
}

/** Placeholder rows for the sidebar's file list. */
const listSkeleton = (doc: Document) =>
  el(doc, "div", "gh-prism-skeleton", ...Array.from({ length: 5 }, () => el(doc, "span", "")));

/** Placeholder diffs: a file header over a few lines of code each. */
const diffSkeleton = (doc: Document) =>
  el(
    doc,
    "div",
    "gh-prism-diff-skeleton",
    ...[4, 2, 3].map((lines) =>
      el(
        doc,
        "div",
        "gh-prism-diff-card",
        el(doc, "span", "gh-prism-diff-card-header"),
        ...Array.from({ length: lines }, () => el(doc, "span", "")),
      ),
    ),
  );

/** A progress bar that reads the diff, then counts the files checked, over `skeleton`. */
function loadingView(doc: Document, skeleton: HTMLElement) {
  const label = el(doc, "span", "", "Reading the diff");
  const count = el(doc, "span", "gh-prism-loading-count");
  const root = el(
    doc,
    "div",
    "gh-prism-loading",
    el(doc, "div", "gh-prism-loading-label", label, count),
    el(doc, "div", "gh-prism-spectrum"),
    skeleton,
  );
  root.setAttribute("role", "progressbar");
  root.setAttribute("aria-label", "Reading the diff");
  const progress = ({ checked, total }: IntentProgress) => {
    label.textContent = "Sorting files into sections";
    count.textContent = `${checked} of ${total}`;
    root.setAttribute("aria-label", label.textContent);
    root.setAttribute("aria-valuemax", String(total));
    root.setAttribute("aria-valuenow", String(checked));
    root.style.setProperty("--gh-prism-progress", String(total > 0 ? checked / total : 1));
  };
  return { root, progress };
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** The file row and section a click inside a section tree landed on. */
function clickedFile(event: Event): { section: string; path: string } | undefined {
  const elements = event.composedPath().filter((node) => node instanceof HTMLElement);
  const row = elements.find((node) => node.dataset.type === "item");
  const section = elements.find((node) => node.classList.contains("gh-prism-section"))?.dataset
    .section;
  const path = row?.dataset.itemPath;
  return row?.dataset.itemType === "file" && section && path ? { section, path } : undefined;
}

/**
 * Mirrors `page`'s native file tree as sections inside its sidebar until `signal` aborts. With an
 * `intent`, a progress bar stands in until it settles, unless it already has; then files it places
 * whole sit in that section, and a split file is listed in each section its hunks land in, with
 * the lines each share adds and removes, and the header's lines-changed counter breaks out by
 * section. If it settles as a failure, the sections follow the paths alone under a notice saying
 * why. Without one, path sections show at once.
 */
export function showSections(
  page: FilesPage,
  signal: AbortSignal,
  options?: SectionsOptions,
): void {
  const doc = page.sidebar.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const view = el(doc, "nav", "gh-prism-sections");
  view.setAttribute("aria-label", "Changed files by section");
  const shown = new Map<SectionKey, ShownSection>();
  // Outlives the sections themselves, so one that empties and comes back stays collapsed.
  const collapsed = new Set<SectionKey>(["generated"]);
  let loading: ReturnType<typeof loadingView> | undefined;
  let landed: IntentResult | undefined;
  // The reveal in flight. A newer file click, or the view's abort, cancels it.
  let jump: AbortController | undefined;

  const placements = () => (landed?.ok ? landed.placements : NO_PLACEMENTS);
  const lines = () => (landed?.ok ? landed.lines : NO_LINES);
  const totalOf = (section: SectionKey) =>
    linesBySection({ placements: placements(), lines: lines() }).find(
      (total) => total.section === section,
    )?.lines;

  const open = (section: string, path: string) => {
    const native = readChangedFiles(page.sidebar).find((file) => file.path === path)?.link;
    if (!native) return;
    jump?.abort();
    const placement = placements().get(path);
    const share =
      placement?.kind === "split"
        ? placement.shares.find((candidate) => candidate.section === section)
        : undefined;
    const line = share?.hunks.find((span) => span !== undefined)?.first;
    jump = new AbortController();
    if (line === undefined) revealDiff(native, { signal: jump.signal });
    else void revealDiffLine(page.diffs, native, line, { signal: jump.signal });
  };

  const dropAllBut = (sections: readonly FileSection[]) => {
    for (const [key, { root, tree }] of shown) {
      if (sections.some((section) => section.key === key)) continue;
      tree.cleanUp();
      root.remove();
      shown.delete(key);
    }
  };

  /** Updates `section`'s tree, or builds it as section `order` after `previous`. Returns its root. */
  const showSection = (section: FileSection, order: number, previous: Element | null) => {
    const files = treeFilesOf(section, lines());
    const active = section.entries.find(({ file }) => file.active)?.file.path;
    let current = shown.get(section.key);
    if (current) {
      current.tree.update(files, active);
    } else {
      // Set once: a section is only built after intent lands, and the landed lines never change.
      const { root, counter, host, toggle, expand } = sectionShell(doc, section, {
        order,
        lines: totalOf(section.key),
      });
      expand(!collapsed.has(section.key));
      toggle.addEventListener("click", () => {
        const expanded = collapsed.has(section.key);
        if (expanded) collapsed.delete(section.key);
        else collapsed.add(section.key);
        expand(expanded);
      });
      if (previous) previous.after(root);
      else view.prepend(root);
      current = { root, counter, tree: new SectionTree(host, files, active) };
      shown.set(section.key, current);
    }
    const count = String(section.entries.length);
    if (current.counter.textContent !== count) current.counter.textContent = count;
    return current.root;
  };

  const render = () => {
    if (loading) return;
    const sections = groupBySection(readChangedFiles(page.sidebar), placements());
    dropAllBut(sections);
    let previous = [...view.querySelectorAll(".gh-prism-notice")].at(-1) ?? null;
    for (const [order, section] of sections.entries())
      previous = showSection(section, order, previous);
    diffOrder.arrange(
      sections.map(({ entries }) => entries.map(({ file }) => file.link.hash.slice(1))),
    );
  };

  /** Adds `text` under any notice already shown, above the sections. */
  const notice = (text: string) => {
    const shown = el(doc, "p", "gh-prism-notice", text);
    const last = [...view.querySelectorAll(".gh-prism-notice")].at(-1);
    if (last) last.after(shown);
    else view.prepend(shown);
  };

  view.addEventListener(
    "click",
    (event) => {
      const clicked = clickedFile(event);
      if (clicked && isPlainLeftClick(event)) open(clicked.section, clicked.path);
    },
    { signal },
  );

  const land = (result: IntentResult, diffstat: DiffstatChoice) => {
    landed = result;
    if (result.ok) {
      const counter = findDiffstat(doc);
      if (counter) showDiffstat(counter, result, { choice: diffstat, signal });
    } else {
      notice(PATH_ONLY_COPY[result.problem]);
    }
    if (!diffOrder.reorderable()) notice(FIXED_ORDER_COPY);
  };

  // A DOM clone of the sidebar, such as a restored snapshot, can carry an earlier view.
  for (const stale of page.sidebar.querySelectorAll(".gh-prism-sections")) stale.remove();
  page.tree.before(view);
  doc.head.append(style);
  const diffOrder = orderDiffs(page, signal);
  if (options) {
    const pending = loadingView(doc, listSkeleton(doc));
    const diffsPending = loadingView(doc, diffSkeleton(doc));
    diffsPending.root.classList.add("gh-prism-diff-loading");
    const intent = options.intent((progress) => {
      pending.progress(progress);
      diffsPending.progress(progress);
    });
    if (intent instanceof Promise) {
      loading = pending;
      view.setAttribute("aria-busy", "true");
      view.append(pending.root);
      if (diffOrder.reorderable()) diffOrder.cover(diffsPending.root);
      void intent
        .catch((error: unknown): IntentResult => {
          console.error("gh-prism: reading intent failed", error);
          return { ok: false, problem: "failed" };
        })
        .then((result) => {
          if (signal.aborted) return;
          loading = undefined;
          pending.root.remove();
          view.removeAttribute("aria-busy");
          view.toggleAttribute("data-reveal", true);
          land(result, options.diffstat);
          render();
          diffOrder.reveal();
        });
    } else {
      land(intent, options.diffstat);
    }
  }
  render();
  observeTree(page.sidebar, render, { signal, ignore: view });
  signal.addEventListener("abort", () => {
    for (const { tree } of shown.values()) tree.cleanUp();
    view.remove();
    style.remove();
    jump?.abort();
  });
}
