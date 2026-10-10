/**
 * Mirrors GitHub's Files changed tree as sections. The native tree stays mounted but hidden as
 * the source of truth: each render re-reads it, and file clicks go to its row's link, whose
 * handler mounts a virtualized diff that a bare hash jump would not.
 */

import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import { type ChangedFile, type FilesPage, observeTree, readChangedFiles } from "./files-page";
import type { IntentResult, PathOnlyReason } from "./intent";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sections-view.css?raw";

interface FileSection {
  readonly key: SectionKey;
  readonly label: string;
  readonly files: ChangedFile[];
}

const NO_DOC_PATHS: ReadonlySet<string> = new Set();

const PATH_ONLY_COPY: Record<PathOnlyReason, string> = {
  "commit-filtered":
    "Grouped by path. Docstring-only changes are detected when viewing all commits.",
  "no-access": "Grouped by path. Sign in to GitHub to detect docstring-only changes.",
  "rate-limited":
    "Grouped by path. GitHub is rate-limiting requests; reload to detect docstring-only changes.",
  "too-large": "Grouped by path. This diff is too large to check for docstring-only changes.",
  failed: "Grouped by path. The diff didn't load; reload to detect docstring-only changes.",
};

/**
 * Non-empty sections in `SECTIONS` order, each with its files in native-tree order. A file in
 * `docPaths` is Documentation whatever its path says.
 */
function groupBySection(
  files: readonly ChangedFile[],
  docPaths: ReadonlySet<string>,
): FileSection[] {
  const bySection = Map.groupBy(files, (file) =>
    docPaths.has(file.path) ? "docs" : classify(file.path),
  );
  return SECTIONS.flatMap(({ key, label }) => {
    const sectionFiles = bySection.get(key);
    return sectionFiles ? [{ key, label, files: sectionFiles }] : [];
  });
}

interface DirNode {
  /** `/`-separated path from the section root, with no trailing slash; empty at the root. */
  readonly path: string;
  /** Indentation level of this node's rows. */
  readonly depth: number;
  readonly dirs: Map<string, DirNode>;
  readonly files: ChangedFile[];
}

function buildTree(files: readonly ChangedFile[]): DirNode {
  const root: DirNode = { path: "", depth: 0, dirs: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const dir of file.path.split("/").slice(0, -1)) {
      let child = node.dirs.get(dir);
      if (!child) {
        const path = node.path ? `${node.path}/${dir}` : dir;
        child = { path, depth: node.depth + 1, dirs: new Map(), files: [] };
        node.dirs.set(dir, child);
      }
      node = child;
    }
    node.files.push(file);
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

function fileRow(doc: Document, file: ChangedFile, level: number): HTMLLIElement {
  const link = el(
    doc,
    "a",
    "gh-prism-file",
    ...cloneVisual(doc, file.statusIcon),
    el(doc, "span", "gh-prism-name", file.path.slice(file.path.lastIndexOf("/") + 1)),
    ...cloneVisual(doc, file.comments),
  );
  link.href = file.link.getAttribute("href") ?? "";
  link.dataset.path = file.path;
  link.setAttribute("aria-label", file.label);
  if (file.active) link.setAttribute("aria-current", "true");
  link.style.setProperty("--gh-prism-level", String(level));
  return el(doc, "li", "", link);
}

interface RenderContext {
  readonly doc: Document;
  readonly sectionKey: SectionKey;
  readonly collapsed: ReadonlySet<string>;
}

function dirList(node: DirNode, ctx: RenderContext): HTMLUListElement {
  return el(
    ctx.doc,
    "ul",
    "gh-prism-list",
    ...[...node.dirs].map(([name, child]) => dirRow(name, child, ctx)),
    ...node.files.map((file) => fileRow(ctx.doc, file, node.depth)),
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
      el(doc, "span", "gh-prism-counter", String(section.files.length)),
    ),
    dirList(buildTree(section.files), { doc, sectionKey: section.key, collapsed }),
  );
  root.dataset.section = section.key;
  return root;
}

function focusKey(node: Element | null): string | undefined {
  if (!(node instanceof HTMLElement)) return undefined;
  return node.dataset.path ?? node.dataset.dir;
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
}

/**
 * Mirrors `page`'s native file tree as sections inside its sidebar until `signal` aborts. Files
 * in `intent`'s doc paths move to Documentation once it settles; until then, and without one,
 * sections follow the paths alone. If it settles as a failure, a notice above the sections says
 * why.
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

  const render = () => {
    const focusedKey = view.contains(doc.activeElement) ? focusKey(doc.activeElement) : undefined;
    const docPaths = landed?.ok ? landed.paths : NO_DOC_PATHS;
    const sections = groupBySection(readChangedFiles(page.sidebar), docPaths);
    // No role="status": every render rebuilds this, so a live region would re-announce on scroll.
    const notice =
      landed?.ok === false ? [el(doc, "p", "gh-prism-notice", PATH_ONLY_COPY[landed.problem])] : [];
    view.replaceChildren(
      ...notice,
      ...sections.map((section) => sectionView(section, doc, collapsed)),
    );
    if (focusedKey === undefined) return;
    [...view.querySelectorAll("[data-path], [data-dir]")]
      .find(
        (element): element is HTMLElement =>
          element instanceof HTMLElement && focusKey(element) === focusedKey,
      )
      ?.focus();
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
      const row = event.target.closest(".gh-prism-file");
      if (!(row instanceof HTMLAnchorElement) || !isPlainLeftClick(event)) return;
      const native = readChangedFiles(page.sidebar).find(
        (file) => file.path === row.dataset.path,
      )?.link;
      if (!native) return;
      event.preventDefault();
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
  });
}
