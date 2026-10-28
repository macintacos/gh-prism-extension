import "./custom-elements-stub";
import {
  FileTree,
  type FileTreeRowDecoration,
  type FileTreeVisibleRow,
  type GitStatus,
  preparePresortedFileTreeInput,
} from "@pierre/trees";
import { el } from "../ui/dom";
import { followReveals } from "../ui/reveal";
import { chainRule, fitChain } from "./chain-fit";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./section-tree.css?inline";

/** A file as a section's tree shows it. */
export interface TreeFile {
  readonly path: string;
  readonly status: GitStatus | undefined;
  /** What the row shows at its right edge, before the status. */
  readonly decoration: FileTreeRowDecoration | undefined;
}

/**
 * A row's Viewed box, as the @pierre/trees patch renders it: `label` is its accessible name,
 * `title` its hover text, `busy` its pending state.
 */
interface RowCheckbox {
  readonly checked: boolean;
  readonly busy: boolean;
  readonly label: string;
  readonly title: string;
}

/** A row's code owners shield, as the @pierre/trees patch renders it: `label` is its name. */
interface RowShield {
  readonly label: string;
}

// gh-prism's @pierre/trees patch is the only reader of `checkbox` and `shield`.
type RowDecoration = FileTreeRowDecoration & {
  readonly checkbox?: RowCheckbox;
  readonly shield?: RowShield;
};

const SHIELD: RowShield = { label: "Code owners" };

const ROW_HEIGHT = 28;

// Two-tone like the library's file glyphs. section-tree.css shows the folder's open shape on
// expanded rows.
const ICON_SPRITE = `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
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
  <symbol id="gh-prism-java" viewBox="0 0 16 16">
    <path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4" d="M5 1.25c-1 1 1 2 0 3.5M8.5 1.25c-1 1 1 2 0 3.5"/>
    <path fill="currentColor" d="M1.5 6.25h10.5v4.25a4 4 0 0 1-4 4h-2.5a4 4 0 0 1-4-4zM12 7.25h.5a2.5 2.5 0 0 1 0 5h-1.6a4 4 0 0 0 .7-1.5h.9a1 1 0 0 0 0-2H12z"/>
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
  readonly #viewed: HTMLStyleElement;
  readonly #owners: HTMLStyleElement;
  readonly #pointed: HTMLStyleElement;
  readonly #lastPieces: HTMLStyleElement;
  readonly #chains: HTMLStyleElement;
  readonly #refit: MutationObserver;
  readonly #resized: ResizeObserver;
  #files: readonly TreeFile[];
  #byPath: ReadonlyMap<string, TreeFile>;
  #selected: string | undefined;
  #focused: string | null | undefined;
  #hoverFolder: string | undefined;
  #focusFolder: string | undefined;
  /** The path of the row or box focus last moved to within the tree. */
  #focusAt: string | undefined;
  #viewedPaths: ReadonlySet<string> | undefined;
  #marking: ReadonlySet<string> = new Set();
  #ownedPaths: ReadonlySet<string> = new Set();
  readonly #altKey: string;

  /** Renders `files` into `host`, with `selected` selected if listed. */
  constructor(host: HTMLElement, files: readonly TreeFile[], selected: string | undefined) {
    this.#host = host;
    this.#altKey = altKeyName(host.ownerDocument.defaultView?.navigator);
    this.#files = files;
    this.#byPath = byPath(files);
    this.#tree = fileTreeOf(files, (path) => this.#decorationOf(path));
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
    this.#viewed = host.ownerDocument.createElement("style");
    this.#owners = host.ownerDocument.createElement("style");
    this.#pointed = host.ownerDocument.createElement("style");
    this.#lastPieces = host.ownerDocument.createElement("style");
    this.#chains = host.ownerDocument.createElement("style");
    const shadow = host.shadowRoot;
    // Both call back before paint, so a row the viewport mounts or a resize never paints unfitted.
    // Skips SectionTree's own <style> writes, #chains among them, so a fit never re-runs itself.
    this.#refit = new MutationObserver((records) => {
      if (records.some(({ target }) => !(target instanceof HTMLStyleElement))) this.#fitChains();
    });
    this.#resized = new ResizeObserver(() => this.#fitChains());
    if (shadow) {
      shadow.append(
        this.#probe,
        this.#onScreen,
        this.#viewed,
        this.#owners,
        this.#pointed,
        this.#lastPieces,
        this.#chains,
      );
      this.#followFocus(shadow);
      this.#followPointer(host, shadow);
      followReveals(shadow, matchMedia("(prefers-reduced-motion: reduce)"));
      this.#refit.observe(shadow, { childList: true, subtree: true });
      this.#resized.observe(host);
    }

    this.#select(selected);
    this.#showLastPieces();
    this.#tree.subscribe(() => {
      // The tree selects on clicks too, but only the native tree's current row may be selected.
      // Once the selection matches, #select changes nothing, so the emit it causes settles.
      this.#select(this.#selected);
      this.#fit();
      this.#showLastPieces();
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
   * Lights, for each of `paths`, its row's piece of its folder's hairline, or a top-level row's
   * edge, including rows the viewport mounts later, without selecting, focusing, or scrolling. A
   * style rule rather than row attributes, which re-renders would drop.
   */
  showOnScreen(paths: ReadonlySet<string>): void {
    this.#onScreen.textContent = ruleOf(
      [...paths].map((path) => {
        const folder = folderOf(path);
        return folder === undefined ? rowOf(path) : pieceIn(path, folder);
      }),
      LIT,
    );
  }

  /**
   * Marks the rows of `paths` as Viewed with a style rule, which re-renders keep, and gives every
   * file row a Viewed checkbox.
   */
  showViewed(paths: ReadonlySet<string>): void {
    this.#viewed.textContent = ruleOf([...paths].map(rowOf), "--gh-prism-viewed:1");
    this.#viewedPaths = paths;
    this.#host.setAttribute("data-gh-prism-checkboxes", "");
    this.#tree.render({ fileTreeContainer: this.#host });
  }

  /**
   * Gives the file rows of `paths` a code owners shield, shown in place of the row's icon while
   * the row is hovered or focused, by a style rule as re-renders keep it.
   */
  showOwners(paths: ReadonlySet<string>): void {
    this.#owners.textContent = [...paths]
      .map((path) => {
        const shield = `[data-item-shield="${CSS.escape(path)}"]`;
        const shown = `${rowOf(path)}:is(:hover,:focus-visible)`;
        return (
          ruleOf([`${shown}~${shield}`], "opacity:1;pointer-events:auto") +
          ruleOf(
            [
              `${shown}>[data-item-section="icon"]>svg`,
              `${rowOf(path)}:has(~${shield}:is(:hover,:focus-visible))>[data-item-section="icon"]>svg`,
            ],
            "opacity:0",
          )
        );
      })
      .join("");
    this.#ownedPaths = paths;
    this.#tree.render({ fileTreeContainer: this.#host });
  }

  /** Shows the checkboxes of `paths` as pending. */
  showMarking(paths: ReadonlySet<string>): void {
    this.#marking = paths;
    this.#tree.render({ fileTreeContainer: this.#host });
  }

  /**
   * Unlights the hairlines the pointer and focus light, until the pointer next moves or focus
   * next moves within the tree: what they point at may have scrolled away.
   */
  clearPointed(): void {
    this.#hoverFolder = undefined;
    this.#focusFolder = undefined;
    this.#showPointed();
  }

  /** Removes the tree's rows and releases it. */
  cleanUp(): void {
    this.#refit.disconnect();
    this.#resized.disconnect();
    this.#tree.cleanUp();
  }

  /**
   * The library scrolls only its own viewport to a focused row, so the sidebar has to follow.
   * It also re-focuses a row the viewport unmounted, which must neither pull the sidebar back nor
   * relight a hairline. Lights the focused row's folder until focus leaves the tree.
   */
  #followFocus(shadow: ShadowRoot): void {
    shadow.addEventListener("focusin", (event) => {
      const at = pathAt(event.target);
      if (at !== this.#focusAt) {
        this.#focusAt = at;
        this.#focusFolder = folderAt(event.target);
        this.#showPointed();
      }
      // A checkbox taking focus must not scroll the sidebar to the tree's last focused row.
      if (!(event.target instanceof Element && event.target.matches('[data-type="item"]'))) return;
      const path = this.#tree.getFocusedPath();
      if (path === this.#focused) return;
      this.#focused = path;
      this.#scrollTo(this.#tree.getFocusedIndex());
    });
    shadow.addEventListener("focusout", (event) => {
      // A null relatedTarget is a row unmounting, the window blurring, or focus dropping to the
      // page; only the last leaves the tree with nothing focused once the library re-focuses.
      const next = event instanceof FocusEvent ? event.relatedTarget : null;
      if (next instanceof Node && next.getRootNode() !== shadow) {
        this.#focused = undefined;
        this.#unlightFocus();
      } else if (next === null) {
        setTimeout(() => {
          if (!shadow.activeElement) this.#unlightFocus();
        });
      }
    });
  }

  #unlightFocus(): void {
    this.#focusAt = undefined;
    this.#focusFolder = undefined;
    this.#showPointed();
  }

  #followPointer(host: HTMLElement, shadow: ShadowRoot): void {
    shadow.addEventListener("pointermove", (event) => {
      this.#hoverFolder = folderAt(event.target);
      this.#showPointed();
    });
    host.addEventListener("pointerleave", () => {
      this.#hoverFolder = undefined;
      this.#showPointed();
    });
  }

  #showPointed(): void {
    const rule = ruleOf(
      [this.#hoverFolder, this.#focusFolder].filter((folder) => folder !== undefined).map(pieceOf),
      LIT,
    );
    if (this.#pointed.textContent !== rule) this.#pointed.textContent = rule;
  }

  /**
   * Marks the last piece of each folder's hairline, in its last visible row, so the line stops
   * short of that row's foot. A style rule, as row attributes would drop on re-render.
   */
  #showLastPieces(): void {
    const rows = this.#tree.getVisibleRows(0, this.#tree.getVisibleCount() - 1);
    const rule = ruleOf(
      rows.flatMap((row, i) => lastPiecesIn(row, rows[i + 1])),
      "--gh-prism-last:1",
    );
    if (this.#lastPieces.textContent !== rule) this.#lastPieces.textContent = rule;
  }

  /**
   * Fits each rendered folder chain to its row's room, measuring every row before writing the one
   * rule so layout runs once. Writes only on change, so the observers that call it settle.
   */
  #fitChains(): void {
    const rows = this.#host.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-type="item"]:has([data-item-flattened-subitems])',
    );
    const rule = [...(rows ?? [])].map(fittedChainRule).join("");
    if (this.#chains.textContent !== rule) this.#chains.textContent = rule;
  }

  #decorationOf(path: string): RowDecoration | null {
    const file = this.#byPath.get(path);
    const decoration = file?.decoration ?? null;
    const shielded = this.#ownedPaths.has(path);
    if (!file || (!this.#viewedPaths && !shielded)) return decoration;
    return {
      // text: "" satisfies the decoration type for a row with nothing else to show; the library
      // then renders an empty decoration lane.
      text: "",
      ...decoration,
      ...(this.#viewedPaths && { checkbox: this.#checkboxOf(path, this.#viewedPaths) }),
      ...(shielded && { shield: SHIELD }),
    };
  }

  #checkboxOf(path: string, viewedPaths: ReadonlySet<string>): RowCheckbox {
    const checked = viewedPaths.has(path);
    return {
      checked,
      busy: this.#marking.has(path),
      label: `Viewed: ${path.slice(path.lastIndexOf("/") + 1)}`,
      // sections-view.ts makes an Alt-click on the row do what a click here does.
      title: `${checked ? "Mark as not viewed" : "Mark as viewed"} (or ${this.#altKey}-click the row)`,
    };
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

/**
 * Languages the complete set draws as a plain file, drawn with gh-prism's own glyph from
 * ICON_SPRITE. A glyph new to this map needs a color rule in section-tree.css.
 */
const LANGUAGE_ICONS = { java: "gh-prism-java" };

/** A tree of `files`, every directory open, that asks `decorationOf` for each row's decoration. */
function fileTreeOf(
  files: readonly TreeFile[],
  decorationOf: (path: string) => RowDecoration | null,
): FileTree {
  return new FileTree({
    preparedInput: preparePresortedFileTreeInput(files.map(({ path }) => path)),
    flattenEmptyDirectories: true,
    icons: {
      // Explicit: any custom icon field makes the set default to "none".
      set: "complete",
      byFileName: ECOSYSTEM_ICONS,
      byFileExtension: LANGUAGE_ICONS,
      spriteSheet: ICON_SPRITE,
      remap: { "file-tree-icon-chevron": "gh-prism-folder" },
    },
    initialExpansion: "open",
    gitStatus: gitStatusOf(files),
    renderRowDecoration: ({ item }) => decorationOf(item.path),
    itemHeight: ROW_HEIGHT,
    unsafeCSS: css,
  });
}

/** A rule giving what `selectors` match `declaration`, or nothing when there are none. */
function ruleOf(selectors: readonly string[], declaration: string): string {
  return selectors.length ? `${selectors.join(",")}{${declaration}}` : "";
}

const rowOf = (path: string) => `[data-type="item"][data-item-path="${CSS.escape(path)}"]`;

/** Every piece of `folder`'s hairline, by the hook @pierre/trees' own guide styles use. */
const pieceOf = (folder: string) =>
  `[data-item-section="spacing-item"][data-ancestor-path="${CSS.escape(folder)}"]`;

/** The piece of `folder`'s hairline in `path`'s row. */
const pieceIn = (path: string, folder: string) =>
  `${rowOf(path)}>[data-item-section="spacing"]>${pieceOf(folder)}`;

/**
 * The pieces in `row` whose hairlines end there, given the visible row after it: in preorder,
 * `next` sits inside only the first `next.depth` of `row`'s ancestors.
 */
const lastPiecesIn = (row: FileTreeVisibleRow, next: FileTreeVisibleRow | undefined) =>
  row.ancestorPaths.slice(next?.depth ?? 0, row.depth).map((folder) => pieceIn(row.path, folder));

const LIT = "--gh-prism-lit:1";

/** The rule fitting chain `row` to its room, measured as it lays out now. */
function fittedChainRule(row: HTMLElement): string {
  const units = [...row.querySelectorAll<HTMLElement>("[data-item-flattened-subitem]")];
  const ellipsis = row.querySelector<HTMLElement>("[data-item-flattened-ellipsis]");
  const content = row.querySelector<HTMLElement>('[data-item-section="content"]');
  const path = row.dataset.itemPath;
  if (!ellipsis || !content || path === undefined) return "";

  const fit = fitChain(units.map(naturalWidth), naturalWidth(ellipsis), contentWidth(content));
  return chainRule(
    path,
    units.map((unit) => unit.dataset.itemFlattenedSubitem ?? ""),
    fit,
  );
}

/** `element`'s content-box width in fractional px, the room its children lay out in. */
function contentWidth(element: HTMLElement): number {
  const { paddingLeft, paddingRight } = getComputedStyle(element);
  return element.getBoundingClientRect().width - parseFloat(paddingLeft) - parseFloat(paddingRight);
}

/**
 * `unit`'s width in fractional px with nothing in it cut, so it doesn't depend on the fit it
 * feeds: a middle-truncated name counts at its text's width, and the `…`'s separator, which
 * `chainRule` takes out of flow, at its own.
 */
function naturalWidth(unit: HTMLElement): number {
  const separator = unit.querySelector<HTMLElement>("[data-item-flattened-separator]");
  const hiddenSeparatorWidth =
    separator && getComputedStyle(separator).position === "absolute"
      ? separator.getBoundingClientRect().width
      : 0;
  const cutWidth = [...unit.querySelectorAll('[data-truncate-content="visible"]')].reduce(
    (total, text) => total + textWidth(text) - text.getBoundingClientRect().width,
    0,
  );
  return unit.getBoundingClientRect().width + cutWidth + hiddenSeparatorWidth;
}

function textWidth(element: Element): number {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  return range.getBoundingClientRect().width;
}

/** The directory `path` sits in, as `data-ancestor-path` spells it; undefined at top level. */
function folderOf(path: string): string | undefined {
  const end = path.lastIndexOf("/") + 1;
  return end > 0 ? path.slice(0, end) : undefined;
}

const rowAt = (target: EventTarget | null) =>
  target instanceof Element
    ? target.closest<HTMLElement>('[data-type="item"],[data-item-checkbox]')
    : null;

/** The path of the row or Viewed box `target` sits in. */
function pathAt(target: EventTarget | null): string | undefined {
  const row = rowAt(target);
  return row?.dataset.itemPath ?? row?.dataset.itemCheckbox;
}

/**
 * The folder whose hairline `target`'s row lights: a folder's own, or a file's directory;
 * undefined for a top-level file or a target outside any row.
 */
function folderAt(target: EventTarget | null): string | undefined {
  const row = rowAt(target);
  if (row?.dataset.itemType === "folder") return row.dataset.itemPath;
  return folderOf(pathAt(target) ?? "");
}

/** The Alt key's name on the platform `navigator` reports. */
const altKeyName = (navigator: Navigator | undefined) =>
  navigator?.platform.startsWith("Mac") ? "Option" : "Alt";

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
