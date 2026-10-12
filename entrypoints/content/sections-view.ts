/**
 * Mirrors GitHub's Files changed tree as sections, each a file tree of its own. The native tree
 * stays mounted but hidden as the source of truth: each render re-reads it, and file clicks go to
 * its row's link, whose handler mounts a virtualized diff that a bare hash jump would not. A file
 * whose hunks span sections is listed, marked Partial, in each; clicking it there reveals the
 * first of that section's hunks.
 */

import type { FileTreeRowDecoration } from "@pierre/trees";
import type { IntentResult, PathOnlyReason } from "@/utils/intent";
import { landingOf, revealLineOf, totalsOf } from "@/utils/landing";
import type { LineCounts } from "@/utils/pr-diff";
import { SECTIONS, type SectionKey } from "@/utils/sections";
import { lineTotals } from "./diffstat-view";
import { el, icon } from "./dom";
import { type FilesPage, readChangedFiles, reorderable } from "./files-page";
import { type LoadingView, loadingView } from "./loading-view";
import { revealDiff, revealDiffLine } from "./reveal";
import { SECTION_CATALOG, sectionIcon } from "./section-catalog";
import { SectionTree, type TreeFile } from "./section-tree";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sections-view.css?raw";
import type { FileSection, LandingView } from "./visit";

type FileEntry = FileSection["entries"][number];

interface ShownSection {
  readonly root: HTMLElement;
  readonly counter: HTMLElement;
  readonly tree: SectionTree;
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
 * A row's comment count, Partial or Binary marker, and lines added and removed, as known. Its
 * title, which the row's accessible name ends with, says each in words.
 */
function decorationOf({ file, share, lines }: FileEntry): FileTreeRowDecoration | undefined {
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
  if (lines === "binary") {
    parts.push({ text: "Binary", color: MARKER });
    phrases.push("Binary file: no line counts");
  } else if (lines && lines.added + lines.removed > 0) {
    const { added, removed } = lines;
    parts.push(
      { text: `+${added}`, color: added > 0 ? ADDED : UNCHANGED },
      { text: `−${removed}`, color: removed > 0 ? REMOVED : UNCHANGED },
    );
    phrases.push(`${added} added, ${removed} removed${share ? " in this section" : ""}`);
  }
  if (parts.length === 0) return undefined;
  return { text: parts.map(({ text }) => text).join(" "), title: phrases.join(". "), parts };
}

const treeFilesOf = ({ entries }: FileSection): TreeFile[] =>
  entries.map((entry) => ({
    path: entry.file.path,
    status: entry.file.status,
    decoration: decorationOf(entry),
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

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/** The file row and section a click inside a section tree landed on. */
function clickedFile(event: Event): { section: SectionKey; path: string } | undefined {
  const elements = event.composedPath().filter((node) => node instanceof HTMLElement);
  const row = elements.find((node) => node.dataset.type === "item");
  const raw = elements.find((node) => node.classList.contains("gh-prism-section"))?.dataset.section;
  const section = SECTIONS.find(({ key }) => key === raw)?.key;
  const path = row?.dataset.itemPath;
  return row?.dataset.itemType === "file" && section && path ? { section, path } : undefined;
}

/**
 * Mounts the sidebar's sections view in `page` until `signal` aborts, and returns its hooks: a
 * progress bar while intent is pending; on landing, notices for path-only sections or diffs kept
 * in GitHub's order; then a tree per section, each split file listed in every section its hunks
 * land in, with the lines each share adds and removes. `root` is the view's `<nav>`.
 */
export function showSections(
  page: FilesPage,
  signal: AbortSignal,
): LandingView & { readonly root: Element } {
  const doc = page.sidebar.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const view = el(doc, "nav", "gh-prism-sections");
  view.setAttribute("aria-label", "Changed files by section");
  const shown = new Map<SectionKey, ShownSection>();
  // Outlives the sections themselves, so one that empties and comes back stays collapsed.
  const collapsed = new Set(
    SECTIONS.flatMap(({ key }) => (SECTION_CATALOG[key].startsCollapsed ? [key] : [])),
  );
  let loading: LoadingView | undefined;
  let landing = landingOf(undefined);
  // The reveal in flight. A newer file click, or the view's abort, cancels it.
  let jump: AbortController | undefined;

  const totalOf = (section: SectionKey) =>
    totalsOf(landing).find((total) => total.section === section)?.lines;

  const open = (section: SectionKey, path: string) => {
    const native = readChangedFiles(page.sidebar).find((file) => file.path === path)?.link;
    if (!native) return;
    jump?.abort();
    const line = revealLineOf(landing, path, section);
    jump = new AbortController();
    if (line === undefined) revealDiff(page, native, { signal: jump.signal });
    else void revealDiffLine(page, native, line, { signal: jump.signal });
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
    const files = treeFilesOf(section);
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

  const render = (sections: readonly FileSection[]) => {
    dropAllBut(sections);
    let previous = [...view.querySelectorAll(".gh-prism-notice")].at(-1) ?? null;
    for (const [order, section] of sections.entries())
      previous = showSection(section, order, previous);
  };

  view.addEventListener(
    "click",
    (event) => {
      const clicked = clickedFile(event);
      if (clicked && isPlainLeftClick(event)) open(clicked.section, clicked.path);
    },
    { signal },
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
      if (loading) {
        loading.root.remove();
        loading = undefined;
        view.removeAttribute("aria-busy");
        view.toggleAttribute("data-reveal", true);
      }
      view.prepend(
        ...noticesOf(result, reorderable(page)).map((text) =>
          el(doc, "p", "gh-prism-notice", text),
        ),
      );
    },
    sections: render,
  };
}
