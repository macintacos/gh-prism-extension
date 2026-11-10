// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isLineAnchor } from "../../entrypoints/content/files-page";
import commitSplit from "../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../fixtures/commit-page-diff-unified.html?raw";
import commitWhitespace from "../fixtures/commit-page-diff-whitespace.html?raw";
import prRename from "../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../fixtures/files-page-diff-split.html?raw";
import prUnified from "../fixtures/files-page-diff-unified.html?raw";

const EXPANDED_ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728eR1";

const textCells = (): HTMLTableCellElement[] => [
  ...document.querySelectorAll<HTMLTableCellElement>("td.diff-text-cell"),
];

const isChanged = (cell: HTMLTableCellElement): boolean =>
  cell.querySelector("code.diff-text.addition, code.diff-text.deletion") !== null;

const changedCells = (): HTMLTableCellElement[] => textCells().filter(isChanged);

const contextCells = (): HTMLTableCellElement[] => textCells().filter((cell) => !isChanged(cell));

const anchorParts = (cell: HTMLTableCellElement): { side?: string; line?: string } => {
  const [, side, line] = /([LR])(\d+)$/.exec(cell.dataset.lineAnchor ?? "") ?? [];
  return { side, line };
};

const cellsPerRow = (): number[] =>
  [...document.querySelectorAll("tr")].map(
    (row) => row.querySelectorAll("td.diff-text-cell").length,
  );

type Fixture = {
  name: string;
  html: string;
  page: "pull" | "commit";
  layout: "unified" | "split";
};

const FIXTURES: Fixture[] = [
  { name: "files-page-diff-unified", html: prUnified, page: "pull", layout: "unified" },
  { name: "files-page-diff-split", html: prSplit, page: "pull", layout: "split" },
  { name: "files-page-diff-rename", html: prRename, page: "pull", layout: "unified" },
  { name: "commit-page-diff-unified", html: commitUnified, page: "commit", layout: "unified" },
  { name: "commit-page-diff-split", html: commitSplit, page: "commit", layout: "split" },
  {
    name: "commit-page-diff-whitespace",
    html: commitWhitespace,
    page: "commit",
    layout: "unified",
  },
];

describe.each(FIXTURES)("$name", ({ html, page, layout }) => {
  it("anchors each changed cell to its side and line, with a marker before its text", () => {
    document.body.innerHTML = html;

    const changed = changedCells();

    expect(changed.length).toBeGreaterThan(0);
    for (const cell of changed) {
      const { side, line } = anchorParts(cell);
      const [, oldLine, newLine] =
        /-(\d+|empty)-(\d+|empty)-\d+$/.exec(cell.dataset.gridCellId ?? "") ?? [];
      const code = cell.querySelector("code.diff-text");
      expect(isLineAnchor(cell.dataset.lineAnchor ?? "")).toBe(true);
      expect(line).toBe(side === "R" ? newLine : oldLine);
      expect(side).toBe(code?.classList.contains("addition") ? "R" : "L");
      const marker = code?.firstElementChild;
      expect(marker?.matches("span.diff-text-marker")).toBe(true);
      expect(["+", "-"]).toContain(marker?.textContent);
      expect(marker?.nextElementSibling?.classList.contains("diff-text-inner")).toBe(true);
      expect(code?.childElementCount).toBe(2);
    }
  });

  it("gives context cells their text without a marker", () => {
    document.body.innerHTML = html;

    const context = contextCells();

    expect(context.length).toBeGreaterThan(0);
    for (const cell of context) {
      expect(cell.querySelector(".diff-text-inner")).not.toBeNull();
      expect(cell.querySelector("span.diff-text-marker")).toBeNull();
    }
  });

  it("holds up to as many text cells per row as its layout has sides", () => {
    document.body.innerHTML = html;

    const counts = new Set(cellsPerRow().filter(Boolean));

    const sides = layout === "split" ? 2 : 1;
    expect(counts.has(sides)).toBe(true);
    expect([...counts].every((count) => count <= sides)).toBe(true);
  });

  it("carries side and line data attributes on pull request cells only", () => {
    document.body.innerHTML = html;

    const changed = changedCells();

    for (const cell of changed) {
      const { side, line } = anchorParts(cell);
      if (page === "pull") {
        expect(cell.dataset.diffSide?.[0]?.toUpperCase()).toBe(side);
        expect(cell.dataset.lineNumber).toBe(line);
        expect(cell.dataset.diffLineKey).toBeDefined();
      } else {
        expect(cell.dataset.diffSide).toBeUndefined();
        expect(cell.dataset.lineNumber).toBeUndefined();
        expect(cell.dataset.diffLineKey).toBeUndefined();
      }
    }
  });
});

describe.each([
  { name: "files-page-diff-unified", html: prUnified },
  { name: "files-page-diff-split", html: prSplit },
])("$name review thread", ({ html }) => {
  it("mounts inside the line's text cell, after its code", () => {
    document.body.innerHTML = html;

    const thread = document.querySelector('[data-testid="review-thread"]');
    const cell = thread?.closest("td.diff-text-cell");
    const code = cell?.querySelector("code");

    expect(cell).toBeTruthy();
    expect(thread?.closest(".diff-text-inner")).toBeNull();
    expect(code && thread && code.compareDocumentPosition(thread)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("carries an expanded-context row", () => {
    document.body.innerHTML = html;

    const expanded = document.querySelector(`[data-line-anchor="${EXPANDED_ANCHOR}"]`);

    expect(expanded).not.toBeNull();
  });
});

describe("files-page-diff-rename paths", () => {
  it("names both the old and the new path", () => {
    document.body.innerHTML = prRename;

    const text = document.body.textContent;

    expect(text).toContain("src/helpers.rs");
    expect(text).toContain("src/util.rs");
  });
});
