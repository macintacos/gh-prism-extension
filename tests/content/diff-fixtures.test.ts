// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { changedCells } from "../../entrypoints/content/files-page";
import commitSplit from "../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../fixtures/commit-page-diff-unified.html?raw";
import commitWhitespace from "../fixtures/commit-page-diff-whitespace.html?raw";
import prRename from "../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../fixtures/files-page-diff-split.html?raw";
import prUnified from "../fixtures/files-page-diff-unified.html?raw";

const EXPANDED_ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728eR1";

const cellsPerRow = (): number[] =>
  [...document.querySelectorAll("tr")].map(
    (row) => row.querySelectorAll("td.diff-text-cell").length,
  );

const sideAndLine = (root: ParentNode): string[] =>
  changedCells(root).map(({ side, line }) => `${side} ${line}`);

type Fixture = {
  name: string;
  html: string;
  layout: "unified" | "split";
  expected: string[];
};

const PR_EXPECTED = ["new 20", "new 21", "new 22", "new 23"];
const RENAME_EXPECTED = ["old 14", "new 14"];

const FIXTURES: Fixture[] = [
  { name: "files-page-diff-unified", html: prUnified, layout: "unified", expected: PR_EXPECTED },
  { name: "files-page-diff-split", html: prSplit, layout: "split", expected: PR_EXPECTED },
  { name: "files-page-diff-rename", html: prRename, layout: "unified", expected: RENAME_EXPECTED },
  {
    name: "commit-page-diff-unified",
    html: commitUnified,
    layout: "unified",
    expected: ["old 137", "new 137"],
  },
  {
    name: "commit-page-diff-split",
    html: commitSplit,
    layout: "split",
    expected: ["old 137", "new 137"],
  },
  {
    name: "commit-page-diff-whitespace",
    html: commitWhitespace,
    layout: "unified",
    expected: ["old 144", "new 144", "new 145"],
  },
];

describe.each(FIXTURES)("$name", ({ html, layout, expected }) => {
  it("yields each changed cell's side and line in document order", () => {
    document.body.innerHTML = html;

    expect(sideAndLine(document)).toEqual(expected);
  });

  it("gives each changed cell's code text without its marker", () => {
    document.body.innerHTML = html;

    for (const cell of changedCells(document)) {
      const marker = cell.side === "new" ? "+" : "-";
      expect(cell.textRoot.parentElement?.textContent).toBe(
        `${marker}${cell.textRoot.textContent}`,
      );
    }
  });

  it("leaves hunk headers out", () => {
    document.body.innerHTML = html;

    for (const cell of changedCells(document)) {
      expect(cell.textRoot.textContent?.startsWith("@@")).toBe(false);
    }
  });

  it("holds up to as many text cells per row as its layout has sides", () => {
    document.body.innerHTML = html;

    const counts = new Set(cellsPerRow().filter(Boolean));

    const sides = layout === "split" ? 2 : 1;
    expect(counts.has(sides)).toBe(true);
    expect([...counts].every((count) => count <= sides)).toBe(true);
  });
});

describe.each([
  { name: "files-page-diff-unified", html: prUnified },
  { name: "files-page-diff-split", html: prSplit },
])("$name review thread", ({ html }) => {
  it("sits in the line's cell but outside its code text", () => {
    document.body.innerHTML = html;

    const cell = changedCells(document).find(({ side, line }) => side === "new" && line === 22);

    expect(cell?.textRoot.closest("td")?.textContent).toContain("Comment on line");
    expect(cell?.textRoot.textContent).not.toContain("Comment on line");
  });

  it("carries an expanded-context row", () => {
    expect(html.includes(EXPANDED_ANCHOR)).toBe(true);
  });
});

describe("changedCells scoped to a root", () => {
  it("yields only that root's cells", () => {
    document.body.innerHTML = prRename + commitWhitespace;

    const [table] = document.querySelectorAll("table");

    expect(table && sideAndLine(table)).toEqual(RENAME_EXPECTED);
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
