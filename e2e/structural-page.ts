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
import { changedCells, currentLayout } from "../entrypoints/content/files-page";
import type { FileSection } from "../entrypoints/content/visit/land";
import type { LineAnnotation, StructuralFile } from "../utils/structural/changes";

export interface StructuralHarness {
  /** Starts the painter on the page's `#diffs` (else `document.body`), listing each of `files` as a section file whose path is its anchor. Files default to `synthesize()`. */
  start(files?: Record<string, StructuralFile>): void;
  /** A file per mounted split table, keyed by anchor, from the page's own cells: text from each cell, every other changed cell quiet, the rest with one range over their first run of non-space characters. */
  synthesize(): Record<string, StructuralFile>;
  /** Aborts the painter. */
  stop(): void;
  /** The latest outcome reported per path. */
  outcomes(): Record<string, PaintOutcome>;
  /** Range counts in the two highlights, how many are stale (collapsed, or outside a connected `.diff-text-inner`), and each range's text. */
  ranges(): { added: number; removed: number; stale: number; texts: string[] };
  /** Remembers the current Range objects; `kept()` then counts how many are still registered. */
  mark(): void;
  kept(): number;
}

declare global {
  interface Window {
    structural: StructuralHarness;
  }
}

/** One table's file: every other changed cell quiet, the rest one range over their first word. */
function fileOf(table: HTMLTableElement): StructuralFile {
  const annotations = {
    old: {} as Record<number, LineAnnotation>,
    new: {} as Record<number, LineAnnotation>,
  };
  const text = { old: {} as Record<number, string>, new: {} as Record<number, string> };
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
    return { file: { path: anchor, link } };
  });
  return [{ entries }] as unknown as FileSection[];
}

/** Whether `range` no longer covers text in a mounted cell. */
function isStale(range: AbstractRange): boolean {
  const node = range.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return range.collapsed || !element?.closest(".diff-text-inner")?.isConnected;
}

const highlighted = (name: string): AbstractRange[] => [...(CSS.highlights.get(name) ?? [])];

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
    for (const table of document.querySelectorAll<HTMLTableElement>("table[data-diff-anchor]"))
      if (currentLayout(table.parentElement ?? table) === "split")
        files[table.dataset.diffAnchor ?? ""] = fileOf(table);
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
  mark() {
    marked = new Set([...highlighted(ADDED_HIGHLIGHT), ...highlighted(REMOVED_HIGHLIGHT)]);
  },
  kept: () =>
    [...highlighted(ADDED_HIGHLIGHT), ...highlighted(REMOVED_HIGHLIGHT)].filter((range) =>
      marked.has(range),
    ).length,
};
