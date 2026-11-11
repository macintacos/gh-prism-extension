// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADDED_HIGHLIGHT } from "../../../entrypoints/content/diffs/structural";
import type {
  StructuralAnswer,
  StructuralFiles,
} from "../../../entrypoints/content/diffs/structural-files";
import {
  type StructuralMode,
  showStructural,
  structuralChoiceOf,
} from "../../../entrypoints/content/diffs/structural-mode";
import { changedCells, type DiffSide } from "../../../entrypoints/content/files-page";
import type { LineAnnotation, StructuralFile } from "../../../utils/structural/changes";
import { anchorOfTable, mountDiffs, sectionsOf, tables } from "../../fixtures/diff-tables";
import prRename from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import { HighlightStub, stubHighlights } from "../../fixtures/highlights";

const flush = () => vi.advanceTimersByTimeAsync(100);

/** A fake visit's answers: records requests, and settles an answer when the test says so. */
function fakeFiles() {
  const requested: string[] = [];
  const answers = new Map<string, StructuralAnswer>();
  const listeners = new Set<() => void>();
  const files: StructuralFiles = {
    request: (paths) => void requested.push(...paths),
    answerOf: (path) => answers.get(path),
    pending: () => false,
    onAnswer(listener, signal) {
      listeners.add(listener);
      signal.addEventListener("abort", () => listeners.delete(listener));
    },
    report: () => {},
    outcomeOf: () => undefined,
  };
  const settle = (path: string, file: StructuralFile) => {
    answers.set(path, { ok: true, file });
    for (const listener of listeners) listener();
  };
  return { files, requested, settle };
}

/** `files-page-diff-rename` with its deleted rows removed, leaving an all-additions table. */
function allAdditions(): string {
  const region = document.createElement("div");
  region.innerHTML = prRename;
  for (const { side, row } of changedCells(region)) if (side === "old") row.remove();
  expect(changedCells(region).length).toBeGreaterThan(0);
  return region.innerHTML;
}

/** A file whose text is the table's own and whose every changed line has one range. */
function fileOf(table: HTMLTableElement): StructuralFile {
  const annotations: Record<DiffSide, Record<number, LineAnnotation>> = { old: {}, new: {} };
  const text: Record<DiffSide, Record<number, string>> = { old: {}, new: {} };
  for (const cell of changedCells(table)) {
    const content = cell.textRoot.textContent ?? "";
    annotations[cell.side][cell.line] = {
      quiet: false,
      ranges: [{ startCol: 0, endCol: Math.min(1, content.length) }],
    };
    text[cell.side][cell.line] = content;
  }
  return { annotations, text };
}

describe("structuralChoiceOf", () => {
  it("gives a fresh live signal when turned back on, and saves each setting", () => {
    const save = vi.fn<(on: boolean) => void>();
    const structural = structuralChoiceOf(false, save);
    const atLoad = structural.whileOn;

    structural.set(true);
    const on = structural.whileOn;
    const liveWhileOn = !on.aborted;
    structural.set(false);

    expect(atLoad.aborted).toBe(true);
    expect(liveWhileOn).toBe(true);
    expect(on.aborted).toBe(true);
    expect(structural.on).toBe(false);
    expect(save.mock.calls).toEqual([[true], [false]]);
  });
});

describe("showStructural", () => {
  let stub: ReturnType<typeof stubHighlights>;
  let visit: AbortController;
  let until: AbortController;
  let unifiedSeen: ReturnType<typeof vi.fn<() => void>>;
  let fake: ReturnType<typeof fakeFiles>;

  beforeEach(() => {
    vi.useFakeTimers();
    stub = stubHighlights();
    visit = new AbortController();
    until = new AbortController();
    unifiedSeen = vi.fn<() => void>(() => until.abort());
    fake = fakeFiles();
  });

  afterEach(() => {
    visit.abort();
    stub.restore();
    vi.useRealTimers();
  });

  const show = (diffs: HTMLElement) => {
    const mode: StructuralMode = {
      files: fake.files,
      until: until.signal,
      commit: false,
      search: () => "",
      unifiedSeen,
    };
    return showStructural({ diffs }, visit.signal, mode);
  };

  it("mounts nothing and requests nothing on a page already in Unified", async () => {
    const diffs = mountDiffs(prRename);

    const view = show(diffs);
    view.sections?.(sectionsOf(diffs), new Set());
    view.onScreen(new Set(["a.ts"]));
    await flush();

    expect(unifiedSeen).toHaveBeenCalledTimes(1);
    expect(stub.highlights.size).toBe(0);
    expect(document.head.querySelector("style")).toBeNull();
    expect(fake.requested).toEqual([]);
  });

  it("requests exactly the on-screen paths on a split page", () => {
    show(mountDiffs(prSplit)).onScreen(new Set(["a.ts", "b.ts"]));

    expect(fake.requested).toEqual(["a.ts", "b.ts"]);
  });

  it("holds requests while only a one-sided pull request table is mounted, until a split one mounts", async () => {
    const diffs = mountDiffs(allAdditions());
    show(diffs).onScreen(new Set(["a.ts"]));
    await flush();

    expect(fake.requested).toEqual([]);
    expect(unifiedSeen).not.toHaveBeenCalled();

    const region = document.createElement("div");
    region.innerHTML = prSplit;
    diffs.append(region);
    await flush();

    expect(fake.requested).toEqual(["a.ts"]);
  });

  it("paints an answer that settles with no change to the diffs", async () => {
    const diffs = mountDiffs(prSplit);
    const view = show(diffs);
    view.sections?.(sectionsOf(diffs), new Set());
    await flush();
    const table = tables(diffs)[0];
    if (!table) throw new Error("no table");

    fake.settle(anchorOfTable(table), fileOf(table));
    await flush();

    const added = stub.highlights.get(ADDED_HIGHLIGHT);
    expect(added).toBeInstanceOf(HighlightStub);
    expect((added as HighlightStub).size).toBeGreaterThan(0);
  });

  it("reports Unified once when a table turns two-sided Unified", async () => {
    const diffs = mountDiffs(prSplit);
    show(diffs);

    diffs.innerHTML = prRename;
    await flush();
    diffs.append(document.createElement("span"));
    await flush();

    expect(unifiedSeen).toHaveBeenCalledTimes(1);
  });

  it("clears its paint and stops requesting once the mode ends", async () => {
    const diffs = mountDiffs(prSplit);
    const view = show(diffs);
    view.sections?.(sectionsOf(diffs), new Set());
    const table = tables(diffs)[0];
    if (!table) throw new Error("no table");
    fake.settle(anchorOfTable(table), fileOf(table));
    await flush();

    until.abort();
    view.onScreen(new Set(["a.ts"]));
    diffs.append(document.createElement("span"));
    await flush();

    expect(stub.highlights.size).toBe(0);
    expect(document.head.querySelector("style")).toBeNull();
    expect(fake.requested).toEqual([]);
  });
});
