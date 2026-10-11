// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { FilesPage, FilesRoute } from "../entrypoints/content/files-page";
import {
  findDiff,
  findFilesPage,
  isFilesPath,
  observeDiffs,
  observeTree,
  readChangedFiles,
  readFilesRoute,
  revealDiff,
  revealDiffLine,
  watchFilesPages,
} from "../entrypoints/content/files-page";
import { byId, loadFixture } from "./fixtures/files-page";

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

const diffList = () => {
  const diffs = document.querySelector('[data-testid="diff-content"]');
  if (!diffs) throw new Error("fixture has no diff list");
  return diffs;
};

const ENGINE_DIFF = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";

beforeEach(() => {
  loadFixture();
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

describe("readFilesRoute", () => {
  const pr = { owner: "o", repo: "r", number: 3 };

  it.each(["/o/r/pull/3/changes", "/o/r/pull/3/changes/", "/o/r/pull/3/files"])(
    "reads the whole pull request from %s",
    (path) => expect(readFilesRoute(path)).toEqual({ pr, commitFiltered: false }),
  );

  it.each(["/o/r/pull/3/changes/04bb63f", "/o/r/pull/3/changes/aaa..bbb"])(
    "reads a commit filter from %s",
    (path) => expect(readFilesRoute(path)).toEqual({ pr, commitFiltered: true }),
  );

  it.each(["/o/r/pull/3", "/o/r/issues/3"])("is undefined off the Files changed tab: %s", (path) =>
    expect(readFilesRoute(path)).toBeUndefined(),
  );
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
  const linkTo = (path: string) => {
    const found = readChangedFiles(document).find((f) => f.path === path);
    if (!found) throw new Error(`no changed file ${path}`);
    return found.link;
  };

  it("finds the mounted diff for a file's link", () => {
    expect(findDiff(diffList(), linkTo("src/engine.rs"))).toBe(byId(ENGINE_DIFF));
  });

  it("is null while a file's diff is unmounted", () => {
    expect(findDiff(diffList(), linkTo("docs/guide.md"))).toBeNull();
  });

  it("is null for a diff with the same id outside the diff list", () => {
    const stray = document.createElement("div");
    stray.id = "diff-c2a0fff5575ebf83634ea4da334a24d52775bcef6700ed6f9d0bc4e3db79e42a";
    document.body.append(stray);
    expect(findDiff(diffList(), linkTo("src/helpers.rs"))).toBeNull();
  });
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

  it("hands each visit the route of the URL it began on", async () => {
    watch();
    expect(visits[0]?.route).toEqual({
      pr: { owner: "o", repo: "r", number: 1 },
      commitFiltered: false,
    });
    history.replaceState(null, "", "/o/r/pull/1/changes/04bb63f");
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(visits[1]?.route).toEqual({
      pr: { owner: "o", repo: "r", number: 1 },
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

/** Sets the media feature happy-dom reports for `prefers-reduced-motion`. */
function preferReducedMotion(preference: "reduce" | "no-preference"): void {
  const { happyDOM } = window as unknown as {
    happyDOM: { settings: { device: { prefersReducedMotion: string } } };
  };
  happyDOM.settings.device.prefersReducedMotion = preference;
}

describe("revealDiff", () => {
  let controller: AbortController;
  let scrollTo: MockInstance<(options: ScrollToOptions) => void>;

  const engineLink = () => {
    const found = readChangedFiles(document).find((f) => f.path === "src/engine.rs");
    if (!found) throw new Error("no changed file src/engine.rs");
    return found.link;
  };
  /**
   * Stands in for GitHub's handler: it jumps the window to `top` in an animation frame it
   * requests during the click. Its focus() on the diff's region does nothing: the region has no
   * tabindex.
   */
  const landOnClick = (top: number) =>
    vi.spyOn(engineLink(), "click").mockImplementation(() => {
      requestAnimationFrame(() => {
        document.documentElement.scrollTop = top;
      });
    });
  const reveal = () => revealDiff(engineLink(), { signal: controller.signal });
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  beforeEach(() => {
    controller = new AbortController();
    window.innerHeight = 800;
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  });
  afterEach(() => {
    controller.abort();
    preferReducedMotion("no-preference");
    vi.restoreAllMocks();
  });

  it.each([
    { way: "down", from: 0, rewind: 4600 },
    { way: "up", from: 9000, rewind: 5400 },
  ])(
    "jumps $way to half a viewport short of GitHub's landing, then glides in",
    async ({ from, rewind }) => {
      document.documentElement.scrollTop = from;
      landOnClick(5000);
      reveal();
      await nextFrame();
      expect(scrollTo.mock.calls).toEqual([
        [{ top: rewind, behavior: "instant" }],
        [{ top: 5000, behavior: "smooth" }],
      ]);
    },
  );

  it("glides the whole way to a landing within half a viewport", async () => {
    document.documentElement.scrollTop = 4800;
    landOnClick(5000);
    reveal();
    await nextFrame();
    expect(scrollTo.mock.calls).toEqual([
      [{ top: 4800, behavior: "instant" }],
      [{ top: 5000, behavior: "smooth" }],
    ]);
  });

  it("leaves GitHub's jump alone when the system asks for reduced motion", async () => {
    preferReducedMotion("reduce");
    landOnClick(5000);
    reveal();
    await nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(5000);
  });

  it("does not glide once aborted before GitHub lands", async () => {
    landOnClick(5000);
    reveal();
    controller.abort();
    await nextFrame();
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("revealDiffLine", () => {
  // guide.md's tree link: the fixture lists the file but mounts no diff for it.
  const GUIDE_DIFF = "diff-0a02";
  const FILE_HEADER = '<div><button type="button">Viewed</button></div>';
  const EXPAND_TOGGLE =
    '<button type="button"><svg class="octicon octicon-chevron-right"></svg>Expand</button>';

  let controller: AbortController;
  let scrollIntoView: MockInstance<Element["scrollIntoView"]>;
  let scrollTo: MockInstance<(options: ScrollToOptions) => void>;

  const guideLink = () => {
    const found = readChangedFiles(document).find((f) => f.path === "docs/guide.md");
    if (!found) throw new Error("no changed file docs/guide.md");
    return found.link;
  };
  const guideRegion = () => document.getElementById(GUIDE_DIFF);
  const diffRows = (...lines: number[]) =>
    `<table>${lines
      .map((n) => `<tr><td data-line-anchor="${GUIDE_DIFF}R${n}">${n}</td></tr>`)
      .join("")}</table>`;
  const mountGuideDiff = (inner: string) => {
    const region = document.createElement("div");
    region.id = GUIDE_DIFF;
    region.innerHTML = inner;
    diffList().append(region);
    return region;
  };
  const buttonNamed = (root: ParentNode, label: string) => {
    const found = [...root.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button named ${label}`);
    return found;
  };
  const reveal = (line: number) =>
    revealDiffLine(diffList(), guideLink(), line, { signal: controller.signal });
  const expectScrolledTo = (row: Element | null | undefined) => {
    expect(scrollIntoView.mock.contexts).toHaveLength(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(row);
  };
  // Long enough for the debounced mount checks, short of the five-second give-up.
  const elapse = () => vi.advanceTimersByTimeAsync(1_000);

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    document.documentElement.scrollTop = 0;
    window.innerHeight = 800;
  });
  afterEach(async () => {
    vi.advanceTimersToNextFrame(); // a click's glide waits one frame
    // A late mutation schedules a timer only if an observer outlived the case.
    diffList().append(document.createElement("div"));
    await vi.advanceTimersByTimeAsync(0);
    const pending = vi.getTimerCount();
    controller.abort();
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(pending).toBe(0);
  });

  it("scrolls a mounted diff's line row to the centre without clicking the file link", async () => {
    const region = mountGuideDiff(FILE_HEADER + diffRows(2, 3));
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    await reveal(3);
    expect(click).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
    expectScrolledTo(region.querySelectorAll("tr")[1]);
  });

  it("glides the last half viewport to the line's row", async () => {
    mountGuideDiff(FILE_HEADER + diffRows(2, 3));
    scrollIntoView.mockImplementation(() => {
      document.documentElement.scrollTop = 3000;
    });
    await reveal(3);
    expect(scrollTo.mock.calls).toEqual([
      [{ top: 2600, behavior: "instant" }],
      [{ top: 3000, behavior: "smooth" }],
    ]);
  });

  it("scrolls the hunk-header row when it and the first line both carry the line's anchor", async () => {
    const region = mountGuideDiff(
      `${FILE_HEADER}<table><tr><td data-line-anchor="${GUIDE_DIFF}R2">@@ -2,7 +2,7 @@</td></tr><tr><td data-line-anchor="${GUIDE_DIFF}R2">2</td></tr></table>`,
    );
    await reveal(2);
    expectScrolledTo(region.querySelectorAll("tr")[0]);
  });

  it("scrolls once the diff mounts during the click, without waiting out the timeout", async () => {
    const click = vi
      .spyOn(guideLink(), "click")
      .mockImplementation(() => mountGuideDiff(diffRows(2)));
    await reveal(2);
    expect(click).toHaveBeenCalledOnce();
    expectScrolledTo(guideRegion()?.querySelector("tr"));
  });

  it("scrolls once the diff mounts a tick after the click", async () => {
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {
      setTimeout(() => mountGuideDiff(diffRows(2)), 100);
    });
    const done = reveal(2);
    await elapse();
    await done;
    expect(click).toHaveBeenCalledOnce();
    expectScrolledTo(guideRegion()?.querySelector("tr"));
  });

  it("gives up on a diff that never mounts: clicks the file link once and scrolls nothing", async () => {
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(click).toHaveBeenCalledOnce();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("gives up on a load that never adds rows: clicks the file link once and scrolls nothing", async () => {
    const region = mountGuideDiff(
      `${FILE_HEADER}<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>`,
    );
    const load = vi.fn();
    buttonNamed(region, "Load Diff").addEventListener("click", load);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(load).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("finds a row that arrives under constant churn when the timeout fires", async () => {
    const region = mountGuideDiff(
      `${FILE_HEADER}<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>`,
    );
    let churn: ReturnType<typeof setInterval> | undefined;
    buttonNamed(region, "Load Diff").addEventListener("click", () => {
      setTimeout(() => region.insertAdjacentHTML("beforeend", diffRows(2)), 100);
      churn = setInterval(() => diffList().append(document.createElement("i")), 40);
    });
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    clearInterval(churn);
    expect(click).not.toHaveBeenCalled();
    expectScrolledTo(region.querySelector("tr"));
  });

  it("expands a collapsed diff through its header's first button, then scrolls the row", async () => {
    const region = mountGuideDiff(
      `<div>${EXPAND_TOGGLE}<button type="button">Viewed</button></div>`,
    );
    const expand = vi.fn(() => {
      setTimeout(() => region.insertAdjacentHTML("beforeend", diffRows(2)), 100);
    });
    const viewed = vi.fn();
    buttonNamed(region, "Expand").addEventListener("click", expand);
    buttonNamed(region, "Viewed").addEventListener("click", viewed);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await elapse();
    await done;
    expect(expand).toHaveBeenCalledOnce();
    expect(viewed).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expectScrolledTo(region.querySelector("tr"));
  });

  it("does not click the toggle of a header-only diff whose chevron shows it open", async () => {
    const region = mountGuideDiff(
      '<div><button type="button"><svg class="octicon octicon-chevron-down"></svg>Collapse file</button></div>',
    );
    const toggle = vi.fn();
    buttonNamed(region, "Collapse file").addEventListener("click", toggle);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(toggle).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });

  it("loads an unloaded diff through its Load Diff button, not its other buttons, then scrolls", async () => {
    const region = mountGuideDiff(
      `${FILE_HEADER}<div class="HiddenDiffPatch-module__x"><button type="button">Show more</button><button type="button">Load Diff</button></div>`,
    );
    const load = vi.fn(() => {
      setTimeout(() => region.insertAdjacentHTML("beforeend", diffRows(2)), 100);
    });
    const others = vi.fn();
    buttonNamed(region, "Load Diff").addEventListener("click", load);
    buttonNamed(region, "Viewed").addEventListener("click", others);
    buttonNamed(region, "Show more").addEventListener("click", others);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    await elapse();
    await done;
    expect(load).toHaveBeenCalledOnce();
    expect(others).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expectScrolledTo(region.querySelector("tr"));
  });

  it("expands a collapsed diff whose expansion shows a Load Diff placeholder, then loads and scrolls", async () => {
    const region = mountGuideDiff(`<div>${EXPAND_TOGGLE}</div>`);
    const steps: string[] = [];
    buttonNamed(region, "Expand").addEventListener("click", () => {
      steps.push("expand");
      setTimeout(() => {
        region.insertAdjacentHTML(
          "beforeend",
          '<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>',
        );
        buttonNamed(region, "Load Diff").addEventListener("click", () => {
          steps.push("load");
          setTimeout(() => region.insertAdjacentHTML("beforeend", diffRows(2)), 100);
        });
      }, 100);
    });
    const done = reveal(2);
    await elapse();
    await done;
    expect(steps).toEqual(["expand", "load"]);
    expectScrolledTo(region.querySelector("tr"));
  });

  it("falls back to the file's header when the expanded and loaded diff lacks the line", async () => {
    const region = mountGuideDiff(FILE_HEADER + diffRows(2, 3));
    const viewed = vi.fn();
    buttonNamed(region, "Viewed").addEventListener("click", viewed);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    await reveal(9);
    expect(click).toHaveBeenCalledOnce();
    expect(viewed).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves no later click or scroll once aborted while waiting for a mount", async () => {
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    controller.abort();
    await done;
    mountGuideDiff(diffRows(2));
    await elapse();
    expect(click).toHaveBeenCalledOnce();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves no later click or scroll once aborted while waiting for an expansion", async () => {
    const region = mountGuideDiff(`<div>${EXPAND_TOGGLE}</div>`);
    const load = vi.fn();
    buttonNamed(region, "Expand").addEventListener("click", () => {
      setTimeout(() => {
        region.insertAdjacentHTML(
          "beforeend",
          '<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>',
        );
        buttonNamed(region, "Load Diff").addEventListener("click", load);
      }, 100);
    });
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    controller.abort();
    await done;
    await elapse();
    expect(load).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves no later click or scroll once aborted as an expansion settles", async () => {
    const region = mountGuideDiff(`<div>${EXPAND_TOGGLE}</div>`);
    const load = vi.fn();
    buttonNamed(region, "Expand").addEventListener("click", () => {
      region.insertAdjacentHTML(
        "beforeend",
        '<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>',
      );
      buttonNamed(region, "Load Diff").addEventListener("click", load);
    });
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    controller.abort();
    await done;
    expect(load).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves no later click or scroll once aborted while waiting for a load", async () => {
    const region = mountGuideDiff(
      `${FILE_HEADER}<div class="HiddenDiffPatch-module__x"><button type="button">Load Diff</button></div>`,
    );
    const load = vi.fn();
    buttonNamed(region, "Load Diff").addEventListener("click", load);
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    const done = reveal(2);
    controller.abort();
    await done;
    region.insertAdjacentHTML("beforeend", diffRows(2));
    await elapse();
    expect(load).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("neither clicks nor scrolls when the signal is already aborted", async () => {
    const click = vi.spyOn(guideLink(), "click").mockImplementation(() => {});
    controller.abort();
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(click).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    await done;
  });

  it("releases its timers when a click aborts the signal while waiting for a diff", async () => {
    vi.spyOn(guideLink(), "click").mockImplementation(() => controller.abort());
    const done = reveal(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await done;
  });
});
