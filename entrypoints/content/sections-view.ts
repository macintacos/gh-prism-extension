import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import { type ChangedFile, type FilesPage, observe, readChangedFiles } from "./files-page";

export interface FileSection {
  readonly key: SectionKey;
  readonly label: string;
  readonly files: ChangedFile[];
}

/** Non-empty sections in `SECTIONS` order, each with its files in native-tree order. */
export function groupBySection(files: readonly ChangedFile[]): FileSection[] {
  return SECTIONS.map(({ key, label }) => ({
    key,
    label,
    files: files.filter((f) => classify(f.path) === key),
  })).filter((s) => s.files.length > 0);
}

interface DirNode {
  readonly dirs: Map<string, DirNode>;
  readonly files: ChangedFile[];
}

function buildTree(files: readonly ChangedFile[]): DirNode {
  const root: DirNode = { dirs: new Map(), files: [] };
  for (const file of files) {
    let node = root;
    for (const dir of file.path.split("/").slice(0, -1)) {
      let child = node.dirs.get(dir);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        node.dirs.set(dir, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CHEVRON =
  "M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z";
const DIRECTORY =
  "M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z";

function octicon(className: string, path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", `octicon ${className}`);
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const d = document.createElementNS(SVG_NS, "path");
  d.setAttribute("d", path);
  svg.append(d);
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

function decoration(source: Element | null): Node[] {
  if (!source) return [];
  const wrapper = el("span", "gh-prism-visual", source.cloneNode(true));
  wrapper.setAttribute("aria-hidden", "true");
  return [wrapper];
}

function fileRow(file: ChangedFile, level: number): HTMLLIElement {
  const link = el(
    "a",
    "gh-prism-file",
    ...decoration(file.statusIcon),
    el("span", "gh-prism-name", file.path.slice(file.path.lastIndexOf("/") + 1)),
    ...decoration(file.comments),
  );
  link.href = file.link.getAttribute("href") ?? "";
  link.dataset.path = file.path;
  link.setAttribute("aria-label", file.label);
  if (file.active) link.setAttribute("aria-current", "true");
  link.style.setProperty("--gh-prism-level", String(level));
  return el("li", "", link);
}

function dirList(
  node: DirNode,
  section: SectionKey,
  prefix: string,
  level: number,
  collapsed: ReadonlySet<string>,
): HTMLUListElement {
  const list = el("ul", "gh-prism-list");
  for (const [name, child] of node.dirs) {
    const path = prefix + name;
    const key = `${section}:${path}`;
    const open = !collapsed.has(key);
    const toggle = el(
      "button",
      "gh-prism-dir",
      octicon("gh-prism-chevron", CHEVRON),
      octicon("gh-prism-dir-icon", DIRECTORY),
      el("span", "gh-prism-name", name),
    );
    toggle.type = "button";
    toggle.dataset.dir = key;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.style.setProperty("--gh-prism-level", String(level));
    const children = dirList(child, section, `${path}/`, level + 1, collapsed);
    children.hidden = !open;
    list.append(el("li", "", toggle, children));
  }
  list.append(...node.files.map((f) => fileRow(f, level)));
  return list;
}

function sectionView(section: FileSection, collapsed: ReadonlySet<string>): HTMLElement {
  const root = el(
    "section",
    "gh-prism-section",
    el(
      "h3",
      "gh-prism-section-header",
      section.label,
      el("span", "gh-prism-counter", String(section.files.length)),
    ),
    dirList(buildTree(section.files), section.key, "", 0, collapsed),
  );
  root.dataset.section = section.key;
  return root;
}

function focusKey(el: Element | null): string | undefined {
  if (!(el instanceof HTMLElement)) return undefined;
  return el.dataset.path ?? el.dataset.dir;
}

/** Mirrors `page`'s native file tree as sections inside its sidebar until `signal` aborts. */
export function showSections(page: FilesPage, signal: AbortSignal): void {
  const view = document.createElement("nav");
  view.className = "gh-prism-sections";
  view.setAttribute("aria-label", "Changed files by section");
  const collapsed = new Set<string>();

  const render = () => {
    const focused = view.contains(document.activeElement)
      ? focusKey(document.activeElement)
      : undefined;
    const sections = groupBySection(readChangedFiles(page.sidebar));
    view.replaceChildren(...sections.map((s) => sectionView(s, collapsed)));
    if (focused === undefined) return;
    [...view.querySelectorAll<HTMLElement>("[data-path], [data-dir]")]
      .find((e) => focusKey(e) === focused)
      ?.focus();
  };

  view.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof Element)) return;
      const toggle = event.target.closest<HTMLElement>(".gh-prism-dir");
      if (toggle?.dataset.dir) {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        const list = toggle.nextElementSibling;
        if (list instanceof HTMLElement) list.hidden = !open;
        if (open) collapsed.delete(toggle.dataset.dir);
        else collapsed.add(toggle.dataset.dir);
        return;
      }
      const row = event.target.closest<HTMLElement>(".gh-prism-file");
      const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
      if (!row || event.button !== 0 || modified) return;
      event.preventDefault();
      readChangedFiles(page.sidebar)
        .find((f) => f.path === row.dataset.path)
        ?.link.click();
    },
    { signal },
  );

  page.tree.before(view);
  render();
  observe(page.sidebar, render, signal, view);
  signal.addEventListener("abort", () => view.remove());
}
