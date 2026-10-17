// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesPage } from "../../entrypoints/content/files-page";
import {
  appendToDiffs,
  commitPage,
  coveredTop,
  diffEntryOf,
  findDiff,
  findDiffList,
  findDiffstat,
  findFilesPage,
  findTreeToggle,
  mountedDiffs,
  observeDiffs,
  observeTree,
  observeViewed,
  prPage,
  readChangedFiles,
  readViewed,
  reorderable,
  treeToggleButtonOf,
  viewedOffered,
} from "../../entrypoints/content/files-page";
import {
  byId,
  diffList,
  foundPage,
  LAUNCHER_DIFF,
  linkTo,
  loadCommitFixture,
  loadFixture,
  loadViewedCommitFilterFixture,
  loadViewedFixture,
  VIEWED_APP_TOML,
  VIEWED_CARGO_LOCK,
  VIEWED_LIB_RS,
} from "../fixtures/files-page";

const PATHS = [
  "config/app.toml",
  "docs/guide.md",
  "src/generated/schema.rs",
  "src/engine.rs",
  "src/helpers.rs",
  "src/lib.rs",
  "src/notes.rs",
  "src/parser.rs",
  "src/render.rs",
  "tests/integration.rs",
  "Cargo.lock",
  "Cargo.toml",
  "README.md",
];

const ENGINE_DIFF = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";

beforeEach(() => {
  loadFixture();
});

describe("findFilesPage", () => {
  it("finds the sidebar, tree, and diff list", () => {
    expect(findFilesPage(document)).toEqual({
      kind: prPage,
      sidebar: byId("pr-file-tree"),
      tree: document.querySelector('ul[role="tree"]'),
      diffs: document.querySelector('[data-testid="diff-content"]'),
    });
  });

  it.each([
    ["the tree", 'ul[role="tree"]'],
    ["the diff list", '[data-testid="diff-content"]'],
  ])("is undefined without %s", (_, selector) => {
    document.querySelector(selector)?.remove();
    expect(findFilesPage(document)).toBeUndefined();
  });

  it("is undefined for classic markup", () => {
    document.body.innerHTML = '<file-tree></file-tree><div data-testid="diff-content"></div>';
    expect(findFilesPage(document)).toBeUndefined();
  });
});

describe("readChangedFiles", () => {
  const file = (path: string) => {
    const found = readChangedFiles(document).find((f) => f.path === path);
    if (!found) throw new Error(`no changed file ${path}`);
    return found;
  };

  it("lists the shown files in tree order", () => {
    expect(readChangedFiles(document).map((f) => f.path)).toEqual(PATHS);
  });

  it("marks only the current file active", () => {
    expect(
      readChangedFiles(document)
        .filter((f) => f.active)
        .map((f) => f.path),
    ).toEqual(["src/lib.rs"]);
  });

  it("exposes the row's status", () => {
    expect(file("src/helpers.rs").status).toBe("renamed");
  });

  it("exposes the comment visual only where there are comments", () => {
    expect(
      readChangedFiles(document)
        .filter((f) => f.comments)
        .map((f) => f.path),
    ).toEqual(["src/engine.rs"]);
    expect(file("src/engine.rs").comments?.textContent).toBe("1");
  });

  it("carries the row's diff link", () => {
    expect(file("src/engine.rs").link.getAttribute("href")).toMatch(/^#diff-/);
  });
});

describe("observeTree", () => {
  let controller: AbortController;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    onChange.mockReset();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  // MutationObserver callbacks are microtasks; flush them before advancing timers.
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it("debounces a burst into one call after the last mutation", async () => {
    const srcRow = byId("src");
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });

    srcRow.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(10);

    srcRow.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reacts to the active file changing", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores unwatched attributes", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    byId("src/lib.rs").setAttribute("tabindex", "-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores mutations inside the ignored node", async () => {
    const ignored = document.createElement("nav");
    byId("pr-file-tree").append(ignored);
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal, ignore: ignored });
    ignored.append(document.createElement("a"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops once aborted", async () => {
    observeTree(byId("pr-file-tree"), onChange, { signal: controller.signal });
    controller.abort();
    byId("src").append(document.createElement("li"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("observeDiffs", () => {
  let controller: AbortController;
  const onChange = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    onChange.mockReset();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("calls once after a diff mounts in the list", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    diffList().append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("calls once after a diff unmounts from the list", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    byId(ENGINE_DIFF).remove();
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores attribute changes inside a diff", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    byId(ENGINE_DIFF).setAttribute("data-collapsed", "true");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops once aborted", async () => {
    observeDiffs(diffList(), onChange, { signal: controller.signal });
    controller.abort();
    diffList().append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(100);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("findDiff", () => {
  it("finds the mounted diff for a file's link", () => {
    expect(findDiff(foundPage(), linkTo("src/engine.rs"))).toBe(byId(ENGINE_DIFF));
  });

  it("is null while a file's diff is unmounted", () => {
    expect(findDiff(foundPage(), linkTo("docs/guide.md"))).toBeNull();
  });

  it("is null for a diff with the same id outside the diff list", () => {
    const stray = document.createElement("div");
    stray.id = "diff-c2a0fff5575ebf83634ea4da334a24d52775bcef6700ed6f9d0bc4e3db79e42a";
    document.body.append(stray);
    expect(findDiff(foundPage(), linkTo("src/helpers.rs"))).toBeNull();
  });
});

describe("findDiffList", () => {
  it("finds the list that holds each file's entry", () => {
    expect(findDiffList(foundPage())).toBe(byId(ENGINE_DIFF).parentElement?.parentElement);
  });
});

describe("diffEntryOf", () => {
  const entryOf = (anchor: string) => {
    const page = foundPage();
    const list = findDiffList(page);
    if (!list) throw new Error("fixture has no diff list");
    return diffEntryOf(page, list, anchor);
  };

  it("finds the list's child that holds a file's diff", () => {
    expect(entryOf(ENGINE_DIFF)).toBe(byId(ENGINE_DIFF).parentElement);
  });

  it("is null when the diff sits deeper than the list's child", () => {
    const diff = byId(ENGINE_DIFF);
    const wrapper = document.createElement("div");
    diff.replaceWith(wrapper);
    wrapper.append(diff);

    expect(entryOf(ENGINE_DIFF)).toBeNull();
  });
});

const virtualize = (page: FilesPage) => {
  page.diffs.insertAdjacentHTML("beforeend", '<div data-index="0"><div role="region"></div></div>');
};

describe("the pull request kind", () => {
  const statusOf = (path: string) =>
    readChangedFiles(document).find((f) => f.path === path)?.status;
  const toggleButton = () => {
    const button = document.querySelector('[class*="RegularTreeToggle"]');
    if (!button) throw new Error("fixture has no tree toggle");
    return button;
  };

  it("finds the header's lines-changed counter", () => {
    expect(findDiffstat(foundPage())?.textContent).toContain("+1,604");
  });

  it("finds the toolbar's tree toggle", () => {
    expect(findTreeToggle(foundPage())).toBe(toggleButton().parentElement);
  });

  it("takes the regular tree toggle as collapsing the tree in place", () => {
    expect(treeToggleButtonOf(foundPage(), toggleButton())).toBe(toggleButton());
  });

  it("does not take the narrow layout's toggle as collapsing the tree", () => {
    const narrow = document.querySelector('[class*="MobileTreeToggle"]');
    if (!narrow) throw new Error("fixture has no narrow tree toggle");
    expect(treeToggleButtonOf(foundPage(), narrow)).toBeNull();
  });

  it("selects the diff list entry holding a file's diff", () => {
    expect(document.querySelector(prPage.diffEntry(ENGINE_DIFF))).toBe(
      byId(ENGINE_DIFF).parentElement,
    );
  });

  it("selects its diff list", () => {
    expect(document.querySelector(prPage.diffList)).toBe(
      byId(ENGINE_DIFF).parentElement?.parentElement,
    );
  });

  it("selects each entry holding a diff", () => {
    expect([...document.querySelectorAll(prPage.diffEntries)]).toEqual([
      byId(ENGINE_DIFF).parentElement,
    ]);
  });

  it("reads a row's status from its octicon", () => {
    expect(statusOf("src/helpers.rs")).toBe("renamed");
    expect(statusOf("src/engine.rs")).toBe("modified");
  });

  it("is reorderable until GitHub virtualizes its diffs", () => {
    const page = foundPage();
    expect(reorderable(page)).toBe(true);
    virtualize(page);
    expect(reorderable(page)).toBe(false);
  });
});

describe("the commit kind", () => {
  const diffs = () => byId("diff-content-parent");

  beforeEach(() => {
    loadCommitFixture();
  });

  it("finds the sidebar, tree, and diff list", () => {
    expect(findFilesPage(document)).toEqual({
      kind: commitPage,
      sidebar: byId("diff_file_tree"),
      tree: document.querySelector('ul[role="tree"]'),
      diffs: diffs(),
    });
  });

  it("finds the header's lines-changed counter", () => {
    expect(findDiffstat(foundPage())?.textContent).toContain("+165");
  });

  it("finds the toolbar's tree toggle, not the copy inside the sidebar", () => {
    expect(findTreeToggle(foundPage())).toBe(
      document.querySelector('#diff-content-parent [aria-controls="diff_file_tree"]')
        ?.parentElement,
    );
  });

  it("takes the in-place toggle, not the narrow layout's, as collapsing the tree", () => {
    const [narrow, regular] = diffs().querySelectorAll('[aria-controls="diff_file_tree"]');
    if (!narrow || !regular) throw new Error("fixture has no tree toggles");
    expect(treeToggleButtonOf(foundPage(), regular)).toBe(regular);
    expect(treeToggleButtonOf(foundPage(), narrow)).toBeNull();
  });

  it("selects the diff list entry holding a file's diff", () => {
    expect(document.querySelector(commitPage.diffEntry(LAUNCHER_DIFF))).toBe(
      document.querySelector('[role="region"]')?.parentElement,
    );
  });

  it("selects its diff list", () => {
    expect(document.querySelector(commitPage.diffList)).toBe(
      document.querySelector('[role="region"]')?.parentElement?.parentElement,
    );
  });

  it("selects each entry holding a diff", () => {
    expect([...document.querySelectorAll(commitPage.diffEntries)]).toEqual(
      [...diffs().querySelectorAll('[role="region"]')].map((region) => region.parentElement),
    );
  });

  it("appends to its diff list ahead of the comments", () => {
    const node = document.createElement("div");
    appendToDiffs(foundPage(), node);
    expect(node.nextElementSibling).toBe(byId("comments"));
  });

  it("reads a row's status from its octicon", () => {
    expect(readChangedFiles(document).find((f) => f.path === "bin/caret-launcher")?.status).toBe(
      "modified",
    );
  });

  it("is reorderable until GitHub virtualizes its diffs", () => {
    const page = foundPage();
    expect(reorderable(page)).toBe(true);
    virtualize(page);
    expect(reorderable(page)).toBe(false);
  });

  it("finds a file's diff, which has no id, by its header's link", () => {
    expect(findDiff(foundPage(), linkTo("bin/caret-launcher"))).toBe(
      document.querySelector('[role="region"]'),
    );
  });

  it("finds its diff list", () => {
    expect(findDiffList(foundPage())).toBe(
      document.querySelector('[role="region"]')?.parentElement?.parentElement,
    );
  });

  it("finds the entry that holds a file's diff", () => {
    const region = document.querySelector('[role="region"]');
    const page = foundPage();
    const list = findDiffList(page);
    if (!list) throw new Error("commit fixture lacks its diff list");

    expect(diffEntryOf(page, list, LAUNCHER_DIFF)).toBe(region?.parentElement);
  });

  it("finds no diff for a file whose diff is unmounted", () => {
    expect(findDiff(foundPage(), linkTo("src/adapters/opencode/paths.ts"))).toBeNull();
  });
});

describe("mountedDiffs", () => {
  const agreesWithFindDiff = () => {
    const page = foundPage();
    const mounted = mountedDiffs(page);
    const expected = new Map(
      readChangedFiles(page.sidebar).flatMap((file) => {
        const diff = findDiff(page, file.link);
        return diff ? [[file.link.hash.slice(1), diff] as const] : [];
      }),
    );

    expect(mounted.size).toBeGreaterThan(0);
    expect(mounted).toEqual(expected);
  };

  it("keys each mounted region of a pull request by its file's anchor", () => {
    loadFixture();
    agreesWithFindDiff();
  });

  it("keys each mounted region of a commit by its file's anchor", () => {
    loadCommitFixture();
    agreesWithFindDiff();
  });
});

describe("coveredTop", () => {
  it("is the sticky file header's top", () => {
    loadFixture();
    const region = byId(ENGINE_DIFF);
    const header = document.createElement("div");
    header.className = "diffHeaderWrapper__abc";
    header.style.top = "66px";
    region.prepend(header);

    expect(coveredTop(foundPage())).toBe(66);
  });

  it("is 0 with no file header mounted", () => {
    loadFixture();
    for (const header of document.querySelectorAll('[class*="diffHeaderWrapper__"]'))
      header.remove();

    expect(coveredTop(foundPage())).toBe(0);
  });
});

const viewedToggleOf = (anchor: string): Element => {
  const toggle = byId(anchor).querySelector('button[aria-label$="Viewed"]');
  if (!toggle) throw new Error(`no Viewed toggle in #${anchor}`);
  return toggle;
};

describe("the signed-in Viewed fixtures", () => {
  it("are Files pages with diff entries", () => {
    for (const load of [loadViewedFixture, loadViewedCommitFilterFixture]) {
      load();

      expect(findFilesPage(document)?.kind).toBe(prPage);
      expect(document.querySelectorAll(prPage.diffEntries).length).toBeGreaterThan(0);
    }
  });
});

describe("readViewed", () => {
  it("reads each mounted header's Viewed toggle", () => {
    loadViewedFixture();

    expect(readViewed(foundPage())).toEqual(
      new Map([
        [VIEWED_APP_TOML, true],
        [VIEWED_LIB_RS, false],
        [VIEWED_CARGO_LOCK, false],
      ]),
    );
  });

  it("is empty on pages without Viewed toggles", () => {
    expect(readViewed(foundPage())).toEqual(new Map());

    loadViewedCommitFilterFixture();

    expect(readViewed(foundPage())).toEqual(new Map());
  });

  it("leaves out a region whose header has no toggle", () => {
    loadViewedFixture();
    viewedToggleOf(VIEWED_LIB_RS).remove();

    expect(readViewed(foundPage()).has(VIEWED_LIB_RS)).toBe(false);
  });
});

describe("viewedOffered", () => {
  const counter = () => document.querySelector('[class*="ProgressContainer__"]');

  it("decides Viewed page-wide", () => {
    loadViewedFixture();
    expect(viewedOffered(foundPage())).toBe(true);

    counter()?.remove();
    expect(viewedOffered(foundPage())).toBe(true);

    loadViewedFixture();
    for (const region of diffList().querySelectorAll('[role="region"]')) region.remove();
    expect(viewedOffered(foundPage())).toBe(true);

    loadViewedCommitFilterFixture();
    expect(viewedOffered(foundPage())).toBe(false);

    loadFixture();
    expect(viewedOffered(foundPage())).toBe(false);

    loadCommitFixture();
    expect(viewedOffered(foundPage())).toBe(false);
  });
});

describe("observeViewed", () => {
  let controller: AbortController;
  const onChange = vi.fn();
  const flip = (el: Element) =>
    el.setAttribute("aria-pressed", el.getAttribute("aria-pressed") === "true" ? "false" : "true");

  beforeEach(() => {
    loadViewedFixture();
    controller = new AbortController();
    onChange.mockReset();
    observeViewed(diffList(), onChange, { signal: controller.signal });
  });

  afterEach(() => {
    controller.abort();
  });

  it("reports a Viewed toggle flipping", async () => {
    flip(viewedToggleOf(VIEWED_APP_TOML));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalled();
  });

  it("ignores attribute changes other than a Viewed toggle", async () => {
    const segmented = byId(VIEWED_CARGO_LOCK).querySelector(
      "button[aria-pressed]:not([aria-label])",
    );
    if (!segmented) throw new Error("no segmented-control button");

    flip(segmented);
    byId(VIEWED_LIB_RS).setAttribute("data-collapsed", "true");
    const region = document.createElement("div");
    region.setAttribute("role", "region");
    diffList().append(region);
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();

    controller.abort();
    flip(viewedToggleOf(VIEWED_APP_TOML));
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });
});
