/**
 * Re-pairs a split table's changed blocks so each line faces its matching line, moving GitHub's
 * own cells between its rows and adding rows and empty cells where a block needs more, and puts
 * GitHub's rows back.
 */

import type { LineAnnotation, StructuralFile } from "@/utils/structural/changes";
import { type PairedRow, pairedRows } from "@/utils/structural/pairing";
import {
  addedRow,
  type BlockRow,
  type ChangedCell,
  changedBlocks,
  changedCells,
  type DiffSide,
  fillerCells,
  pageKindOf,
  type SideCells,
  sideCellsOf,
} from "../files-page";
import { ADDED_ROW_ATTR, FILLER_ATTR } from "./structural-attrs";

/**
 * What one table looked like before re-pairing: the file it was paired from, and each touched
 * GitHub row's own cells.
 */
interface Snapshot {
  readonly file: StructuralFile;
  readonly rows: readonly (readonly [HTMLTableRowElement, readonly Element[]])[];
}

/** Each re-paired table's snapshot, so its GitHub rows can be put back. */
export type PairingSnapshots = Map<HTMLTableElement, Snapshot>;

/** A block row with its cells on each side. */
interface SidedRow extends BlockRow {
  readonly sides: { readonly old: SideCells; readonly new: SideCells };
}

/** One block's rows and the rows it should show. */
interface BlockPlan {
  readonly rows: readonly SidedRow[];
  readonly paired: readonly PairedRow[];
}

/** How a mounted changed cell reads against `file`. */
export type CellReading =
  | { readonly kind: "outside" }
  | { readonly kind: "matched"; readonly annotation: LineAnnotation; readonly text: string }
  | { readonly kind: "differs" };

/**
 * Reads `cell` against `file`: `outside` when its line has no annotation, so it lies outside the
 * `.diff`'s hunks and is unchanged; `matched` when its text equals the file's; `differs` otherwise.
 */
export function readCell(file: StructuralFile, cell: ChangedCell): CellReading {
  const annotation = file.annotations[cell.side][cell.line];
  if (!annotation) return { kind: "outside" };
  const text = file.text[cell.side][cell.line];
  return text !== undefined && cell.textRoot.textContent === text
    ? { kind: "matched", annotation, text }
    : { kind: "differs" };
}

/**
 * Re-pairs `table`'s changed blocks from `file`'s matches and records how to undo it in
 * `snapshots`. Returns whether the table's rows changed. A table already paired from `file`, whose
 * rows are all still mounted, is left alone, and so is a block whose rows GitHub did not draw one
 * per line of its longer side, four cells each.
 */
export function pairTable(
  table: HTMLTableElement,
  file: StructuralFile,
  snapshots: PairingSnapshots,
): boolean {
  const before = snapshots.get(table);
  if (before?.file === file && before.rows.every(([row]) => row.isConnected)) return false;

  const undone = restoreTable(table, snapshots);
  const plans = plansOf(table, file);
  // An empty snapshot still records `file`, so a table with nothing to pair settles too.
  snapshots.set(table, {
    file,
    rows: plans.flatMap(({ rows }) => rows.map(({ row }) => [row, [...row.children]] as const)),
  });
  for (const plan of plans) writeBlock(plan);
  return undone || plans.length > 0;
}

/** Drops the snapshots of tables no longer mounted. */
export function dropUnmounted(snapshots: PairingSnapshots): void {
  for (const table of snapshots.keys()) if (!table.isConnected) snapshots.delete(table);
}

/**
 * Puts `table`'s GitHub rows back as its snapshot recorded them and removes what re-pairing added.
 * Returns whether the snapshot had moved any row.
 */
export function restoreTable(table: HTMLTableElement, snapshots: PairingSnapshots): boolean {
  const rows = snapshots.get(table)?.rows ?? [];
  for (const [row, cells] of rows) if (row.isConnected) row.replaceChildren(...cells);
  for (const added of table.querySelectorAll(`[${ADDED_ROW_ATTR}], [${FILLER_ATTR}]`))
    added.remove();
  snapshots.delete(table);
  return rows.length > 0;
}

/**
 * The blocks of `table` to re-pair, none when an annotated changed cell's text differs from
 * `file`'s. A cell outside the `.diff`'s hunks has no annotation and passes.
 */
function plansOf(table: HTMLTableElement, file: StructuralFile): BlockPlan[] {
  const { matches } = file;
  if (!matches || changedCells(table).some((cell) => readCell(file, cell).kind === "differs"))
    return [];

  return changedBlocks(table).flatMap((block) => {
    const rows = block.flatMap((row) => {
      const sides = sideCellsOf(row.row);
      return sides ? [{ ...row, sides }] : [];
    });
    const olds = block.flatMap((row) => row.old ?? []);
    const news = block.flatMap((row) => row.new ?? []);
    if (rows.length !== block.length || block.length !== Math.max(olds.length, news.length))
      return [];
    const paired = pairedRows(olds, news, matches);
    return paired ? [{ rows, paired }] : [];
  });
}

const SIDES = ["old", "new"] as const;

/**
 * Moves a block's cells into the rows `paired` lists, reusing GitHub's rows first and adding the
 * rest after them. A row that already holds its cells is left untouched.
 */
function writeBlock({ rows, paired }: BlockPlan): void {
  const lastRow = rows.at(-1)?.row;
  if (!lastRow) return;
  const doc = lastRow.ownerDocument;
  const { emptySide } = pageKindOf(lastRow);

  const byLine = { old: new Map<number, SideCells>(), new: new Map<number, SideCells>() };
  const spare = { old: new Set<SideCells>(), new: new Set<SideCells>() };
  for (const row of rows)
    for (const side of SIDES) {
      const line = row[side];
      if (line === undefined) spare[side].add(row.sides[side]);
      else byLine[side].set(line, row.sides[side]);
    }
  // A row's own empty side first, so a row that does not move keeps it.
  const cellsFor = (side: DiffSide, line: number | undefined, own: SideCells | undefined) => {
    const found = line === undefined ? undefined : byLine[side].get(line);
    if (found) return found;
    const reused = own && spare[side].has(own) ? own : spare[side].values().next().value;
    if (!reused) return fillerCells(doc, emptySide[side], FILLER_ATTR);
    spare[side].delete(reused);
    return reused;
  };

  const added = paired.slice(rows.length).map(() => addedRow(doc, ADDED_ROW_ATTR));
  lastRow.after(...added);
  const targets = [...rows, ...added.map((row) => ({ row, sides: undefined }))];
  paired.forEach((pairedRow, i) => {
    const target = targets[i];
    if (!target) return;
    const cells = [
      ...cellsFor("old", pairedRow.old, target.sides?.old),
      ...cellsFor("new", pairedRow.new, target.sides?.new),
    ];
    const { children } = target.row;
    if (children.length !== cells.length || cells.some((cell, j) => children[j] !== cell))
      target.row.replaceChildren(...cells);
  });
}
