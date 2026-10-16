import "./custom-elements-stub";
import {
  FileTree,
  type FileTreeRowDecoration,
  type GitStatus,
  preparePresortedFileTreeInput,
} from "@pierre/trees";
import { el } from "../ui/dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./section-tree.css?inline";

/** A file as a section's tree shows it. */
export interface TreeFile {
  readonly path: string;
  readonly status: GitStatus | undefined;
  /** What the row shows at its right edge, before the status. */
  readonly decoration: FileTreeRowDecoration | undefined;
}

const ROW_HEIGHT = 28;

// Two-tone like the library's file glyphs. section-tree.css shows the open shape on expanded rows.
const FOLDER_SPRITE = `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="gh-prism-folder" viewBox="0 0 16 16">
    <g class="gh-prism-folder-closed">
      <path fill="currentColor" opacity=".4" d="M1 4.5A2.5 2.5 0 0 1 3.5 2h2.38a1.5 1.5 0 0 1 1.2.6L8 3.75h4.5A2.5 2.5 0 0 1 15 6.25v5.25a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 11.5z"/>
      <path fill="currentColor" d="M1 7a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 15 7v4.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 11.5z"/>
    </g>
    <g class="gh-prism-folder-open">
      <path fill="currentColor" opacity=".4" d="M1 4.5A2.5 2.5 0 0 1 3.5 2h2.38a1.5 1.5 0 0 1 1.2.6L8 3.75h4A2 2 0 0 1 14 5.75v.75H4.7a2.5 2.5 0 0 0-2.36 1.67L1 12z"/>
      <path fill="currentColor" d="M3.4 8.6A1.75 1.75 0 0 1 5.05 7.5h9.7a.75.75 0 0 1 .7 1l-1.9 4.5a1.75 1.75 0 0 1-1.65 1H2.1a.75.75 0 0 1-.7-1z"/>
    </g>
  </symbol>
</svg>`;

/**
 * One section's files as a @pierre/trees tree in `host`'s shadow root, with directories that
 * hold a single directory flattened into one row. `host` must be in the document. Its height
 * follows the visible rows, so the sidebar scrolls as one, and, while its owner calls `sync`, only
 * the rows near the sidebar's viewport render.
 */
export class SectionTree {
  readonly #host: HTMLElement;
  readonly #tree: FileTree;
  readonly #probe: HTMLElement;
  readonly #onScreen: HTMLStyleElement;
  #files: readonly TreeFile[];
  #byPath: ReadonlyMap<string, TreeFile>;
  #selected: string | undefined;
  #focused: string | null | undefined;

  /** Renders `files` into `host`, with `selected` selected if listed. */
  constructor(host: HTMLElement, files: readonly TreeFile[], selected: string | undefined) {
    this.#host = host;
    this.#files = files;
    this.#byPath = byPath(files);
    this.#tree = fileTreeOf(files, (path) => this.#byPath.get(path)?.decoration ?? null);
    this.#fit();
    this.#tree.render({ fileTreeContainer: host });

    // Stands in for a row the viewport hasn't rendered, so scrollIntoView reaches every scroller.
    this.#probe = el(
      host.ownerDocument,
      "span",
      "gh-prism-probe tw:absolute tw:left-0 tw:w-px tw:invisible tw:pointer-events-none",
    );
    this.#probe.style.height = `${ROW_HEIGHT}px`;
    this.#onScreen = host.ownerDocument.createElement("style");
    const shadow = host.shadowRoot;
    if (shadow) {
      shadow.append(this.#probe, this.#onScreen);
      this.#followFocus(shadow);
    }

    this.#select(selected);
    this.#tree.subscribe(() => {
      // The tree selects on clicks too, but only the native tree's current row may be selected.
      // Once the selection matches, #select changes nothing, so the emit it causes settles.
      this.#select(this.#selected);
      this.#fit();
    });
  }

  /**
   * Shows `files`, in their order, with `selected` selected if listed. Resets paths, statuses
   * and rows only where they changed, and keeps collapsed directories collapsed.
   */
  update(files: readonly TreeFile[], selected: string | undefined): void {
    const previous = this.#files;
    this.#files = files;
    this.#byPath = byPath(files);

    const pathsChanged = changed(previous, files, ({ path }) => path);
    if (pathsChanged) this.#resetPaths(previous);
    // A path or status change re-renders every row, decorations included.
    if (pathsChanged || changed(previous, files, ({ status }) => status)) {
      this.#tree.setGitStatus(gitStatusOf(files));
    } else if (changed(previous, files, ({ decoration }) => JSON.stringify(decoration))) {
      this.#tree.render({ fileTreeContainer: this.#host });
    }

    this.#select(selected);
  }

  /**
   * Shows the rows where the sidebar has scrolled this tree, and empties the viewport of a tree
   * over a viewport out of view (`data-gh-prism-far`). The owner calls it whenever the host may
   * have moved against the viewport: an ancestor's scroll, a resize, or a layout change above it.
   */
  sync(): void {
    const root = this.#host.shadowRoot?.querySelector("[data-file-tree-virtualized-root]");
    const scroll = root?.querySelector("[data-file-tree-virtualized-scroll]");
    if (!root || !scroll) return;

    const hostBox = this.#host.getBoundingClientRect();
    const offset = root.getBoundingClientRect().top - hostBox.top;
    // The page's height bounds the pane's.
    const viewportHeight = this.#host.ownerDocument.defaultView?.innerHeight ?? 0;

    this.#host.toggleAttribute(
      "data-gh-prism-far",
      hostBox.bottom < -viewportHeight || hostBox.top > 2 * viewportHeight,
    );
    if (scroll.scrollTop !== offset) scroll.scrollTop = offset;
  }

  /** Scrolls the sidebar just enough to show `path`'s row, unless its section is collapsed. */
  scrollToRow(path: string): void {
    this.#scrollTo(
      this.#tree
        .getVisibleRows(0, this.#tree.getVisibleCount() - 1)
        .findIndex((row) => row.path === path),
    );
  }

  /**
   * Marks the rows of `paths`, including rows the viewport mounts later, without selecting,
   * focusing, or scrolling. A style rule rather than row attributes, which re-renders would drop.
   */
  showOnScreen(paths: ReadonlySet<string>): void {
    const rows = [...paths].map(
      (path) => `[data-type="item"][data-item-path="${CSS.escape(path)}"]`,
    );
    this.#onScreen.textContent = rows.length ? `${rows.join(",")}{--gh-prism-on-screen:1}` : "";
  }

  /** Removes the tree's rows and releases it. */
  cleanUp(): void {
    this.#tree.cleanUp();
  }

  /**
   * The library scrolls only its own viewport to a focused row, so the sidebar has to follow.
   * It also re-focuses a row the viewport unmounted, which must not pull the sidebar back.
   */
  #followFocus(shadow: ShadowRoot): void {
    shadow.addEventListener("focusin", () => {
      const path = this.#tree.getFocusedPath();
      if (path === this.#focused) return;
      this.#focused = path;
      this.#scrollTo(this.#tree.getFocusedIndex());
    });
    shadow.addEventListener("focusout", (event) => {
      // A null relatedTarget is a row unmounting or the window blurring, not focus leaving.
      const next = event instanceof FocusEvent ? event.relatedTarget : null;
      if (next instanceof Node && next.getRootNode() !== shadow) this.#focused = undefined;
    });
  }

  #resetPaths(previous: readonly TreeFile[]): void {
    const collapsed = [...directoriesOf(previous)].filter((path) => {
      const item = this.#tree.getItem(path);
      return item !== null && "isExpanded" in item && !item.isExpanded();
    });
    this.#tree.resetPaths({
      preparedInput: preparePresortedFileTreeInput(this.#files.map(({ path }) => path)),
    });
    for (const path of collapsed) {
      const item = this.#tree.getItem(path);
      if (item !== null && "collapse" in item) item.collapse();
    }
  }

  #select(path: string | undefined): void {
    this.#selected = path;
    for (const selected of this.#tree.getSelectedPaths()) {
      if (selected !== path) this.#tree.getItem(selected)?.deselect();
    }
    if (path !== undefined) this.#tree.getItem(path)?.select();
  }

  /** Scrolls the sidebar, and the library's viewport inside it, just enough to show row `index`. */
  #scrollTo(index: number): void {
    // A collapsed section clips its rows without scrolling them, so their place means nothing.
    if (index < 0 || this.#host.closest("[inert]")) return;
    // A path reset's #fit may not have run yet; the probe must sit within the host's height.
    this.#fit();
    this.#probe.style.top = `${index * ROW_HEIGHT}px`;
    this.#probe.scrollIntoView({ block: "nearest" });
    this.sync();
  }

  #fit(): void {
    const height = `${this.#tree.getVisibleCount() * ROW_HEIGHT}px`;
    if (this.#host.style.height !== height) this.#host.style.height = height;
  }
}

/**
 * Manifests and lockfiles the complete set draws as JSON or a plain file, drawn with their
 * ecosystem's glyph. A glyph new to this map needs a color rule in section-tree.css. The set
 * has no yarn, pnpm, or PHP glyph.
 */
const ECOSYSTEM_ICONS = {
  "package.json": "file-tree-builtin-npm",
  "package-lock.json": "file-tree-builtin-npm",
  "npm-shrinkwrap.json": "file-tree-builtin-npm",
  "Cargo.toml": "file-tree-builtin-rust",
  "Cargo.lock": "file-tree-builtin-rust",
  "go.mod": "file-tree-builtin-go",
  "go.sum": "file-tree-builtin-go",
  "Gemfile.lock": "file-tree-builtin-ruby",
  "poetry.lock": "file-tree-builtin-python",
  "uv.lock": "file-tree-builtin-python",
};

/** A tree of `files`, every directory open, that asks `decorationOf` for each row's decoration. */
function fileTreeOf(
  files: readonly TreeFile[],
  decorationOf: (path: string) => FileTreeRowDecoration | null,
): FileTree {
  return new FileTree({
    preparedInput: preparePresortedFileTreeInput(files.map(({ path }) => path)),
    flattenEmptyDirectories: true,
    icons: {
      // Explicit: any custom icon field makes the set default to "none".
      set: "complete",
      byFileName: ECOSYSTEM_ICONS,
      spriteSheet: FOLDER_SPRITE,
      remap: { "file-tree-icon-chevron": "gh-prism-folder" },
    },
    initialExpansion: "open",
    gitStatus: gitStatusOf(files),
    renderRowDecoration: ({ item }) => decorationOf(item.path),
    itemHeight: ROW_HEIGHT,
    unsafeCSS: css,
  });
}

const byPath = (files: readonly TreeFile[]) => new Map(files.map((file) => [file.path, file]));

const gitStatusOf = (files: readonly TreeFile[]) =>
  files.flatMap(({ path, status }) => (status ? [{ path, status }] : []));

function changed(
  before: readonly TreeFile[],
  after: readonly TreeFile[],
  key: (file: TreeFile) => unknown,
): boolean {
  return (
    before.length !== after.length ||
    after.some((file, i) => {
      const prior = before[i];
      return prior === undefined || key(prior) !== key(file);
    })
  );
}

/** Every directory above `files`, as `a/` and `a/b/`. */
function directoriesOf(files: readonly TreeFile[]): Set<string> {
  const directories = new Set<string>();
  for (const { path } of files) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      directories.add(path.slice(0, slash + 1));
    }
  }
  return directories;
}
