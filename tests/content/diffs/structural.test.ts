// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  ADDED_HIGHLIGHT,
  type PaintOutcome,
  paintStructural,
  REMOVED_HIGHLIGHT,
} from "../../../entrypoints/content/diffs/structural";
import {
  type ChangedCell,
  changedCells,
  type DiffSide,
} from "../../../entrypoints/content/files-page";
import type { FileSection } from "../../../entrypoints/content/visit/land";
import type { LineAnnotation, StructuralFile } from "../../../utils/structural/changes";
import commitSplit from "../../fixtures/commit-page-diff-split.html?raw";
import prRename from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import prUnified from "../../fixtures/files-page-diff-unified.html?raw";
import { HighlightStub, stubHighlights } from "../../fixtures/highlights";

const QUIET: LineAnnotation = { quiet: true };
const PAINTED = "[data-gh-prism-structural], [data-gh-prism-quiet]";

/** Mounts each fixture's table in its own region, all inside one diffs container. */
function mountDiffs(...htmls: string[]): HTMLElement {
  const diffs = document.createElement("div");
  for (const html of htmls) {
    const region = document.createElement("div");
    region.innerHTML = html;
    diffs.append(region);
  }
  document.body.replaceChildren(diffs);
  return diffs;
}

const tables = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLTableElement>("table[data-diff-anchor]"),
];

const tableAt = (root: ParentNode, index = 0): HTMLTableElement => {
  const table = tables(root)[index];
  if (!table) throw new Error(`no table ${index}`);
  return table;
};

const anchorOfTable = (table: HTMLTableElement) => table.dataset.diffAnchor ?? "";

/** One section listing each table's file, its path being the table's anchor. */
function sectionsOf(root: ParentNode): FileSection[] {
  const entries = tables(root).map((table) => {
    const link = document.createElement("a");
    link.setAttribute("href", `#${anchorOfTable(table)}`);
    const file = {
      path: anchorOfTable(table),
      link,
      active: false,
      status: undefined,
      comments: null,
    };
    return { section: "implementation", lines: undefined, file } as const;
  });
  return [{ key: "implementation", entries }];
}

/** A file whose text is the table's own and whose lines `annotate` annotates, quiet by default. */
function fileOf(
  table: HTMLTableElement,
  annotate: (cell: ChangedCell) => LineAnnotation | undefined = () => QUIET,
): StructuralFile {
  const annotations: Record<DiffSide, Record<number, LineAnnotation>> = { old: {}, new: {} };
  const text: Record<DiffSide, Record<number, string>> = { old: {}, new: {} };
  for (const cell of changedCells(table)) {
    const annotation = annotate(cell);
    if (annotation) annotations[cell.side][cell.line] = annotation;
    text[cell.side][cell.line] = cell.textRoot.textContent ?? "";
  }
  return { annotations, text };
}

const cellAt = (table: HTMLTableElement, side: DiffSide, line: number): ChangedCell => {
  const cell = changedCells(table).find((c) => c.side === side && c.line === line);
  if (!cell) throw new Error(`no ${side} ${line}`);
  return cell;
};

const sameLine = (a: ChangedCell, b: ChangedCell) => a.side === b.side && a.line === b.line;

/** A range over the first occurrence of `token` in `cell`'s text. */
const over = (cell: ChangedCell, token: string): LineAnnotation => {
  const startCol = (cell.textRoot.textContent ?? "").indexOf(token);
  if (startCol < 0) throw new Error(`no ${token}`);
  return { quiet: false, ranges: [{ startCol, endCol: startCol + token.length }] };
};

/** A range over `cell`'s first two characters, or quiet when its line is empty. */
const opening = (cell: ChangedCell): LineAnnotation => {
  const length = cell.textRoot.textContent?.length ?? 0;
  return length ? { quiet: false, ranges: [{ startCol: 0, endCol: Math.min(2, length) }] } : QUIET;
};

const rangesIn = (name: string): Range[] =>
  [...(window.CSS.highlights.get(name) ?? [])].filter(
    (range): range is Range => range instanceof Range,
  );
const textsIn = (name: string) => rangesIn(name).map(String);
const allRanges = () => [...rangesIn(ADDED_HIGHLIGHT), ...rangesIn(REMOVED_HIGHLIGHT)];

const flush = () => vi.advanceTimersByTimeAsync(100);

describe("paintStructural", () => {
  let controller: AbortController;
  let report: Mock<(path: string, outcome: PaintOutcome) => void>;
  let files: Map<string, StructuralFile>;

  const paint = (diffs: Element) => {
    const view = paintStructural(diffs, controller.signal, {
      annotationsOf: (path) => files.get(path),
      report,
    });
    view.sections?.(sectionsOf(diffs), new Set());
    return view;
  };

  /** Mounts `htmls`, gives each table `annotate`'s file, and paints them. */
  const paintFixtures = async (
    annotate: (cell: ChangedCell) => LineAnnotation | undefined,
    ...htmls: string[]
  ) => {
    const diffs = mountDiffs(...htmls);
    for (const table of tables(diffs)) files.set(anchorOfTable(table), fileOf(table, annotate));
    paint(diffs);
    await flush();
    return diffs;
  };

  let restoreHighlights: () => void;

  beforeEach(() => {
    restoreHighlights = stubHighlights().restore;
    vi.useFakeTimers();
    controller = new AbortController();
    report = vi.fn();
    files = new Map();
  });

  afterEach(() => {
    controller.abort();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreHighlights();
  });

  it("takes a painted file's paint off whole when its file stops matching the page", async () => {
    const diffs = await paintFixtures((cell) => opening(cell), prSplit);
    const table = tableAt(diffs);
    const anchor = anchorOfTable(table);
    const file = fileOf(table, (cell) => opening(cell));
    files.set(
      anchor,
      fileOf(table, (cell) => (cell.line === 20 ? QUIET : opening(cell))),
    );
    diffs.append(document.createElement("div"));
    await flush();
    expect(diffs.querySelector("[data-gh-prism-quiet]")).not.toBeNull();

    files.set(anchor, { ...file, text: { ...file.text, new: { ...file.text.new, 21: "other" } } });
    diffs.append(document.createElement("div"));
    await flush();

    expect(allRanges()).toEqual([]);
    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(report.mock.calls).toEqual([
      [anchor, "painted"],
      [anchor, "mismatch"],
    ]);
  });

  it("paints nothing when the sections arrive after abort", async () => {
    const diffs = mountDiffs(prSplit);
    files.set(anchorOfTable(tableAt(diffs)), fileOf(tableAt(diffs)));
    const view = paintStructural(diffs, controller.signal, {
      annotationsOf: (path) => files.get(path),
      report,
    });

    controller.abort();
    view.sections?.(sectionsOf(diffs), new Set());
    await flush();

    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(allRanges()).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("paints a changed token and marks the other changed rows quiet", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const line21 = cellAt(table, "new", 21);
    const token = /\w+/.exec(line21.textRoot.textContent ?? "")?.[0] ?? "";
    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) => (sameLine(cell, line21) ? over(cell, token) : QUIET)),
    );

    paint(diffs);
    await flush();

    expect(textsIn(ADDED_HIGHLIGHT)).toEqual([token]);
    expect(textsIn(REMOVED_HIGHLIGHT)).toEqual([]);
    expect(table.hasAttribute("data-gh-prism-structural")).toBe(true);
    const quiet = [20, 22, 23].map((line) => cellAt(table, "new", line).textRoot.closest("tr"));
    for (const row of quiet) expect(row?.getAttribute("data-gh-prism-quiet")).toBe("new");
  });

  it("puts each side's ranges in its own highlight, across syntax spans", async () => {
    const diffs = mountDiffs(commitSplit);
    const table = tableAt(diffs);
    const newToken = /\w+/.exec(cellAt(table, "new", 137).textRoot.textContent ?? "")?.[0] ?? "";
    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) =>
        cell.side === "old" ? over(cell, "keyof RenderLinesResponses") : over(cell, newToken),
      ),
    );

    paint(diffs);
    await flush();

    expect(textsIn(REMOVED_HIGHLIGHT)).toEqual(["keyof RenderLinesResponses"]);
    expect(textsIn(ADDED_HIGHLIGHT)).toEqual([newToken]);
  });

  it("marks a row quiet on both sides as old and new", async () => {
    const diffs = await paintFixtures(() => QUIET, commitSplit);

    const row = cellAt(tableAt(diffs), "old", 137).textRoot.closest("tr");
    expect(row?.getAttribute("data-gh-prism-quiet")).toBe("old new");
  });

  it("paints nothing before the sections list the files", async () => {
    const diffs = mountDiffs(prSplit);
    files.set(anchorOfTable(tableAt(diffs)), fileOf(tableAt(diffs)));

    paintStructural(diffs, controller.signal, { annotationsOf: (path) => files.get(path), report });
    await flush();

    expect(diffs.querySelector(PAINTED)).toBeNull();
  });

  it("leaves a table no section lists untouched", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    files.set(anchorOfTable(table), fileOf(table));
    const view = paintStructural(diffs, controller.signal, {
      annotationsOf: (path) => files.get(path),
      report,
    });

    view.sections?.([], new Set());
    await flush();

    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ["one cell's text differs", "text"],
    ["one changed cell has no annotation", "annotation"],
  ] as const)("skips the whole file when %s", async (_, broken) => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const line21 = cellAt(table, "new", 21);
    const file = fileOf(table, (cell) =>
      broken === "annotation" && sameLine(cell, line21) ? undefined : opening(cell),
    );
    const anchor = anchorOfTable(table);
    files.set(
      anchor,
      broken === "text"
        ? { ...file, text: { ...file.text, new: { ...file.text.new, 21: "other" } } }
        : file,
    );

    paint(diffs);
    await flush();

    expect(allRanges()).toEqual([]);
    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(report.mock.calls).toEqual([[anchor, "mismatch"]]);
  });

  it("ignores annotations and text for lines the table does not mount", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const file = fileOf(table);
    files.set(anchorOfTable(table), {
      annotations: { old: { 1: QUIET }, new: { ...file.annotations.new, 999: QUIET } },
      text: { old: { 1: "elsewhere" }, new: { ...file.text.new, 999: "elsewhere" } },
    });

    paint(diffs);
    await flush();

    expect(report.mock.calls).toEqual([[anchorOfTable(table), "painted"]]);
  });

  it("reports a painted file once, not again on a pass that changes nothing", async () => {
    const diffs = await paintFixtures(() => QUIET, prSplit);

    diffs.append(document.createElement("div"));
    await flush();

    expect(report.mock.calls).toEqual([[anchorOfTable(tableAt(diffs)), "painted"]]);
  });

  it("paints nothing in a unified diff", async () => {
    const diffs = await paintFixtures(() => QUIET, prUnified);

    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("paints only the four-column table beside a three-column one", async () => {
    const diffs = await paintFixtures(() => QUIET, prSplit, prRename);

    const split = tableAt(diffs, 0);
    const rename = tableAt(diffs, 1);
    expect(split.hasAttribute("data-gh-prism-structural")).toBe(true);
    expect(rename.hasAttribute("data-gh-prism-structural")).toBe(false);
    expect(rename.querySelector(PAINTED)).toBeNull();
  });

  it("repaints a table GitHub replaces", async () => {
    const diffs = await paintFixtures((cell) => opening(cell), prSplit, commitSplit);
    const before = allRanges().length;
    const table = tableAt(diffs);
    const replacement = table.cloneNode(true);
    if (!(replacement instanceof HTMLTableElement)) throw new Error("not a table");

    table.replaceWith(replacement);
    await flush();

    expect(allRanges()).toHaveLength(before);
    for (const range of allRanges()) expect(range.collapsed).toBe(false);
    expect(allRanges().some((range) => replacement.contains(range.startContainer))).toBe(true);
    expect(allRanges().some((range) => table.contains(range.startContainer))).toBe(false);
  });

  it("leaves a table GitHub adds a thread to as it was", async () => {
    const diffs = await paintFixtures((cell) => opening(cell), prSplit);
    const before = allRanges();
    const setAttribute = vi.spyOn(Element.prototype, "setAttribute");

    cellAt(tableAt(diffs), "new", 21).textRoot.closest("td")?.append(document.createElement("div"));
    await flush();

    expect(allRanges()).toEqual(before);
    for (const [index, range] of allRanges().entries()) expect(range).toBe(before[index]);
    expect(setAttribute).not.toHaveBeenCalled();
  });

  it("clears the paint in Unified and restores it back in Split", async () => {
    const diffs = await paintFixtures(() => QUIET, prSplit);
    const table = tableAt(diffs);
    const switchTableTo = (html: string) => {
      const template = document.createElement("template");
      template.innerHTML = html;
      table.innerHTML = template.content.querySelector("table")?.innerHTML ?? "";
    };
    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) => opening(cell)),
    );
    diffs.append(document.createElement("div"));
    await flush();
    const count = allRanges().length;
    expect(count).toBeGreaterThan(0);

    switchTableTo(prUnified);
    await flush();

    expect(allRanges()).toEqual([]);
    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(table.hasAttribute("data-gh-prism-structural")).toBe(false);

    switchTableTo(prSplit);
    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) => opening(cell)),
    );
    await flush();

    expect(allRanges()).toHaveLength(count);
    expect(table.hasAttribute("data-gh-prism-structural")).toBe(true);
  });

  it("repaints from a new file object without rewriting unchanged quiet rows", async () => {
    const diffs = await paintFixtures(() => QUIET, prSplit);
    const table = tableAt(diffs);
    const setAttribute = vi.spyOn(Element.prototype, "setAttribute");
    const removeAttribute = vi.spyOn(Element.prototype, "removeAttribute");
    const line21 = cellAt(table, "new", 21);

    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) => (sameLine(cell, line21) ? opening(cell) : QUIET)),
    );
    diffs.append(document.createElement("div"));
    await flush();

    expect(allRanges()).toHaveLength(1);
    const quietWrites = [...setAttribute.mock.calls, ...removeAttribute.mock.calls].filter(
      ([name]) => name === "data-gh-prism-quiet",
    );
    expect(quietWrites).toHaveLength(1);
    expect(line21.textRoot.closest("tr")?.hasAttribute("data-gh-prism-quiet")).toBe(false);
  });

  it("does not repaint from the same file object", async () => {
    const diffs = await paintFixtures((cell) => opening(cell), prSplit);
    const before = allRanges();

    diffs.append(document.createElement("div"));
    await flush();

    for (const [index, range] of allRanges().entries()) expect(range).toBe(before[index]);
  });

  it("repaints a cell whose text nodes GitHub replaces", async () => {
    const diffs = await paintFixtures((cell) => opening(cell), prSplit);
    const count = allRanges().length;
    const { textRoot } = cellAt(tableAt(diffs), "new", 21);

    textRoot.replaceChildren(document.createTextNode(textRoot.textContent ?? ""));
    // A browser collapses a range whose nodes are removed; happy-dom keeps no live ranges.
    for (const range of allRanges()) if (!range.startContainer.isConnected) range.collapse();
    await flush();

    expect(allRanges()).toHaveLength(count);
    for (const range of allRanges()) expect(range.collapsed).toBe(false);
  });

  it("drops empty, inverted, and overrunning ranges and keeps overlapping ones", async () => {
    const diffs = mountDiffs(prSplit);
    const table = tableAt(diffs);
    const line21 = cellAt(table, "new", 21);
    const length = (line21.textRoot.textContent ?? "").length;
    const ranges = [
      { startCol: 1, endCol: 1 },
      { startCol: 2, endCol: 1 },
      { startCol: 0, endCol: length + 5 },
      { startCol: 0, endCol: 2 },
      { startCol: 1, endCol: 3 },
    ];
    files.set(
      anchorOfTable(table),
      fileOf(table, (cell) => (sameLine(cell, line21) ? { quiet: false, ranges } : QUIET)),
    );

    paint(diffs);
    await flush();

    expect(rangesIn(ADDED_HIGHLIGHT)).toHaveLength(2);
  });

  it("takes every write back on abort and paints no more", async () => {
    const stylesBefore = document.head.querySelectorAll("style").length;
    const diffs = await paintFixtures(() => QUIET, prSplit);
    expect(document.head.querySelectorAll("style")).toHaveLength(stylesBefore + 1);

    controller.abort();
    diffs.append(document.createElement("div"));
    await flush();

    expect(window.CSS.highlights.has(ADDED_HIGHLIGHT)).toBe(false);
    expect(window.CSS.highlights.has(REMOVED_HIGHLIGHT)).toBe(false);
    expect(diffs.querySelector(PAINTED)).toBeNull();
    expect(document.head.querySelectorAll("style")).toHaveLength(stylesBefore);
  });

  it("touches nothing when its signal has already aborted", async () => {
    const diffs = mountDiffs(prSplit);
    files.set(anchorOfTable(tableAt(diffs)), fileOf(tableAt(diffs)));
    const stylesBefore = document.head.querySelectorAll("style").length;
    controller.abort();

    paint(diffs);
    await flush();

    expect(document.head.querySelectorAll("style")).toHaveLength(stylesBefore);
    expect(window.CSS.highlights.size).toBe(0);
    expect(diffs.querySelector(PAINTED)).toBeNull();
  });

  it("reads every table before it writes", async () => {
    const diffs = mountDiffs(prSplit, commitSplit);
    for (const table of tables(diffs))
      files.set(
        anchorOfTable(table),
        fileOf(table, (cell) => opening(cell)),
      );
    paint(diffs);
    const read = vi.spyOn(Element.prototype, "querySelectorAll");
    const writes = [
      vi.spyOn(Element.prototype, "setAttribute"),
      vi.spyOn(Element.prototype, "removeAttribute"),
      vi.spyOn(HighlightStub.prototype, "add"),
      vi.spyOn(HighlightStub.prototype, "delete"),
    ];

    await flush();

    const firstWrite = Math.min(...writes.flatMap((spy) => spy.mock.invocationCallOrder));
    expect(Number.isFinite(firstWrite)).toBe(true);
    expect(Math.max(...read.mock.invocationCallOrder)).toBeLessThan(firstWrite);
  });
});
