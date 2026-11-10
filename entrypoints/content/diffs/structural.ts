import type { ColumnRange, StructuralFile } from "@/utils/structural/changes";
import { movedLines } from "@/utils/structural/moved";
import {
  type ChangedCell,
  changedCells,
  type DiffSide,
  diffTables,
  observeDiffs,
} from "../files-page";
import type { LandingView } from "../visit/land";
import { pathsByAnchor } from "./on-screen";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./structural.css?inline";

/** How a mounted file fared: painted, or skipped whole because a mounted cell's text or annotation disagrees with the file. */
export type PaintOutcome = "painted" | "mismatch";

/** What the painter asks of structural mode. */
export interface StructuralPainting {
  /**
   * What structural mode knows about `path`, or `undefined` while it knows nothing. Asked again on
   * every pass; return the same object while a file is unchanged, since a new object repaints its
   * table. Nothing schedules a pass when the answer changes.
   */
  annotationsOf(path: string): StructuralFile | undefined;
  /**
   * Called when a mounted split table's outcome is first known, and again when it changes between
   * the two. A table that is cleared, unmounted, or not split is never reported.
   */
  report(path: string, outcome: PaintOutcome): void;
}

// Keep in sync with structural.css's ::highlight() names and attribute selectors.
export const ADDED_HIGHLIGHT = "gh-prism-added";
export const REMOVED_HIGHLIGHT = "gh-prism-removed";

const TABLE_ATTR = "data-gh-prism-structural";
const QUIET_ATTR = "data-gh-prism-quiet";
const MOVED_ATTR = "data-gh-prism-moved";

/** What one table holds: the file it was painted from, its cells' text roots, its ranges, and its quiet and moved rows. */
interface Painted {
  readonly file: StructuralFile;
  readonly roots: readonly Element[];
  readonly ranges: readonly Range[];
  readonly quiet: ReadonlyMap<Element, string>;
  readonly moved: ReadonlyMap<Element, string>;
}

/** The writes one table needs, read in full before any is made. */
interface Plan {
  readonly table: HTMLTableElement;
  readonly path: string;
  readonly outcome: PaintOutcome;
  readonly added: readonly Range[];
  readonly removed: readonly Range[];
  /** The quiet rows the table held before this plan. */
  readonly quietBefore: ReadonlyMap<Element, string>;
  /** The moved rows the table held before this plan. */
  readonly movedBefore: ReadonlyMap<Element, string>;
  readonly painted: Painted;
}

/** One pass's reads: the tables to paint, and the painted tables that are no longer fresh. */
interface Pass {
  readonly plans: readonly Plan[];
  readonly stale: readonly HTMLTableElement[];
}

/** Adds `side` to `row`'s value in `rows`, as `old`, `new`, or `old new`. */
function markSide(rows: Map<Element, string>, row: Element, side: DiffSide): void {
  rows.set(row, rows.has(row) ? `${rows.get(row)} ${side}` : side);
}

/** Writes `attr` onto the rows in `now` and off the rows only in `before`, touching no row already right. */
function writeRows(
  attr: string,
  before: ReadonlyMap<Element, string>,
  now: ReadonlyMap<Element, string>,
): void {
  for (const row of before.keys())
    if (!now.has(row) && row.hasAttribute(attr)) row.removeAttribute(attr);
  for (const [row, value] of now)
    if (row.getAttribute(attr) !== value) row.setAttribute(attr, value);
}

/** A range over columns `startCol` to `endCol` of `textRoot`'s text, or `undefined` when they are empty, inverted, or reach past it. */
function rangeOf(textRoot: Element, { startCol, endCol }: ColumnRange): Range | undefined {
  if (startCol < 0 || startCol >= endCol) return undefined;

  const doc = textRoot.ownerDocument;
  const walker = doc.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let offset = 0;
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!started && startCol < offset + length) {
      range.setStart(node, startCol - offset);
      started = true;
    }
    if (started && endCol <= offset + length) {
      range.setEnd(node, endCol - offset);
      return range;
    }
    offset += length;
  }
  return undefined;
}

/** Whether `cells` are the very text roots `painted` was painted on, from `file`, with no range gone stale. */
function isFresh(
  painted: Painted | undefined,
  file: StructuralFile,
  cells: readonly ChangedCell[],
): boolean {
  return (
    painted?.file === file &&
    painted.roots.length === cells.length &&
    cells.every(({ textRoot }, index) => painted.roots[index] === textRoot) &&
    !painted.ranges.some((range) => range.collapsed)
  );
}

/** Reads what `table` needs to show `file`; a cell without its annotation or its text is a mismatch. */
function planTable(
  table: HTMLTableElement,
  path: string,
  file: StructuralFile,
  cells: readonly ChangedCell[],
  before: Painted | undefined,
): Plan {
  const roots = cells.map(({ textRoot }) => textRoot);
  const quietBefore = before?.quiet ?? new Map<Element, string>();
  const movedBefore = before?.moved ?? new Map<Element, string>();
  const movedLinesOf = movedLines(file);
  const added: Range[] = [];
  const removed: Range[] = [];
  const quiet = new Map<Element, string>();
  const moved = new Map<Element, string>();

  for (const { side, line, textRoot, row } of cells) {
    const annotation = file.annotations[side][line];
    if (!annotation || textRoot.textContent !== file.text[side][line]) {
      const painted = { file, roots, ranges: [], quiet: new Map(), moved: new Map() };
      return {
        table,
        path,
        outcome: "mismatch",
        added: [],
        removed: [],
        quietBefore,
        movedBefore,
        painted,
      };
    }

    if (annotation.quiet) {
      markSide(quiet, row, side);
      continue;
    }

    if (movedLinesOf[side].has(line)) markSide(moved, row, side);
    const ranges = annotation.ranges.flatMap((columns) => rangeOf(textRoot, columns) ?? []);
    (side === "old" ? removed : added).push(...ranges);
  }

  const painted = { file, roots, ranges: [...added, ...removed], quiet, moved };
  return { table, path, outcome: "painted", added, removed, quietBefore, movedBefore, painted };
}

/**
 * Paints structural mode onto the split diff tables mounted under `diffs`, and repaints after
 * GitHub re-renders them, until `signal` aborts. Paths come from the files the `sections` hook
 * lists. A file whose mounted text differs from its `StructuralFile` is skipped whole and reported
 * as a mismatch.
 */
export function paintStructural(
  diffs: Element,
  signal: AbortSignal,
  { annotationsOf, report }: StructuralPainting,
): LandingView {
  const doc = diffs.ownerDocument;
  const win = doc.defaultView;
  if (!win || signal.aborted) return {};

  const addedHighlight = new win.Highlight();
  const removedHighlight = new win.Highlight();
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const painted = new Map<HTMLTableElement, Painted>();
  const reported = new Map<string, PaintOutcome>();
  let paths: ReadonlyMap<string, string> = new Map();
  let frame: number | undefined;

  const collect = (): Pass => {
    const plans: Plan[] = [];
    const fresh = new Set<HTMLTableElement>();
    for (const { table, anchor, layout } of diffTables(diffs)) {
      const path = paths.get(anchor);
      const file = path === undefined ? undefined : annotationsOf(path);
      if (path === undefined || !file || layout !== "split") continue;
      const cells = changedCells(table);
      const lastPaint = painted.get(table);
      if (isFresh(lastPaint, file, cells)) fresh.add(table);
      else plans.push(planTable(table, path, file, cells, lastPaint));
    }
    return { plans, stale: [...painted.keys()].filter((table) => !fresh.has(table)) };
  };
  const dropRanges = (table: HTMLTableElement): Painted | undefined => {
    const entry = painted.get(table);
    for (const range of entry?.ranges ?? []) {
      addedHighlight.delete(range);
      removedHighlight.delete(range);
    }
    painted.delete(table);
    return entry;
  };
  const unmark = (table: HTMLTableElement, entry: Painted | undefined) => {
    table.removeAttribute(TABLE_ATTR);
    for (const row of entry?.quiet.keys() ?? []) row.removeAttribute(QUIET_ATTR);
    for (const row of entry?.moved.keys() ?? []) row.removeAttribute(MOVED_ATTR);
  };
  const paint = ({
    table,
    outcome,
    added,
    removed,
    quietBefore,
    movedBefore,
    painted: entry,
  }: Plan) => {
    for (const range of added) addedHighlight.add(range);
    for (const range of removed) removedHighlight.add(range);

    if (outcome === "mismatch" && table.hasAttribute(TABLE_ATTR)) table.removeAttribute(TABLE_ATTR);
    if (outcome === "painted" && !table.hasAttribute(TABLE_ATTR))
      table.setAttribute(TABLE_ATTR, "");

    writeRows(QUIET_ATTR, quietBefore, entry.quiet);
    writeRows(MOVED_ATTR, movedBefore, entry.moved);

    painted.set(table, entry);
  };
  const apply = ({ plans, stale }: Pass) => {
    const planned = new Set(plans.map(({ table }) => table));
    for (const table of stale) {
      const entry = dropRanges(table);
      if (!planned.has(table) && table.isConnected) unmark(table, entry);
    }
    for (const plan of plans) paint(plan);
  };
  const reportChanged = ({ plans }: Pass) => {
    for (const { path, outcome } of plans) {
      if (reported.get(path) === outcome) continue;
      reported.set(path, outcome);
      report(path, outcome);
    }
  };
  // Every read precedes every write, so a pass never forces a layout between them.
  const pass = () => {
    const work = collect();
    apply(work);
    reportChanged(work);
  };
  const schedule = () => {
    if (signal.aborted) return;
    frame ??= win.requestAnimationFrame(() => {
      frame = undefined;
      pass();
    });
  };

  doc.head.append(style);
  win.CSS.highlights.set(ADDED_HIGHLIGHT, addedHighlight);
  win.CSS.highlights.set(REMOVED_HIGHLIGHT, removedHighlight);
  observeDiffs(diffs, schedule, { signal });
  signal.addEventListener("abort", () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);

    win.CSS.highlights.delete(ADDED_HIGHLIGHT);
    win.CSS.highlights.delete(REMOVED_HIGHLIGHT);

    // Sweeps the DOM, not `painted`: it also catches marks on a table GitHub moved since its pass.
    for (const element of diffs.querySelectorAll(
      `[${TABLE_ATTR}], [${QUIET_ATTR}], [${MOVED_ATTR}]`,
    )) {
      element.removeAttribute(TABLE_ATTR);
      element.removeAttribute(QUIET_ATTR);
      element.removeAttribute(MOVED_ATTR);
    }

    style.remove();
  });

  return {
    sections(sections) {
      paths = pathsByAnchor(sections);
      schedule();
    },
  };
}
