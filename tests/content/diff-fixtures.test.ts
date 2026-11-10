// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  changedCells,
  currentLayout,
  type DiffLayout,
  followLayout,
} from "../../entrypoints/content/files-page";
import commitSplit from "../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../fixtures/commit-page-diff-unified.html?raw";
import commitWhitespace from "../fixtures/commit-page-diff-whitespace.html?raw";
import commitWhitespaceSplit from "../fixtures/commit-page-diff-whitespace-split.html?raw";
import prRename from "../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../fixtures/files-page-diff-split.html?raw";
import prUnified from "../fixtures/files-page-diff-unified.html?raw";

const EXPANDED_ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728eR1";

const sideAndLine = (root: ParentNode): string[] =>
  changedCells(root).map(({ side, line }) => `${side} ${line}`);

type Fixture = {
  name: string;
  html: string;
  layout: DiffLayout;
  expected: string[];
};

const PR_EXPECTED = ["new 20", "new 21", "new 22", "new 23"];
const RENAME_EXPECTED = ["old 14", "new 14"];
const COMMIT_EXPECTED = ["old 137", "new 137"];

const FIXTURES: Fixture[] = [
  { name: "files-page-diff-unified", html: prUnified, layout: "unified", expected: PR_EXPECTED },
  { name: "files-page-diff-split", html: prSplit, layout: "split", expected: PR_EXPECTED },
  { name: "files-page-diff-rename", html: prRename, layout: "unified", expected: RENAME_EXPECTED },
  {
    name: "commit-page-diff-unified",
    html: commitUnified,
    layout: "unified",
    expected: COMMIT_EXPECTED,
  },
  {
    name: "commit-page-diff-split",
    html: commitSplit,
    layout: "split",
    expected: COMMIT_EXPECTED,
  },
  {
    name: "commit-page-diff-whitespace",
    html: commitWhitespace,
    layout: "unified",
    expected: ["old 144", "new 144", "new 145"],
  },
  {
    name: "commit-page-diff-whitespace-split",
    html: commitWhitespaceSplit,
    layout: "split",
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

  it("reads its layout", () => {
    document.body.innerHTML = html;

    expect(currentLayout(document)).toBe(layout);
  });
});

describe("currentLayout", () => {
  afterEach(() => {
    history.replaceState(null, "", location.pathname);
  });

  it.each([
    { name: "files-page-diff-split", html: prSplit, query: "?diff=unified", layout: "split" },
    { name: "commit-page-diff-split", html: commitSplit, query: "?diff=unified", layout: "split" },
    { name: "files-page-diff-unified", html: prUnified, query: "?diff=split", layout: "unified" },
    {
      name: "commit-page-diff-unified",
      html: commitUnified,
      query: "?diff=split",
      layout: "unified",
    },
  ])("reads $name as $layout under $query", ({ html, query, layout }) => {
    history.replaceState(null, "", query);
    document.body.innerHTML = html;

    expect(currentLayout(document)).toBe(layout);
  });

  it("reads split when any mounted table is split", () => {
    document.body.innerHTML = prRename + prSplit;

    expect(currentLayout(document)).toBe("split");
  });

  it("reads nothing while no diff is mounted", () => {
    document.body.innerHTML = "";

    expect(currentLayout(document)).toBeUndefined();
  });
});

describe("followLayout", () => {
  let controller: AbortController;
  let onChange: Mock<(layout: DiffLayout) => void>;

  const follow = () => followLayout(document.body, onChange, { signal: controller.signal });

  const switchTableTo = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const table = document.querySelector("table");
    if (table) table.innerHTML = template.content.querySelector("table")?.innerHTML ?? "";
  };

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    onChange = vi.fn();
  });

  afterEach(() => {
    controller.abort();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("reports the layout already on the page", () => {
    document.body.innerHTML = commitUnified;

    follow();

    expect(onChange.mock.calls).toEqual([["unified"]]);
  });

  it("reports the layout once a diff mounts", async () => {
    document.body.innerHTML = "";
    follow();
    expect(onChange).not.toHaveBeenCalled();

    document.body.innerHTML = commitSplit;
    await vi.advanceTimersByTimeAsync(50);

    expect(onChange.mock.calls).toEqual([["split"]]);
  });

  it("reports a switch inside a kept table", async () => {
    document.body.innerHTML = commitUnified;
    follow();

    switchTableTo(commitSplit);
    await vi.advanceTimersByTimeAsync(50);

    expect(onChange.mock.calls.flat()).toEqual(["unified", "split"]);
  });

  it("stays quiet when rows change but the layout does not", async () => {
    document.body.innerHTML = commitUnified;
    follow();

    document.body.innerHTML = commitUnified;
    await vi.advanceTimersByTimeAsync(50);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the last layout while no diff is mounted", async () => {
    document.body.innerHTML = commitUnified;
    follow();

    document.body.innerHTML = "";
    await vi.advanceTimersByTimeAsync(50);
    expect(onChange).toHaveBeenCalledTimes(1);

    document.body.innerHTML = commitUnified;
    await vi.advanceTimersByTimeAsync(50);
    expect(onChange).toHaveBeenCalledTimes(1);

    document.body.innerHTML = commitSplit;
    await vi.advanceTimersByTimeAsync(50);
    expect(onChange.mock.calls.flat()).toEqual(["unified", "split"]);
  });

  it("stops reporting once its signal aborts", async () => {
    document.body.innerHTML = commitUnified;
    follow();
    controller.abort();

    switchTableTo(commitSplit);
    await vi.advanceTimersByTimeAsync(50);

    expect(onChange).toHaveBeenCalledTimes(1);
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

  it("yields no cell from its expanded-context rows", () => {
    document.body.innerHTML = html;

    expect(html.includes(EXPANDED_ANCHOR)).toBe(true);
    expect(changedCells(document).filter(({ line }) => line >= 1 && line <= 15)).toEqual([]);
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
