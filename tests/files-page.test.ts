// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesPage } from "../entrypoints/content/files-page";
import {
  findFilesPage,
  isFilesPath,
  observe,
  readChangedFiles,
  watchFilesPages,
} from "../entrypoints/content/files-page";
import fixture from "./fixtures/files-page.html?raw";

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

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el;
};

beforeEach(() => {
  document.body.innerHTML = fixture;
});

describe("isFilesPath", () => {
  it.each([
    "/o/r/pull/1/changes",
    "/o/r/pull/1/changes/",
    "/o/r/pull/1/changes/04bb63f",
    "/o/r/pull/1/changes/aaa..bbb",
    "/o/r/pull/1/files",
  ])("accepts %s", (path) => expect(isFilesPath(path)).toBe(true));

  it.each([
    "/o/r/pull/1",
    "/o/r/pull/1/commits",
    "/o/r/pulls",
    "/o/r/blob/main/pull/1/changes",
    "/o/r/pull/x/changes",
    "/o/r/pull/1/changesets",
    "/o/r/tree/pull/1/changes/x",
  ])("rejects %s", (path) => expect(isFilesPath(path)).toBe(false));
});

describe("findFilesPage", () => {
  it("finds the sidebar, tree, and diff list", () => {
    expect(findFilesPage(document)).toEqual({
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

  it("exposes the row's status icon", () => {
    expect(file("src/helpers.rs").statusIcon?.classList.contains("octicon-file-moved")).toBe(true);
  });

  it("exposes the comment visual only where there are comments", () => {
    expect(
      readChangedFiles(document)
        .filter((f) => f.comments)
        .map((f) => f.path),
    ).toEqual(["src/engine.rs"]);
    expect(file("src/engine.rs").comments?.textContent).toBe("1");
  });

  it("carries the row's label and diff link", () => {
    const engine = file("src/engine.rs");
    expect(engine.label).toBe("engine.rs has 1 comment");
    expect(engine.link.getAttribute("href")).toMatch(/^#diff-/);
  });
});

describe("observe", () => {
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
    const tree = byId("src");
    observe(byId("pr-file-tree"), onChange, controller.signal);
    tree.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(10);
    tree.append(document.createElement("li"));
    await flush();
    await vi.advanceTimersByTimeAsync(49);
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("reacts to the active file changing", async () => {
    observe(byId("pr-file-tree"), onChange, controller.signal);
    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("ignores unwatched attributes", async () => {
    observe(byId("pr-file-tree"), onChange, controller.signal);
    byId("src/lib.rs").setAttribute("tabindex", "-1");
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores mutations inside the ignored node", async () => {
    const ignored = document.createElement("nav");
    byId("pr-file-tree").append(ignored);
    observe(byId("pr-file-tree"), onChange, controller.signal, ignored);
    ignored.append(document.createElement("a"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("stops once aborted", async () => {
    observe(byId("pr-file-tree"), onChange, controller.signal);
    controller.abort();
    byId("src").append(document.createElement("li"));
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("watchFilesPages", () => {
  let controller: AbortController;
  let pages: { page: FilesPage; signal: AbortSignal }[];
  const onMissing = vi.fn();
  const watch = () =>
    watchFilesPages(
      window,
      { onPage: (page, signal) => pages.push({ page, signal }), onMissing },
      controller.signal,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/o/r/pull/1/changes");
    controller = new AbortController();
    pages = [];
    onMissing.mockReset();
  });
  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("shows the page present on start once", () => {
    watch();
    vi.advanceTimersByTime(20_000);
    expect(pages).toHaveLength(1);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("reports missing markup once the settle window ends", () => {
    document.body.innerHTML = "";
    watch();
    vi.advanceTimersByTime(9_900);
    expect(onMissing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(onMissing).toHaveBeenCalledOnce();
    expect(pages).toHaveLength(0);
  });

  it("shows markup that appears during the settle window", () => {
    document.body.innerHTML = "";
    watch();
    vi.advanceTimersByTime(500);
    document.body.innerHTML = fixture;
    vi.advanceTimersByTime(20_000);
    expect(pages).toHaveLength(1);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("replaces the page after a soft navigation swaps the sidebar", () => {
    watch();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    document.dispatchEvent(new Event("soft-nav:end"));
    vi.advanceTimersByTime(20_000);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.signal.aborted).toBe(true);
    expect(pages[1]?.page.sidebar).toBe(byId("pr-file-tree"));
  });

  it("keeps the page when popstate leaves the sidebar in place", () => {
    watch();
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(20_000);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.signal.aborted).toBe(false);
  });

  it("drops the page when navigation leaves the Files tab", () => {
    watch();
    history.replaceState(null, "", "/o/r/pull/1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.advanceTimersByTime(20_000);
    expect(pages[0]?.signal.aborted).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("drops the page and goes quiet when aborted", () => {
    document.body.innerHTML = "";
    watch();
    document.body.innerHTML = fixture;
    vi.advanceTimersByTime(100);
    controller.abort();
    expect(pages[0]?.signal.aborted).toBe(true);
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    document.dispatchEvent(new Event("soft-nav:end"));
    vi.advanceTimersByTime(20_000);
    expect(pages).toHaveLength(1);
    expect(onMissing).not.toHaveBeenCalled();
  });
});
