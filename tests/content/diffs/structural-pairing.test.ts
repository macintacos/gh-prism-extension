// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paintStructural } from "../../../entrypoints/content/diffs/structural";
import { ADDED_ROW_ATTR, FILLER_ATTR } from "../../../entrypoints/content/diffs/structural-attrs";
import {
  dropUnmounted,
  type PairingSnapshots,
  repairTable,
  restoreTable,
} from "../../../entrypoints/content/diffs/structural-pairing";
import {
  changedCells,
  commitPage,
  fillerCells,
  type findFilesPage,
  lineRowOfAnchor,
} from "../../../entrypoints/content/files-page";
import type { StructuralFile } from "../../../utils/structural/changes";
import commitWhitespaceSplit from "../../fixtures/commit-page-diff-whitespace-split.html?raw";
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

/** A file whose text is `table`'s mounted changed lines, with `matches`. */
const fileWith = (table: HTMLTableElement, matches?: StructuralFile["matches"]): StructuralFile => {
  const text: Record<"old" | "new", Record<number, string>> = { old: {}, new: {} };
  for (const { side, line, textRoot } of changedCells(table))
    text[side][line] = textRoot.textContent ?? "";
  return { annotations: { old: {}, new: {} }, text, ...(matches && { matches }) };
};

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

    repairTable(table, fileWith(table, MATCHES), snapshots);

    expect(rowsAround(table, "119", 4)).toEqual(["119|137", "120|-", "121|138", "122|139"]);
  });

  it("adds a row where a block needs more rows than GitHub drew", () => {
    const table = tableAt(mountDiffs(pairingSplit));

    repairTable(table, fileWith(table, MATCHES), snapshots);

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
    repairTable(table, fileWith(table, MATCHES), snapshots);

    const numbers = (side: string) =>
      [...table.querySelectorAll(`td.new-diff-line-number[data-diff-side="${side}"]`)].map((cell) =>
        Number(cell.getAttribute("data-line-number")),
      );
    expect(numbers("left")).toEqual(numbers("left").toSorted((a, b) => a - b));
    expect(numbers("right")).toEqual(numbers("right").toSorted((a, b) => a - b));
  });

  it("gives created empty space no line number, anchor, or control", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    repairTable(table, fileWith(table, MATCHES), snapshots);

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
    repairTable(table, fileWith(table, MATCHES), snapshots);
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

    repairTable(table, fileWith(table, MATCHES), snapshots);

    expect(thread.closest("tr")).toBe(cellOf(table, "L121").closest("tr"));
  });

  it("changes nothing when run again on the same file", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const file = fileWith(table, MATCHES);
    repairTable(table, file, snapshots);
    const once = table.outerHTML;

    expect(repairTable(table, file, snapshots)).toBe(false);
    expect(table.outerHTML).toBe(once);
  });

  it("re-pairs a table that replaced its rows from scratch, and the old snapshot drops once unmounted", () => {
    const diffs = mountDiffs(pairingSplit);
    const file = fileWith(tableAt(diffs), MATCHES);
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
    dropUnmounted(snapshots);
    expect([...snapshots.keys()]).toEqual([fresh]);
  });

  it("leaves a file with no matches as GitHub drew it", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const before = table.outerHTML;

    expect(repairTable(table, fileWith(table), snapshots)).toBe(false);
    expect(table.outerHTML).toBe(before);
  });

  it("leaves a table whose changed text differs from its file as GitHub drew it, and settles", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const before = table.outerHTML;
    const matching = fileWith(table, MATCHES);
    const file = {
      ...matching,
      text: { ...matching.text, new: { ...matching.text.new, 138: "something else" } },
    };

    expect(repairTable(table, file, snapshots)).toBe(false);
    expect(table.outerHTML).toBe(before);
    expect(repairTable(table, file, snapshots)).toBe(false);
  });

  it("puts GitHub's rows back when the same table's file changes to one with nothing to pair", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const before = table.outerHTML;
    repairTable(table, fileWith(table, MATCHES), snapshots);

    expect(repairTable(table, fileWith(table), snapshots)).toBe(true);
    expect(table.outerHTML).toBe(before);
  });

  it("re-pairs a table that kept its element but replaced its rows", () => {
    const diffs = mountDiffs(pairingSplit);
    const table = tableAt(diffs);
    const file = fileWith(table, MATCHES);
    repairTable(table, file, snapshots);
    const github = tableAt(mountDiffs(pairingSplit));
    document.body.replaceChildren(diffs);

    table.replaceChildren(...github.children);

    expect(repairTable(table, file, snapshots)).toBe(true);
    expect(rowsAround(table, "119", 4)).toEqual(["119|137", "120|-", "121|138", "122|139"]);
    expect(table.querySelectorAll(`tr[${ADDED_ROW_ATTR}]`)).toHaveLength(1);
  });

  it("leaves a block whose row lacks a side's cells as GitHub drew it", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    const file = fileWith(table, MATCHES);
    cellOf(table, "R144").previousElementSibling?.remove();

    expect(() => repairTable(table, file, snapshots)).not.toThrow();
    expect(table.querySelectorAll(`tr[${ADDED_ROW_ATTR}]`)).toHaveLength(0);
    expect(rowsAround(table, "120", 2)).toEqual(["120|-", "121|138"]);
  });

  it("leaves a row whose cells stay put untouched", () => {
    const table = tableAt(mountDiffs(pairingSplit));
    // Context row 122|139 turned into a changed one, extending the block 120-121|138 to three rows.
    const row = cellOf(table, "R139").closest("tr");
    const [, oldCode, , newCode] = row?.children ?? [];
    const anchor = newCode?.getAttribute("data-line-anchor") ?? "";
    oldCode?.setAttribute("data-line-anchor", anchor.replace(/R139$/, "L122"));
    oldCode?.querySelector("code")?.classList.add("deletion");
    newCode?.querySelector("code")?.classList.add("addition");
    const file = fileWith(table, [
      { old: 121, new: 138, count: 3 },
      { old: 122, new: 139, count: 3 },
    ]);
    const watcher = new MutationObserver(() => {});
    if (row) watcher.observe(row, { childList: true });

    repairTable(table, file, snapshots);

    expect(rowsAround(table, "120", 3)).toEqual(["120|-", "121|138", "122|139"]);
    expect(watcher.takeRecords()).toEqual([]);
  });
});

describe("fillerCells", () => {
  it("shapes a commit page's empty old side like GitHub's, divider included, with no grid id", () => {
    const github = [
      ...tableAt(mountDiffs(commitWhitespaceSplit)).querySelectorAll("td.empty-diff-line"),
    ];

    const filler = fillerCells(document, commitPage.emptySide.old, FILLER_ATTR);

    expect(filler.map((cell) => cell.className)).toEqual(github.map((cell) => cell.className));
    for (const [i, cell] of filler.entries()) {
      expect(cell.getAttribute("style")).toBe(github[i]?.getAttribute("style"));
      expect(cell.getAttribute("valign")).toBe("top");
      expect(cell.hasAttribute("data-grid-cell-id")).toBe(false);
      expect(cell.hasAttribute(FILLER_ATTR)).toBe(true);
    }
  });
});

describe("restoreTable", () => {
  it("restores GitHub's markup exactly, with a thread added while re-paired", () => {
    const expected = tableAt(mountDiffs(pairingSplit));
    cellOf(expected, "R138").append(Object.assign(document.createElement("div"), { id: "t" }));
    const want = expected.outerHTML;
    const table = tableAt(mountDiffs(pairingSplit));
    const snapshots: PairingSnapshots = new Map();
    repairTable(table, fileWith(table, MATCHES), snapshots);
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

  const paint = async (html: string, matches: StructuralFile["matches"]) => {
    const diffs = mountDiffs(html);
    const anchor = anchorOfTable(tableAt(diffs));
    const file = fileWith(tableAt(diffs), matches);
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
    const diffs = await paint(pairingSplit, MATCHES);
    const table = tableAt(diffs);
    expect(rowsAround(table, "120", 2)).toEqual(["120|-", "121|138"]);

    controller.abort();

    expect(table.outerHTML).toBe(want);
  });

  it("ends on GitHub's Unified rows, with nothing gh-prism added, when Unified replaces a re-paired table's rows", async () => {
    const unified = tableAt(mountDiffs(prUnified));
    const want = unified.innerHTML;
    const diffs = await paint(pairingSplit, MATCHES);
    const table = tableAt(diffs);

    table.replaceChildren(...unified.children);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();

    expect(table.innerHTML).toBe(want);
    expect(diffs.querySelectorAll(`[${ADDED_ROW_ATTR}], [${FILLER_ATTR}]`)).toHaveLength(0);
  });

  it("leaves a unified table as GitHub drew it", async () => {
    const want = tableAt(mountDiffs(prUnified)).outerHTML;
    const diffs = await paint(prUnified, [{ old: 1, new: 1, count: 5 }]);

    expect(tableAt(diffs).outerHTML).toBe(want);
  });
});
