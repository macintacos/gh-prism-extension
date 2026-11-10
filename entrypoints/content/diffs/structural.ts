import type { ColumnRange, StructuralFile } from "@/utils/structural/changes";
import { type ChangedCell, changedCells, currentLayout, observeDiffs } from "../files-page";
import type { LandingView } from "../visit/land";
import { pathsByAnchor } from "./on-screen";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./structural.css?inline";

export type PaintOutcome = "painted" | "mismatch";

export interface StructuralPainting {
  /** What structural mode knows about `path`, or `undefined` while it knows nothing. */
  annotationsOf(path: string): StructuralFile | undefined;
  /** Called when a mounted file's outcome is first known, and again whenever it changes. */
  report(path: string, outcome: PaintOutcome): void;
}

export const ADDED_HIGHLIGHT = "gh-prism-added";
export const REMOVED_HIGHLIGHT = "gh-prism-removed";

const TABLE_ATTR = "data-gh-prism-structural";
const QUIET_ATTR = "data-gh-prism-quiet";

/** What one table holds: the file it was painted from, its cells' text roots, its ranges and quiet rows. */
interface Painted {
  readonly file: StructuralFile;
  readonly roots: readonly Element[];
  readonly ranges: readonly Range[];
  readonly quiet: ReadonlyMap<Element, string>;
}

/** The writes one table needs, read in full before any is made. */
interface Plan {
  readonly table: HTMLTableElement;
  readonly path: string;
  readonly outcome: PaintOutcome;
  readonly added: readonly Range[];
  readonly removed: readonly Range[];
  /** The quiet rows the table held before this plan. */
  readonly before: ReadonlyMap<Element, string>;
  readonly painted: Painted;
}

/** A range over `columns` of `textRoot`'s text, or `undefined` when they are empty or fall outside it. */
function rangeOf(textRoot: Element, { startCol, endCol }: ColumnRange): Range | undefined {
  const doc = textRoot.ownerDocument;
  const walker = doc.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let offset = 0;
  let started = false;
  if (startCol < 0 || startCol >= endCol) return undefined;

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
  before: ReadonlyMap<Element, string>,
): Plan {
  const roots = cells.map(({ textRoot }) => textRoot);
  const added: Range[] = [];
  const removed: Range[] = [];
  const quiet = new Map<Element, string>();

  for (const { side, line, textRoot } of cells) {
    const annotation = file.annotations[side][line];
    if (!annotation || textRoot.textContent !== file.text[side][line]) {
      const painted = { file, roots, ranges: [], quiet: new Map() };
      return { table, path, outcome: "mismatch", added: [], removed: [], before, painted };
    }
    const row = textRoot.closest("tr");
    if (annotation.quiet && row)
      quiet.set(row, quiet.has(row) ? `${quiet.get(row)} ${side}` : side);
    if (annotation.quiet) continue;
    const ranges = annotation.ranges.flatMap((columns) => rangeOf(textRoot, columns) ?? []);
    (side === "old" ? removed : added).push(...ranges);
  }

  const painted = { file, roots, ranges: [...added, ...removed], quiet };
  return { table, path, outcome: "painted", added, removed, before, painted };
}

/**
 * Paints structural mode onto the split diff tables mounted under `diffs`, and repaints after
 * GitHub re-renders them, until `signal` aborts. Paths come from the files the `sections` hook lists.
 */
export function paintStructural(
  diffs: Element,
  signal: AbortSignal,
  { annotationsOf, report }: StructuralPainting,
): LandingView {
  const doc = diffs.ownerDocument;
  const win = doc.defaultView;
  if (!win || signal.aborted) return {};

  const added = new win.Highlight();
  const removed = new win.Highlight();
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const painted = new Map<HTMLTableElement, Painted>();
  const reported = new Map<string, PaintOutcome>();
  let paths: ReadonlyMap<string, string> = new Map();
  let frame: number | undefined;

  // Every read precedes every write, so a pass never forces a layout between them.
  const collect = () => {
    const plans: Plan[] = [];
    const kept = new Set<HTMLTableElement>();
    for (const table of diffs.querySelectorAll<HTMLTableElement>("table[data-diff-anchor]")) {
      const path = paths.get(table.dataset.diffAnchor ?? "");
      const file = path === undefined ? undefined : annotationsOf(path);
      if (path === undefined || !file || currentLayout(table.parentElement ?? table) !== "split")
        continue;
      const cells = changedCells(table);
      const before = painted.get(table);
      if (isFresh(before, file, cells)) kept.add(table);
      else plans.push(planTable(table, path, file, cells, before?.quiet ?? new Map()));
    }
    return { plans, stale: [...painted.keys()].filter((table) => !kept.has(table)) };
  };
  const forget = (table: HTMLTableElement, clear: boolean) => {
    const entry = painted.get(table);
    for (const range of entry?.ranges ?? []) {
      added.delete(range);
      removed.delete(range);
    }
    painted.delete(table);
    if (!clear) return;
    table.removeAttribute(TABLE_ATTR);
    for (const row of entry?.quiet.keys() ?? []) row.removeAttribute(QUIET_ATTR);
  };
  const paint = ({
    table,
    outcome,
    added: adds,
    removed: removes,
    before,
    painted: entry,
  }: Plan) => {
    for (const range of adds) added.add(range);
    for (const range of removes) removed.add(range);
    if (outcome === "mismatch" && table.hasAttribute(TABLE_ATTR)) table.removeAttribute(TABLE_ATTR);
    if (outcome === "painted" && !table.hasAttribute(TABLE_ATTR))
      table.setAttribute(TABLE_ATTR, "");
    for (const row of before.keys())
      if (!entry.quiet.has(row) && row.hasAttribute(QUIET_ATTR)) row.removeAttribute(QUIET_ATTR);
    for (const [row, value] of entry.quiet)
      if (row.getAttribute(QUIET_ATTR) !== value) row.setAttribute(QUIET_ATTR, value);
    painted.set(table, entry);
  };
  const apply = ({ plans, stale }: ReturnType<typeof collect>) => {
    const planned = new Set(plans.map(({ table }) => table));
    for (const table of stale) forget(table, !planned.has(table) && table.isConnected);
    for (const plan of plans) paint(plan);
  };
  const reportChanged = ({ plans }: ReturnType<typeof collect>) => {
    for (const { path, outcome } of plans) {
      if (reported.get(path) === outcome) continue;
      reported.set(path, outcome);
      report(path, outcome);
    }
  };
  const pass = () => {
    const work = collect();
    apply(work);
    reportChanged(work);
  };
  const schedule = () => {
    frame ??= win.requestAnimationFrame(() => {
      frame = undefined;
      pass();
    });
  };

  doc.head.append(style);
  win.CSS.highlights.set(ADDED_HIGHLIGHT, added);
  win.CSS.highlights.set(REMOVED_HIGHLIGHT, removed);
  observeDiffs(diffs, schedule, { signal });
  signal.addEventListener("abort", () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    win.CSS.highlights.delete(ADDED_HIGHLIGHT);
    win.CSS.highlights.delete(REMOVED_HIGHLIGHT);
    for (const element of diffs.querySelectorAll(`[${TABLE_ATTR}], [${QUIET_ATTR}]`)) {
      element.removeAttribute(TABLE_ATTR);
      element.removeAttribute(QUIET_ATTR);
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
