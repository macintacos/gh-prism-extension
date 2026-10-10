/**
 * Mirrors GitHub's Files changed tree as sections. The native tree stays mounted but hidden as
 * the source of truth: each render re-reads it, and file clicks go to its row's link, whose
 * handler mounts a virtualized diff that a bare hash jump would not. A file whose hunks span
 * sections is listed in each, with the hunks that land there; clicking a hunk reveals it.
 */

import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import {
  type ChangedFile,
  type FilesPage,
  observeTree,
  readChangedFiles,
  revealDiffLine,
} from "./files-page";
import type { IntentResult, PathOnlyReason, Placement, SectionShare } from "./intent";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sections-view.css?raw";

/** A file as one section lists it: whole, or with the hunks of a split that land in this section. */
interface FileEntry {
  readonly file: ChangedFile;
  /** `undefined` for a whole file. */
  readonly hunks?: SectionShare["hunks"];
}

interface FileSection {
  readonly key: SectionKey;
  readonly label: string;
  readonly entries: FileEntry[];
}

const NO_PLACEMENTS: ReadonlyMap<string, Placement> = new Map();

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
      ? placement.shares.map(({ section, hunks }) => ({ section, entry: { file, hunks } }))
      : [{ section: placement?.section ?? classify(file.path), entry: { file } }];
  });
  const bySection = Map.groupBy(placed, ({ section }) => section);
  return SECTIONS.flatMap(({ key, label }) => {
    const sectionPlaced = bySection.get(key);
    return sectionPlaced ? [{ key, label, entries: sectionPlaced.map(({ entry }) => entry) }] : [];
  });
}

interface DirNode {
  /** `/`-separated path from the section root, with no trailing slash; empty at the root. */
  readonly path: string;
  /** Indentation level of this node's rows. */
  readonly depth: number;
  readonly dirs: Map<string, DirNode>;
  readonly entries: FileEntry[];
}

function buildTree(entries: readonly FileEntry[]): DirNode {
  const root: DirNode = { path: "", depth: 0, dirs: new Map(), entries: [] };
  for (const entry of entries) {
    let node = root;
    for (const dir of entry.file.path.split("/").slice(0, -1)) {
      let child = node.dirs.get(dir);
      if (!child) {
        const path = node.path ? `${node.path}/${dir}` : dir;
        child = { path, depth: node.depth + 1, dirs: new Map(), entries: [] };
        node.dirs.set(dir, child);
      }
      node = child;
    }
    node.entries.push(entry);
  }
  return root;
}

const SVG_NS = "http://www.w3.org/2000/svg";
// Octicons chevron-down-16 and file-directory-fill-16.
const CHEVRON =
  "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z";
const DIRECTORY =
  "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z";

function octicon(doc: Document, className: string, pathData: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `octicon ${className}`);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const pathElement = doc.createElementNS(SVG_NS, "path");
  pathElement.setAttribute("d", pathData);
  svg.append(pathElement);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

function cloneVisual(doc: Document, source: Element | null): Node[] {
  if (!source) return [];
  const wrapper = el(doc, "span", "gh-prism-visual", source.cloneNode(true));
  wrapper.setAttribute("aria-hidden", "true");
  return [wrapper];
}

const nativeHref = (file: ChangedFile) => file.link.getAttribute("href") ?? "";

interface RenderContext {
  readonly doc: Document;
  readonly sectionKey: SectionKey;
  readonly collapsed: ReadonlySet<string>;
}

function hunkRow(
  file: ChangedFile,
  range: SectionShare["hunks"][number],
  ctx: RenderContext,
): HTMLElement {
  if (range === undefined) {
    const row = el(ctx.doc, "span", "gh-prism-hunk", "Removed lines");
    row.setAttribute("aria-disabled", "true");
    row.title = "No line in the new file to jump to.";
    return row;
  }
  const label =
    range.first === range.last ? `Line ${range.first}` : `Lines ${range.first}–${range.last}`;
  const row = el(ctx.doc, "a", "gh-prism-hunk", label);
  row.href = `${nativeHref(file)}R${range.first}`;
  row.dataset.path = file.path;
  row.dataset.section = ctx.sectionKey;
  row.dataset.line = String(range.first);
  return row;
}

function hunkList(
  file: ChangedFile,
  hunks: SectionShare["hunks"],
  ctx: RenderContext,
): HTMLUListElement {
  return el(
    ctx.doc,
    "ul",
    "gh-prism-hunks",
    ...hunks.map((range) => el(ctx.doc, "li", "", hunkRow(file, range, ctx))),
  );
}

function fileRow(entry: FileEntry, level: number, ctx: RenderContext): HTMLLIElement {
  const { file, hunks } = entry;
  const link = el(
    ctx.doc,
    "a",
    "gh-prism-file",
    ...cloneVisual(ctx.doc, file.statusIcon),
    el(ctx.doc, "span", "gh-prism-name", file.path.slice(file.path.lastIndexOf("/") + 1)),
    ...(hunks ? [el(ctx.doc, "span", "gh-prism-partial", "Partial")] : []),
    ...cloneVisual(ctx.doc, file.comments),
  );
  link.href = nativeHref(file);
  link.dataset.path = file.path;
  link.dataset.section = ctx.sectionKey;
  link.setAttribute("aria-label", hunks ? `${file.label}, partial` : file.label);
  if (file.active) link.setAttribute("aria-current", "true");
  const row = el(ctx.doc, "li", "", link);
  row.style.setProperty("--gh-prism-level", String(level));
  if (hunks) row.append(hunkList(file, hunks, ctx));
  return row;
}

function dirList(node: DirNode, ctx: RenderContext): HTMLUListElement {
  return el(
    ctx.doc,
    "ul",
    "gh-prism-list",
    ...[...node.dirs].map(([name, child]) => dirRow(name, child, ctx)),
    ...node.entries.map((entry) => fileRow(entry, node.depth, ctx)),
  );
}

function dirRow(name: string, node: DirNode, ctx: RenderContext): HTMLLIElement {
  // A directory can recur in several sections.
  const key = `${ctx.sectionKey}:${node.path}`;
  const expanded = !ctx.collapsed.has(key);
  const toggle = el(
    ctx.doc,
    "button",
    "gh-prism-dir",
    octicon(ctx.doc, "gh-prism-chevron", CHEVRON),
    octicon(ctx.doc, "gh-prism-dir-icon", DIRECTORY),
    el(ctx.doc, "span", "gh-prism-name", name),
  );
  toggle.type = "button";
  toggle.dataset.dir = key;
  toggle.setAttribute("aria-expanded", String(expanded));
  // The toggle sits in the parent's list, one level above this node's rows.
  toggle.style.setProperty("--gh-prism-level", String(node.depth - 1));
  const children = dirList(node, ctx);
  children.hidden = !expanded;
  return el(ctx.doc, "li", "", toggle, children);
}

function sectionView(
  section: FileSection,
  doc: Document,
  collapsed: ReadonlySet<string>,
): HTMLElement {
  const root = el(
    doc,
    "section",
    "gh-prism-section",
    el(
      doc,
      "h3",
      "gh-prism-section-header",
      section.label,
      el(doc, "span", "gh-prism-counter", String(section.entries.length)),
    ),
    dirList(buildTree(section.entries), { doc, sectionKey: section.key, collapsed }),
  );
  root.dataset.section = section.key;
  return root;
}

function focusKey(node: Element | null): string | undefined {
  if (!(node instanceof HTMLElement)) return undefined;
  const subject = node.dataset.path ?? node.dataset.dir;
  if (subject === undefined) return undefined;
  return [node.dataset.section, subject, node.dataset.line].join("|");
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * Mirrors `page`'s native file tree as sections inside its sidebar until `signal` aborts. Files
 * that `intent` places whole move to that section once it settles; a split file is listed in each
 * section its hunks land in, and a hunk click reveals that hunk. Until intent settles, and without
 * one, sections follow the paths alone. If it settles as a failure, a notice above the sections
 * says why.
 */
export function showSections(
  page: FilesPage,
  signal: AbortSignal,
  intent?: Promise<IntentResult>,
): void {
  const doc = page.sidebar.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const view = el(doc, "nav", "gh-prism-sections");
  view.setAttribute("aria-label", "Changed files by section");
  const collapsed = new Set<string>();
  let landed: IntentResult | undefined;
  // The reveal in flight. A newer hunk or file click, or the view's abort, cancels it.
  let jump: AbortController | undefined;

  const nativeLinkFor = (path: string | undefined) =>
    readChangedFiles(page.sidebar).find((file) => file.path === path)?.link;

  const jumpToHunk = (hunk: HTMLAnchorElement, event: MouseEvent) => {
    if (!isPlainLeftClick(event)) return;
    const native = nativeLinkFor(hunk.dataset.path);
    if (!native) return;
    event.preventDefault();
    jump?.abort();
    jump = new AbortController();
    void revealDiffLine(page.diffs, native, Number(hunk.dataset.line), { signal: jump.signal });
  };

  const render = () => {
    const focused = view.contains(doc.activeElement) ? doc.activeElement : null;
    const focusedKey = focusKey(focused);
    const focusedPath = focused instanceof HTMLElement ? focused.dataset.path : undefined;
    const placements = landed?.ok ? landed.placements : NO_PLACEMENTS;
    const sections = groupBySection(readChangedFiles(page.sidebar), placements);
    // No role="status": every render rebuilds this, so a live region would re-announce on scroll.
    const notice =
      landed?.ok === false ? [el(doc, "p", "gh-prism-notice", PATH_ONLY_COPY[landed.problem])] : [];
    view.replaceChildren(
      ...notice,
      ...sections.map((section) => sectionView(section, doc, collapsed)),
    );
    if (focusedKey === undefined) return;
    const rows = [...view.querySelectorAll<HTMLElement>("[data-path], [data-dir]")];
    const sameRow = rows.find((row) => focusKey(row) === focusedKey);
    // When intent moves or splits a focused file, focus moves to its first row.
    const sameFile = rows.find(
      (row) => focusedPath !== undefined && row.dataset.path === focusedPath,
    );
    (sameRow ?? sameFile)?.focus();
  };

  view.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const toggle = event.target.closest(".gh-prism-dir");
      if (toggle instanceof HTMLButtonElement && toggle.dataset.dir) {
        const key = toggle.dataset.dir;
        if (!collapsed.delete(key)) collapsed.add(key);
        render();
        return;
      }
      const hunk = event.target.closest("a.gh-prism-hunk");
      if (hunk instanceof HTMLAnchorElement) {
        jumpToHunk(hunk, event);
        return;
      }
      const row = event.target.closest(".gh-prism-file");
      if (!(row instanceof HTMLAnchorElement) || !isPlainLeftClick(event)) return;
      const native = nativeLinkFor(row.dataset.path);
      if (!native) return;
      event.preventDefault();
      jump?.abort();
      native.click();
    },
    { signal },
  );

  // A DOM clone of the sidebar, such as a restored snapshot, can carry an earlier view.
  for (const stale of page.sidebar.querySelectorAll(".gh-prism-sections")) stale.remove();
  page.tree.before(view);
  doc.head.append(style);
  render();
  // Detached: intent reports failures as values, so a rejection is a bug left to surface.
  void intent?.then((result) => {
    if (signal.aborted) return;
    landed = result;
    render();
  });
  observeTree(page.sidebar, render, { signal, ignore: view });
  signal.addEventListener("abort", () => {
    view.remove();
    style.remove();
    jump?.abort();
  });
}
