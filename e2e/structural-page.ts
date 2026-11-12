/**
 * The structural painter's browser harness: `e2e/structural.e2e.ts` bundles this through
 * `bench/bundle.ts` and injects it into a fixture page, where it runs the real painter as
 * `window.structural`. Not `*.e2e.ts`, so Playwright doesn't collect it.
 */
import {
  ADDED_HIGHLIGHT,
  type PaintOutcome,
  paintStructural,
  REMOVED_HIGHLIGHT,
} from "../entrypoints/content/diffs/structural";
import { MARKS_ATTR } from "../entrypoints/content/diffs/structural-attrs";
import { changedCells, diffTables } from "../entrypoints/content/files-page";
import type { FileSection } from "../entrypoints/content/visit/land";
import type { LineAnnotation, StructuralFile } from "../utils/structural/changes";

export interface StructuralHarness {
  /**
   * Starts the painter on the page's `#diffs` (else `document.body`), listing each of `files` as a
   * section file whose path is its anchor. Files default to `synthesize()`.
   */
  start(files?: Record<string, StructuralFile>): void;
  /**
   * A file per mounted split table, keyed by anchor, from the page's own cells: text from each
   * cell, every other changed cell quiet, the rest with one range over their first run of
   * non-space characters.
   */
  synthesize(): Record<string, StructuralFile>;
  /** Aborts the painter. */
  stop(): void;
  /** The latest outcome reported per path. */
  outcomes(): Record<string, PaintOutcome>;
  /**
   * Range counts in the two highlights, how many are stale (collapsed, or outside a connected
   * `.diff-text-inner`), and each range's text.
   */
  ranges(): { added: number; removed: number; stale: number; texts: string[] };
  /**
   * Each marked line, in document order: the boxes its mask draws and its ranges' own boxes, both as
   * `[x, y, width, height]` from the line's text root, in hundredths of a pixel.
   */
  drawn(): { boxes: number[][]; texts: number[][] }[];
  /** Remembers the Range objects registered now, for `kept()`. */
  mark(): void;
  /** How many of the Ranges `mark()` remembered are still registered. */
  kept(): number;
}

declare global {
  interface Window {
    structural: StructuralHarness;
  }
}

/** One table's file: every other changed cell quiet, the rest one range over their first word. */
function fileOf(table: HTMLTableElement): StructuralFile {
  const annotations: Record<"old" | "new", Record<number, LineAnnotation>> = { old: {}, new: {} };
  const text: Record<"old" | "new", Record<number, string>> = { old: {}, new: {} };
  changedCells(table).forEach(({ side, line, textRoot }, index) => {
    const content = textRoot.textContent ?? "";
    const word = /\S+/.exec(content);
    text[side][line] = content;
    annotations[side][line] =
      index % 2 === 1 || !word
        ? { quiet: true }
        : { quiet: false, ranges: [{ startCol: word.index, endCol: word.index + word[0].length }] };
  });
  return { annotations, text };
}

/** The sections `pathsByAnchor` reads, one file per anchor, its path the anchor itself. */
function sectionsOf(anchors: readonly string[]): FileSection[] {
  const entries = anchors.map((anchor) => {
    const link = document.createElement("a");
    link.setAttribute("href", `#${anchor}`);
    const file = { path: anchor, link, active: false, status: undefined, comments: null };
    return { section: "implementation", lines: undefined, file } as const;
  });
  return [{ key: "implementation", entries }];
}

/** Whether `range` no longer covers text in a mounted cell. */
function isStale(range: AbstractRange): boolean {
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return range.collapsed || !element?.closest(".diff-text-inner")?.isConnected;
}

const highlighted = (name: string): AbstractRange[] => [...(CSS.highlights.get(name) ?? [])];

const hundredths = (values: readonly number[]) => values.map((value) => Math.round(value * 100));

/** The boxes the mask on `root` draws. */
function maskBoxes(root: HTMLElement): number[][] {
  const svg = decodeURIComponent(root.style.getPropertyValue("--gh-prism-marks"));
  return [...svg.matchAll(/<rect x='(.+?)' y='(.+?)' width='(.+?)' height='(.+?)'/g)].map((match) =>
    hundredths(match.slice(1).map(Number)),
  );
}

/** The bounding boxes of the registered ranges inside `root`, from its top left corner. */
function textBoxes(root: HTMLElement): number[][] {
  const origin = root.getBoundingClientRect();
  return [...highlighted(ADDED_HIGHLIGHT), ...highlighted(REMOVED_HIGHLIGHT)]
    .filter(
      (range): range is Range => range instanceof Range && root.contains(range.startContainer),
    )
    .map((range) => range.getBoundingClientRect())
    .map((box) =>
      hundredths([box.left - origin.left, box.top - origin.top, box.width, box.height]),
    );
}

let controller = new AbortController();
let reported: Record<string, PaintOutcome> = {};
let marked = new Set<AbstractRange>();

window.structural = {
  start(files = window.structural.synthesize()) {
    const diffs = document.querySelector("#diffs") ?? document.body;
    controller = new AbortController();
    reported = {};
    const view = paintStructural(diffs, controller.signal, {
      annotationsOf: (path) => files[path],
      report: (path, outcome) => {
        reported[path] = outcome;
      },
    });
    view.sections?.(sectionsOf(Object.keys(files)), new Set());
  },
  synthesize() {
    const files: Record<string, StructuralFile> = {};
    for (const { table, anchor, layout } of diffTables(document))
      if (layout === "split") files[anchor] = fileOf(table);
    return files;
  },
  stop: () => controller.abort(),
  outcomes: () => ({ ...reported }),
  ranges() {
    const added = highlighted(ADDED_HIGHLIGHT);
    const removed = highlighted(REMOVED_HIGHLIGHT);
    const all = [...added, ...removed];
    return {
      added: added.length,
      removed: removed.length,
      stale: all.filter(isStale).length,
      texts: all.map((range) => (range instanceof Range ? range.toString() : "")),
    };
  },
  drawn: () =>
    [...document.querySelectorAll<HTMLElement>(`[${MARKS_ATTR}]`)].map((root) => ({
      boxes: maskBoxes(root),
      texts: textBoxes(root),
    })),
  mark() {
    marked = new Set([...highlighted(ADDED_HIGHLIGHT), ...highlighted(REMOVED_HIGHLIGHT)]);
  },
  kept: () =>
    [...highlighted(ADDED_HIGHLIGHT), ...highlighted(REMOVED_HIGHLIGHT)].filter((range) =>
      marked.has(range),
    ).length,
};
