import type { ColumnRange, StructuralFile } from "@/utils/structural/changes";
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
import {
  ADDED_ROW_ATTR,
  FILLER_ATTR,
  MARKS_ATTR,
  PART_ATTR,
  QUIET_ATTR,
  TABLE_ATTR,
} from "./structural-attrs";
import { type Box, lineBoxes, markRanges, maskOf } from "./structural-marks";
import {
  dropUnmounted,
  type PairingSnapshots,
  pairTable,
  readCell,
  restoreTable,
} from "./structural-pairing";

/** How a mounted file fared: painted, or skipped whole because an annotated mounted cell's text disagrees with the file. */
export type PaintOutcome = "painted" | "mismatch";

/** What the painter asks of structural mode. */
export interface StructuralPainting {
  /**
   * What structural mode knows about `path`, or `undefined` while it knows nothing. Asked again on
   * every pass; return the same object while a file is unchanged, since a new object repaints and
   * re-pairs its table. Nothing schedules a pass when the answer changes.
   */
  annotationsOf(path: string): StructuralFile | undefined;
  /**
   * Called when a mounted split table's outcome is first known, and again when it changes between
   * the two. A table that is cleared, unmounted, or not split is never reported.
   */
  report(path: string, outcome: PaintOutcome): void;
}

// Keep in sync with structural.css's ::highlight() names, attribute selectors, and mask variable.
export const ADDED_HIGHLIGHT = "gh-prism-added";
export const REMOVED_HIGHLIGHT = "gh-prism-removed";
const MASK_PROPERTY = "--gh-prism-marks";

/** Each marked cell's text root and the ranges its marks cover. */
type Marks = ReadonlyMap<HTMLElement, readonly Range[]>;

/** The rows whose tint steps down, each with its sides: quiet rows, and rows with a marked line. */
interface FaintRows {
  readonly quiet: ReadonlyMap<Element, string>;
  readonly part: ReadonlyMap<Element, string>;
}

const noFaintRows = (): FaintRows => ({ quiet: new Map(), part: new Map() });

/** What one table holds: the file it was painted from, its cells' text roots, its ranges, its faint rows, and its marks. */
interface Painted {
  readonly file: StructuralFile;
  readonly roots: readonly Element[];
  readonly ranges: readonly Range[];
  readonly faint: FaintRows;
  readonly marks: Marks;
}

/** The writes one table needs, read in full before any is made. */
interface Plan {
  readonly table: HTMLTableElement;
  readonly path: string;
  readonly outcome: PaintOutcome;
  readonly added: readonly Range[];
  readonly removed: readonly Range[];
  /** The faint rows the table held before this plan. */
  readonly faintBefore: FaintRows;
  /** The marks the table held before this plan. */
  readonly marksBefore: Marks;
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

/** The boxes of `ranges`' text, one per visual line of each, from `root`'s top left corner. */
function boxesOf(root: Element, ranges: readonly Range[]): Box[] {
  const origin = root.getBoundingClientRect();
  return ranges.flatMap((range) => lineBoxes(origin, range.getClientRects()));
}

/** Writes `now`'s rows onto the page and takes off the rows only in `before`. */
function writeFaintRows(before: FaintRows, now: FaintRows): void {
  writeRows(QUIET_ATTR, before.quiet, now.quiet);
  writeRows(PART_ATTR, before.part, now.part);
}

/** Draws `mask` behind `root`'s text, or takes its marks off for `undefined`. */
function writeMask(root: HTMLElement, mask: string | undefined): void {
  if (mask === undefined) {
    if (root.hasAttribute(MARKS_ATTR)) root.removeAttribute(MARKS_ATTR);
    root.style.removeProperty(MASK_PROPERTY);
    return;
  }

  if (!root.hasAttribute(MARKS_ATTR)) root.setAttribute(MARKS_ATTR, "");
  root.style.setProperty(MASK_PROPERTY, mask);
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

/**
 * Reads what `table` needs to show `file`. A cell with no annotation lies outside the `.diff`'s
 * hunks and is quiet; an annotated cell whose text differs is a mismatch.
 */
function planTable(
  table: HTMLTableElement,
  path: string,
  file: StructuralFile,
  cells: readonly ChangedCell[],
  before: Painted | undefined,
): Plan {
  const roots = cells.map(({ textRoot }) => textRoot);
  const faintBefore = before?.faint ?? noFaintRows();
  const marksBefore = before?.marks ?? new Map<HTMLElement, readonly Range[]>();
  const added: Range[] = [];
  const removed: Range[] = [];
  const quiet = new Map<Element, string>();
  const part = new Map<Element, string>();
  const marks = new Map<HTMLElement, readonly Range[]>();

  for (const cell of cells) {
    const { side, textRoot, row } = cell;
    const reading = readCell(file, cell);
    if (reading.kind === "differs") {
      const painted = { file, roots, ranges: [], faint: noFaintRows(), marks: new Map() };
      return {
        table,
        path,
        outcome: "mismatch",
        added: [],
        removed: [],
        faintBefore,
        marksBefore,
        painted,
      };
    }

    if (reading.kind === "outside" || reading.annotation.quiet) {
      markSide(quiet, row, side);
      continue;
    }

    const { annotation, text } = reading;
    const inFull = annotation.inside ? "mark" : "tint";
    const ranges = markRanges(text, annotation.ranges, inFull).flatMap(
      (columns) => rangeOf(textRoot, columns) ?? [],
    );
    if (ranges.length === 0) continue;

    (side === "old" ? removed : added).push(...ranges);
    markSide(part, row, side);
    if (textRoot instanceof HTMLElement) marks.set(textRoot, ranges);
  }

  const painted = { file, roots, ranges: [...added, ...removed], faint: { quiet, part }, marks };
  return { table, path, outcome: "painted", added, removed, faintBefore, marksBefore, painted };
}

/**
 * Paints structural mode onto the split diff tables mounted under `diffs`, and repaints after
 * GitHub re-renders them, until `signal` aborts. Paths come from the files the `sections` hook
 * lists. A file where an annotated mounted cell's text differs from its `StructuralFile` is
 * skipped whole and reported as a mismatch; a changed cell outside the `.diff`'s hunks is quiet.
 * Before each paint it re-pairs each table's changed blocks so a line faces its matching line, and
 * puts GitHub's rows back when `signal` aborts.
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
  const measured = new Map<Element, readonly Range[]>();
  // A ResizeObserver reports after layout, so measuring a mark there forces none, and it reports
  // again when a resize wraps the text another way.
  const sizes = new win.ResizeObserver((entries) => {
    const masks = entries.flatMap(({ target }) => {
      const ranges = measured.get(target);
      return ranges && target instanceof HTMLElement
        ? [[target, maskOf(boxesOf(target, ranges))] as const]
        : [];
    });
    for (const [root, mask] of masks) writeMask(root, mask);
  });
  const snapshots: PairingSnapshots = new Map();
  const reported = new Map<string, PaintOutcome>();
  let paths: ReadonlyMap<string, string> = new Map();
  let frame: number | undefined;

  /** Each mounted split table the mode has a file for. */
  const splitFiles = () =>
    diffTables(diffs).flatMap(({ table, anchor, layout }) => {
      const path = paths.get(anchor);
      const file = path === undefined ? undefined : annotationsOf(path);
      return path !== undefined && file && layout === "split" ? [{ table, path, file }] : [];
    });
  const pairTables = (tables: ReturnType<typeof splitFiles>): Set<HTMLTableElement> => {
    dropUnmounted(snapshots);
    return new Set(
      tables.flatMap(({ table, file }) => (pairTable(table, file, snapshots) ? [table] : [])),
    );
  };
  const collect = (
    tables: ReturnType<typeof splitFiles>,
    paired: ReadonlySet<HTMLTableElement>,
  ): Pass => {
    const plans: Plan[] = [];
    const fresh = new Set<HTMLTableElement>();
    for (const { table, path, file } of tables) {
      const cells = changedCells(table);
      const lastPaint = painted.get(table);
      if (!paired.has(table) && isFresh(lastPaint, file, cells)) fresh.add(table);
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
  const measure = (root: HTMLElement, ranges: readonly Range[]) => {
    measured.set(root, ranges);
    // Observed anew, so the observer reports it even at its old size.
    sizes.unobserve(root);
    sizes.observe(root);
  };
  const clearMarks = (root: HTMLElement) => {
    measured.delete(root);
    sizes.unobserve(root);
    writeMask(root, undefined);
  };
  const unmark = (table: HTMLTableElement, entry: Painted | undefined) => {
    table.removeAttribute(TABLE_ATTR);
    if (entry) writeFaintRows(entry.faint, noFaintRows());
  };
  const paint = ({
    table,
    outcome,
    added,
    removed,
    faintBefore,
    marksBefore,
    painted: entry,
  }: Plan) => {
    for (const range of added) addedHighlight.add(range);
    for (const range of removed) removedHighlight.add(range);

    if (outcome === "mismatch" && table.hasAttribute(TABLE_ATTR)) table.removeAttribute(TABLE_ATTR);
    if (outcome === "painted" && !table.hasAttribute(TABLE_ATTR))
      table.setAttribute(TABLE_ATTR, "");

    writeFaintRows(faintBefore, entry.faint);

    for (const root of marksBefore.keys()) if (!entry.marks.has(root)) clearMarks(root);
    for (const [root, ranges] of entry.marks) measure(root, ranges);

    painted.set(table, entry);
  };
  const apply = ({ plans, stale }: Pass) => {
    const planned = new Set(plans.map(({ table }) => table));
    for (const table of stale) {
      const entry = dropRanges(table);
      if (planned.has(table)) continue;
      for (const root of entry?.marks.keys() ?? []) clearMarks(root);
      if (table.isConnected) unmark(table, entry);
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
  // Past re-pairing, every read precedes every write, so painting never forces a layout between them.
  const pass = () => {
    const tables = splitFiles();
    const work = collect(tables, pairTables(tables));
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
    sizes.disconnect();

    for (const table of [...snapshots.keys()]) restoreTable(table, snapshots);
    // Also catches a table whose snapshot was dropped while it was unmounted.
    for (const element of diffs.querySelectorAll(`[${ADDED_ROW_ATTR}], [${FILLER_ATTR}]`))
      element.remove();

    // Sweeps the DOM, not `painted`: it also catches marks on a table GitHub moved since its pass.
    for (const element of diffs.querySelectorAll<HTMLElement>(
      `[${TABLE_ATTR}], [${QUIET_ATTR}], [${PART_ATTR}], [${MARKS_ATTR}]`,
    )) {
      element.removeAttribute(TABLE_ATTR);
      element.removeAttribute(QUIET_ATTR);
      element.removeAttribute(PART_ATTR);
      writeMask(element, undefined);
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
