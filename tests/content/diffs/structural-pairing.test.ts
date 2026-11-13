// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paintStructural } from "../../../entrypoints/content/diffs/structural";
import { ADDED_ROW_ATTR, FILLER_ATTR } from "../../../entrypoints/content/diffs/structural-attrs";
import {
  type PairingSnapshots,
  repairTable,
  restoreTable,
} from "../../../entrypoints/content/diffs/structural-pairing";
import {
  changedCells,
  type findFilesPage,
  lineRowOfAnchor,
} from "../../../entrypoints/content/files-page";
import type { StructuralFile } from "../../../utils/structural/changes";
import { anchorOfTable, mountDiffs, sectionsOf, tableAt } from "../../fixtures/diff-tables";
import prUnified from "../../fixtures/files-page-diff-unified.html?raw";
import pairingSplit from "../../fixtures/files-page-pairing-split.html?raw";
import { stubHighlights } from "../../fixtures/highlights";
import { stubResizeObserver } from "../../fixtures/resize-observer";

// 121 `if "pk" in d:` matches 138 `if "pk" in obj:`; 126 opens `total` as 144 does.
const MATCHES = [
  { old: 121, new: 138, count: 3 },
  { old: 126, new: 144, count: 4 },
];

const fileWith = (matches?: StructuralFile["matches"]): StructuralFile => ({
  annotations: { old: {}, new: {} },
  text: { old: {}, new: {} },
  ...(matches && { matches }),
});

/** Each row's old and new line numbers, `-` for a side with none. */
const rowLines = (table: HTMLTableElement) =>
  [...table.querySelectorAll("tr.diff-line-row")].map((row) => {
    const [oldNumber, , newNumber] = row.children;
    const number = (cell: Element | undefined) => cell?.getAttribute("data-line-number") ?? "-";
    return `${number(oldNumber)}|${number(newNumber)}`;
  });

const rowsAround = (table: HTMLTableElement, from: string, count: number) => {
  const all = rowLines(table);
  const at = all.findIndex((row) => row.startsWith(`${from}|`));
  return all.slice(at, at + count);
};

const cellOf = (table: HTMLTableElement, suffix: string) => {
  const cell = table.querySelector(`td[data-line-anchor$="${suffix}"]`);
  if (!cell) throw new Error(`no ${suffix}`);
  return cell;
};

describe("repairTable", () => {
  let snapshots: PairingSnapshots;

  beforeEach(() => {
    snapshots = new Map();
  });

  it("lines a new line up opposite its matching old line, leaving the other old line opposite empty space", () => {
    const table = tableAt(mountDiffs(pairingSplit));

    repairTable(table, fileWith(MATCHES), snapshots);

    expect(rowsAround(table, "119", 4)).toEqual(["119|137", "120|-", "121|138", "122|139"]);
  });

  it("adds a row where a block needs more rows than GitHub drew", () => {
    const table = tableAt(mountDiffs(pairingSplit));

    repairTable(table, fileWith(MATCHES), snapshots);

    expect(rowsAround(table, "125", 5)).toEqual([
      "125|142",
      "-|143",
      "126|144",
      "127|-",
      "128|145",
    ]);
    expect(table.querySelectorAll(`tr[${ADDED_ROW_ATTR}]`)).toHaveLength(1);
  });

  it("keeps each side's line numbers in file order", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    repairTable(table, fileWith(MATCHES), snapshots);

    const numbers = (side: string) =>
      [...table.querySelectorAll(`td.new-diff-line-number[data-diff-side="${side}"]`)].map((cell) =>
        Number(cell.getAttribute("data-line-number")),
      );
    expect(numbers("left")).toEqual(numbers("left").toSorted((a, b) => a - b));
    expect(numbers("right")).toEqual(numbers("right").toSorted((a, b) => a - b));
  });

  it("gives created empty space no line number, anchor, or control", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    repairTable(table, fileWith(MATCHES), snapshots);

    const fillers = [...table.querySelectorAll(`[${FILLER_ATTR}]`)];
    expect(fillers.length).toBeGreaterThan(0);
    for (const filler of fillers) {
      expect(filler.matches("td.empty-diff-line")).toBe(true);
      expect(filler.hasAttribute("data-line-number")).toBe(false);
      expect(filler.hasAttribute("data-line-anchor")).toBe(false);
      expect(filler.querySelector("button")).toBeNull();
    }
  });

  it("keeps a line cell found by its anchor and as a changed cell inside an added row", () => {
    const diffs = mountDiffs(pairingSplit);
    const table = tableAt(diffs);
    repairTable(table, fileWith(MATCHES), snapshots);
    const page = { diffs } as unknown as NonNullable<ReturnType<typeof findFilesPage>>;
    const added = table.querySelector(`tr[${ADDED_ROW_ATTR}]`);

    expect(
      lineRowOfAnchor(page, cellOf(table, "L127").getAttribute("data-line-anchor") ?? ""),
    ).toBe(added);
    expect(changedCells(table).find((cell) => cell.side === "old" && cell.line === 127)?.row).toBe(
      added,
    );
  });

  it("moves a review thread with its line", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const thread = document.createElement("div");
    cellOf(table, "R138").append(thread);

    repairTable(table, fileWith(MATCHES), snapshots);

    expect(thread.closest("tr")).toBe(cellOf(table, "L121").closest("tr"));
  });

  it("changes nothing when run again on the same file", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const file = fileWith(MATCHES);
    repairTable(table, file, snapshots);
    const once = table.outerHTML;

    expect(repairTable(table, file, snapshots)).toBe(false);
    expect(table.outerHTML).toBe(once);
  });

  it("re-pairs a table that replaced its rows from scratch and drops the old snapshot", () => {
    const diffs = mountDiffs(pairingSplit);
    const file = fileWith(MATCHES);
    repairTable(tableAt(diffs), file, snapshots);
    const region = tableAt(diffs).parentElement as HTMLElement;
    region.innerHTML = pairingSplit;
    const fresh = tableAt(diffs);

    expect(repairTable(fresh, file, snapshots)).toBe(true);
    expect(rowsAround(fresh, "125", 5)).toEqual([
      "125|142",
      "-|143",
      "126|144",
      "127|-",
      "128|145",
    ]);
    expect([...snapshots.keys()]).toEqual([fresh]);
  });

  it("leaves a file with no matches as GitHub drew it", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const before = table.outerHTML;

    expect(repairTable(table, fileWith(), snapshots)).toBe(false);
    expect(table.outerHTML).toBe(before);
  });
});

describe("restoreTable", () => {
  it("restores GitHub's markup exactly, with a thread added while re-paired", () => {
    const expected = tableAt(mountDiffs(pairingSplit));
    cellOf(expected, "R138").append(Object.assign(document.createElement("div"), { id: "t" }));
    const want = expected.outerHTML;
    const table = tableAt(mountDiffs(pairingSplit));
    const snapshots: PairingSnapshots = new Map();
    repairTable(table, fileWith(MATCHES), snapshots);
    cellOf(table, "R138").append(Object.assign(document.createElement("div"), { id: "t" }));

    restoreTable(table, snapshots);

    expect(table.outerHTML).toBe(want);
    expect(snapshots.size).toBe(0);
  });
});

describe("paintStructural's re-pairing", () => {
  let controller: AbortController;
  let restoreHighlights: () => void;
  let sizes: ReturnType<typeof stubResizeObserver>;

  const paint = async (html: string, file: StructuralFile) => {
    const diffs = mountDiffs(html);
    const anchor = anchorOfTable(tableAt(diffs));
    const view = paintStructural(diffs, controller.signal, {
      annotationsOf: (path) => (path === anchor ? file : undefined),
      report: () => {},
    });
    view.sections?.(sectionsOf(diffs), new Set());
    await vi.advanceTimersByTimeAsync(100);
    return diffs;
  };

  beforeEach(() => {
    restoreHighlights = stubHighlights().restore;
    sizes = stubResizeObserver();
    vi.useFakeTimers();
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    sizes.restore();
    restoreHighlights();
  });

  it("re-pairs a split table and restores GitHub's markup on abort", async () => {
    const want = tableAt(mountDiffs(pairingSplit)).outerHTML;
    const diffs = await paint(pairingSplit, fileWith(MATCHES));
    const table = tableAt(diffs);
    expect(rowsAround(table, "120", 2)).toEqual(["120|-", "121|138"]);

    controller.abort();

    expect(table.outerHTML).toBe(want);
  });

  it("leaves a unified table as GitHub drew it", async () => {
    const want = tableAt(mountDiffs(prUnified)).outerHTML;
    const diffs = await paint(prUnified, fileWith([{ old: 1, new: 1, count: 5 }]));

    expect(tableAt(diffs).outerHTML).toBe(want);
  });
});
