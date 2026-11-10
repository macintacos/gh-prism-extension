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

const changedCells = (): HTMLTableCellElement[] =>
  [...document.querySelectorAll<HTMLTableCellElement>("td.diff-text-cell")].filter((cell) =>
    cell.querySelector("code.diff-text.addition, code.diff-text.deletion"),
  );

const cellsPerRow = (): number[] =>
  [...document.querySelectorAll("tr")].map(
    (row) => row.querySelectorAll("td.diff-text-cell").length,
  );

const FIXTURES = [
  { name: "files-page-diff-unified", html: prUnified, cells: 1 },
  { name: "files-page-diff-split", html: prSplit, cells: 2 },
  { name: "files-page-diff-rename", html: prRename, cells: 1 },
  { name: "commit-page-diff-unified", html: commitUnified, cells: 1 },
  { name: "commit-page-diff-split", html: commitSplit, cells: 2 },
  { name: "commit-page-diff-whitespace", html: commitWhitespace, cells: 1 },
];

describe.each(FIXTURES)("$name", ({ html, cells }) => {
  it("anchors each changed cell to its side and line, with a marker before its text", () => {
    document.body.innerHTML = html;

    const changed = changedCells();

    expect(changed.length).toBeGreaterThan(0);
    for (const cell of changed) {
      const anchor = cell.dataset.lineAnchor ?? "";
      const [, side, line] = /([LR])(\d+)$/.exec(anchor) ?? [];
      const [, left, right] =
        /-(\d+|empty)-(\d+|empty)-\d+$/.exec(cell.dataset.gridCellId ?? "") ?? [];
      const code = cell.querySelector("code.diff-text");
      expect(isLineAnchor(anchor)).toBe(true);
      expect(line).toBe(side === "R" ? right : left);
      expect(side).toBe(code?.classList.contains("addition") ? "R" : "L");
      const marker = code?.firstElementChild;
      expect(marker?.matches("span.diff-text-marker")).toBe(true);
      expect(["+", "-"]).toContain(marker?.textContent);
      expect(marker?.nextElementSibling?.classList.contains("diff-text-inner")).toBe(true);
    }
  });

  it("gives context cells their text without a marker", () => {
    document.body.innerHTML = html;

    const changed = new Set(changedCells());
    const context = [...document.querySelectorAll("td.diff-text-cell")].filter(
      (cell) => !changed.has(cell as HTMLTableCellElement) && cell.querySelector("code"),
    );

    expect(context.length).toBeGreaterThan(0);
    for (const cell of context) {
      expect(cell.querySelector(".diff-text-inner")).not.toBeNull();
      expect(cell.querySelector("span.diff-text-marker")).toBeNull();
    }
  });

  it("holds as many text cells per row as its layout has sides", () => {
    document.body.innerHTML = html;

    expect(Math.max(...cellsPerRow())).toBe(cells);
  });
});

describe.each([
  { name: "files-page-diff-unified", html: prUnified },
  { name: "files-page-diff-split", html: prSplit },
])("$name", ({ html }) => {
  it("carries a mounted review thread and an expanded-context row", () => {
    document.body.innerHTML = html;

    expect(document.querySelector('[data-testid="review-thread"]')).not.toBeNull();
    expect(document.querySelector(`[data-line-anchor="${EXPANDED_ANCHOR}"]`)).not.toBeNull();
  });
});

describe("files-page-diff-rename", () => {
  it("names both the old and the new path", () => {
    document.body.innerHTML = prRename;

    expect(document.body.textContent).toContain("src/helpers.rs");
    expect(document.body.textContent).toContain("src/util.rs");
  });
});
