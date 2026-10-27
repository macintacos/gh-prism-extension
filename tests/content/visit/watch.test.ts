// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClassicPage, FilesPage, HeaderPage } from "../../../entrypoints/content/files-page";
import {
  watchClassicPages,
  watchFilesPages,
  watchHeaderPages,
} from "../../../entrypoints/content/visit/watch";
import type { FilesRoute } from "../../../utils/github/files-route";
import type { PrRef } from "../../../utils/github/pr-ref";
import {
  byId,
  diffList,
  loadClassicFixture,
  loadCommitFixture,
  loadFixture,
} from "../../fixtures/files-page";

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

  it.each(["/o/r/pull/1/changes", "/o/r/pull/1/files"])(
    "reports missing markup at %s once the settle window ends",
    async (path) => {
      history.replaceState(null, "", path);
      document.body.innerHTML = "";
      watch();
      await vi.advanceTimersByTimeAsync(9_900);
      expect(onMissing).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(20_000);

      expect(onMissing).toHaveBeenCalledOnce();
      expect(visits).toHaveLength(0);
    },
  );

  it("reports no missing markup on a classic page, which GitHub shows in the new one's place", async () => {
    history.replaceState(null, "", "/o/r/pull/1/files");
    loadClassicFixture("");
    watch();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(onMissing).not.toHaveBeenCalled();
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
      diff: { kind: "commit", owner: "o", repo: "r", headSha: "dd95cdc" },
      commitFiltered: false,
    });
    expect(pages()[0]?.page.sidebar).toBe(byId("diff_file_tree"));
    expect(pages()[0]?.page.diffs).toBe(byId("diff-content-parent"));
  });

  it("hands each visit the route of the URL it began on", async () => {
    watch();
    expect(visits[0]?.route).toEqual({
      diff: { kind: "pr", owner: "o", repo: "r", number: 1 },
      commitFiltered: false,
    });

    history.replaceState(null, "", "/o/r/pull/1/changes/04bb63f");
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(visits[1]?.route).toEqual({
      diff: { kind: "pr", owner: "o", repo: "r", number: 1 },
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

describe("watchClassicPages", () => {
  let controller: AbortController;
  let pages: { page: ClassicPage; signal: AbortSignal }[];

  const watch = () =>
    watchClassicPages(window, (page, signal) => pages.push({ page, signal }), controller.signal);
  const navigate = async (path: string, load: () => void) => {
    history.pushState(null, "", path);
    load();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/o/r/pull/1/files");
    loadClassicFixture("");

    controller = new AbortController();
    pages = [];
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("shows the classic page present on start once", async () => {
    watch();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(pages).toHaveLength(1);
    expect(pages[0]?.page.toolbar.isConnected).toBe(true);
  });

  it("shows the classic page of one of the pull request's commits", async () => {
    history.replaceState(null, "", `/o/r/pull/1/commits/${"a".repeat(40)}`);
    watch();

    expect(pages).toHaveLength(1);
  });

  it("drops the classic page when GitHub navigates to the Conversation tab", async () => {
    watch();

    await navigate("/o/r/pull/1", () => {
      document.body.innerHTML = "<main></main>";
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.signal.aborted).toBe(true);
  });

  it("shows a classic page GitHub navigates to", async () => {
    history.replaceState(null, "", "/o/r/pull/1");
    document.body.innerHTML = "<main></main>";
    watch();

    await navigate("/o/r/pull/1/files", () => loadClassicFixture(""));

    expect(pages).toHaveLength(1);
    expect(pages[0]?.signal.aborted).toBe(false);
  });
});

describe("watchHeaderPages", () => {
  interface Visit {
    readonly pr: PrRef;
    readonly signal: AbortSignal;
    readonly pages: { page: HeaderPage; signal: AbortSignal }[];
  }

  let controller: AbortController;
  let visits: Visit[];

  const loadHeader = () => {
    document.body.innerHTML =
      '<div class="rightContentWrapper__x"><div class="d-flex">+36 -10</div></div>';
  };
  const watch = () =>
    watchHeaderPages(
      window,
      (pr, signal) => {
        const visit: Visit = { pr, signal, pages: [] };
        visits.push(visit);
        return (page, pageSignal) => visit.pages.push({ page, signal: pageSignal });
      },
      controller.signal,
    );
  const navigate = async (path: string) => {
    history.pushState(null, "", path);
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/o/r/pull/3");
    loadHeader();

    controller = new AbortController();
    visits = [];
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("shows a pull request tab's header with its pull request", () => {
    watch();

    expect(visits).toHaveLength(1);
    expect(visits[0]?.pr).toEqual({ kind: "pr", owner: "o", repo: "r", number: 3 });
    expect(visits[0]?.pages[0]?.page.slot.isConnected).toBe(true);
  });

  it("starts no visit on the Files changed tab", () => {
    history.replaceState(null, "", "/o/r/pull/3/changes");
    watch();

    expect(visits).toHaveLength(0);
  });

  it("starts a new visit when GitHub switches tabs under the same header", async () => {
    watch();

    await navigate("/o/r/pull/3/checks");

    expect(visits).toHaveLength(2);
    expect(visits[0]?.signal.aborted).toBe(true);
    expect(visits[1]?.pages).toHaveLength(1);
  });

  it("shows the header again when GitHub replaces its slot", async () => {
    watch();
    loadHeader();
    await vi.advanceTimersByTimeAsync(0);

    expect(visits).toHaveLength(1);
    expect(visits[0]?.pages).toHaveLength(2);
    expect(visits[0]?.pages[0]?.signal.aborted).toBe(true);
  });
});
