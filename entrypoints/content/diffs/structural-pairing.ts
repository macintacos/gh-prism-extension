import type { StructuralFile } from "@/utils/structural/changes";
import { type PairedRow, pairedRows } from "@/utils/structural/pairing";
import {
  addedRow,
  type ChangedBlock,
  changedBlocks,
  fillerCells,
  type SideCells,
  sideCellsOf,
} from "../files-page";
import { ADDED_ROW_ATTR, FILLER_ATTR } from "./structural-attrs";

/** What one table looked like before re-pairing: the file it was paired from, and each touched GitHub row's own cells. */
interface Snapshot {
  readonly file: StructuralFile;
  readonly rows: readonly (readonly [HTMLTableRowElement, readonly Element[]])[];
}

/** Each re-paired table's snapshot, so its GitHub rows can be put back. */
export type PairingSnapshots = Map<HTMLTableElement, Snapshot>;

/**
 * Re-pairs `table`'s changed blocks so each line faces its matching line, from `file`'s matches,
 * and records how to undo it in `snapshots`. Returns whether the table's rows changed. A table
 * already paired from `file`, whose rows are all still mounted, is left alone; snapshots of tables
 * no longer mounted are dropped.
 */
export function repairTable(
  table: HTMLTableElement,
  file: StructuralFile,
  snapshots: PairingSnapshots,
): boolean {
  for (const stale of snapshots.keys()) if (!stale.isConnected) snapshots.delete(stale);

  const before = snapshots.get(table);
  if (before?.file === file && before.rows.every(([row]) => row.isConnected)) return false;
  const undone = before !== undefined && before.rows.length > 0;
  if (before) restoreTable(table, snapshots);

  const { matches } = file;
  const plans = matches
    ? changedBlocks(table).flatMap((block) => {
        const rows = pairedRows(block.olds, block.news, matches);
        return rows ? [{ block, rows }] : [];
      })
    : [];
  const rows = plans.flatMap(({ block }) => block.rows);
  snapshots.set(table, { file, rows: rows.map((row) => [row, [...row.children]] as const) });
  for (const { block, rows: paired } of plans) writeBlock(block, paired);
  return undone || plans.length > 0;
}

/** Puts `table`'s GitHub rows back as its snapshot recorded them and removes what re-pairing added. */
export function restoreTable(table: HTMLTableElement, snapshots: PairingSnapshots): void {
  for (const [row, cells] of snapshots.get(table)?.rows ?? [])
    if (row.isConnected) row.replaceChildren(...cells);
  for (const added of table.querySelectorAll(`[${ADDED_ROW_ATTR}], [${FILLER_ATTR}]`))
    added.remove();
  snapshots.delete(table);
}

/** Moves `block`'s cells into the rows `paired` lists, reusing GitHub's rows first and adding the rest after them. */
function writeBlock(block: ChangedBlock, paired: readonly PairedRow[]): void {
  const doc = block.rows[0]?.ownerDocument;
  const last = block.rows.at(-1);
  if (!doc || !last) return;

  const old = new Map<number, SideCells>();
  const fresh = new Map<number, SideCells>();
  const spare: SideCells[] = [];
  block.rows.forEach((row, i) => {
    const sides = sideCellsOf(row);
    const { old: oldLine, new: newLine } = block.lines[i] ?? {};
    if (oldLine === undefined) spare.push(sides.old);
    else old.set(oldLine, sides.old);
    if (newLine === undefined) spare.push(sides.new);
    else fresh.set(newLine, sides.new);
  });
  const empty = () => spare.pop() ?? fillerCells(doc, FILLER_ATTR);

  const added = paired.slice(block.rows.length).map(() => addedRow(doc, ADDED_ROW_ATTR));
  last.after(...added);
  [...block.rows, ...added].forEach((row, i) => {
    const want = paired[i];
    const oldCells = (want?.old !== undefined && old.get(want.old)) || empty();
    const newCells = (want?.new !== undefined && fresh.get(want.new)) || empty();
    row.replaceChildren(...oldCells, ...newCells);
  });
}
