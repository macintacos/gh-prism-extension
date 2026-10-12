// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesPage } from "../entrypoints/content/files-page";
import { watchFilesPages } from "../entrypoints/content/visit-watch";
import type { FilesRoute } from "../utils/files-route";
import { byId, diffList, foundPage, loadCommitFixture, loadFixture } from "./fixtures/files-page";

beforeEach(() => {
  loadFixture();
});

describe("watchFilesPages", () => {
  interface Visit {
    readonly route: FilesRoute;
    readonly signal: AbortSignal;
    readonly pages: { page: FilesPage; signal: AbortSignal }[];
  }
  let controller: AbortController;
  let visits: Visit[];
  const pages = () => visits.flatMap((visit) => visit.pages);
  const onMissing = vi.fn();
  const watch = () =>
    watchFilesPages(
      window,
      {
        onVisit: (route, signal) => {
          const visit: Visit = { route, signal, pages: [] };
          visits.push(visit);
          return (page, pageSignal) => visit.pages.push({ page, signal: pageSignal });
        },
        onMissing,
      },
      controller.signal,
    );
  const swapSidebar = () => {
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
  };
  // Runs the MutationObserver's pending microtask, and no timer.
  const afterMutations = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/o/r/pull/1/changes");
    controller = new AbortController();
    visits = [];
    onMissing.mockReset();
  });
  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("shows the page present on start once", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits).toHaveLength(1);
    expect(pages()).toHaveLength(1);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("reports missing markup once the settle window ends", async () => {
    document.body.innerHTML = "";
    watch();
    await vi.advanceTimersByTimeAsync(9_900);
    expect(onMissing).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onMissing).toHaveBeenCalledOnce();
    expect(visits).toHaveLength(0);
  });

  it("shows markup the moment it appears during the settle window", async () => {
    document.body.innerHTML = "";
    watch();
    await vi.advanceTimersByTimeAsync(500);
    loadFixture();
    await afterMutations();
    expect(pages()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("follows a sidebar GitHub swaps in on its own, before the next frame", async () => {
    watch();
    swapSidebar();
    await afterMutations();
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(pages()[1]?.page.sidebar).toBe(byId("pr-file-tree"));
  });

  it("keeps the visit going while GitHub swaps its markup", async () => {
    watch();
    swapSidebar();
    await afterMutations();
    byId("pr-file-tree").remove();
    await afterMutations();
    loadFixture();
    await afterMutations();
    expect(visits).toHaveLength(1);
    expect(visits[0]?.signal.aborted).toBe(false);
    expect(visits[0]?.pages).toHaveLength(3);
  });

  it("replaces the page after a soft navigation swaps the sidebar", async () => {
    watch();
    swapSidebar();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(pages()[1]?.page.sidebar).toBe(byId("pr-file-tree"));
  });

  it("starts a new visit when the pathname changes under the same markup", async () => {
    watch();
    history.replaceState(null, "", "/o/r/pull/1/changes/04bb63f");
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits).toHaveLength(2);
    expect(visits[0]?.signal.aborted).toBe(true);
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
  });

  it("shows a commit page with the commit's route", async () => {
    loadCommitFixture();
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    watch();
    expect(visits[0]?.route).toEqual({
      diff: { owner: "o", repo: "r", headSha: "dd95cdc" },
      commitFiltered: false,
    });
    expect(pages()[0]?.page.sidebar).toBe(byId("diff_file_tree"));
    expect(pages()[0]?.page.diffs).toBe(byId("diff-content-parent"));
  });

  it("hands each visit the route of the URL it began on", async () => {
    watch();
    expect(visits[0]?.route).toEqual({
      diff: { owner: "o", repo: "r", number: 1 },
      commitFiltered: false,
    });
    history.replaceState(null, "", "/o/r/pull/1/changes/04bb63f");
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits[1]?.route).toEqual({
      diff: { owner: "o", repo: "r", number: 1 },
      commitFiltered: true,
    });
  });

  it("keeps the visit and page when only the hash changes", async () => {
    watch();
    history.replaceState(null, "", "/o/r/pull/1/changes#diff-abc");
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits).toHaveLength(1);
    expect(pages()).toHaveLength(1);
    expect(pages()[0]?.signal.aborted).toBe(false);
  });

  it("keeps the page when popstate leaves the sidebar in place", async () => {
    watch();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pages()).toHaveLength(1);
    expect(pages()[0]?.signal.aborted).toBe(false);
  });

  it("follows a sidebar swapped in after popstate fires", async () => {
    watch();
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(200);
    swapSidebar();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
  });

  it("shows the page again when only the diff list is replaced", async () => {
    watch();
    const diffs = diffList();
    diffs.replaceWith(diffs.cloneNode(true));
    await afterMutations();
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(pages()[1]?.page.diffs).toBe(diffList());
  });

  // Hydrating a commit page, React re-renders the sidebar's contents in place, dropping the view.
  it("shows the page again when only the tree is replaced", async () => {
    watch();
    const tree = document.querySelector('ul[role="tree"]');
    tree?.replaceWith(tree.cloneNode(true));
    await afterMutations();
    expect(pages()).toHaveLength(2);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(pages()[1]?.page.tree).toBe(document.querySelector('ul[role="tree"]'));
  });

  it("drops a page whose sidebar is removed with no replacement", async () => {
    watch();
    byId("pr-file-tree").remove();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it("reports missing markup once per watcher, however many navigations follow", async () => {
    document.body.innerHTML = "";
    watch();
    await vi.advanceTimersByTimeAsync(20_000);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it("ends the visit and drops its page when navigation leaves the Files tab", async () => {
    watch();
    history.replaceState(null, "", "/o/r/pull/1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits[0]?.signal.aborted).toBe(true);
    expect(pages()[0]?.signal.aborted).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
  });

  it("ends the visit, drops its page, and goes quiet when aborted", async () => {
    document.body.innerHTML = "";
    watch();
    loadFixture();
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(visits[0]?.signal.aborted).toBe(true);
    expect(pages()[0]?.signal.aborted).toBe(true);
    swapSidebar();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(pages()).toHaveLength(1);
    expect(onMissing).not.toHaveBeenCalled();
  });
});
