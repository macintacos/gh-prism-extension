// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { readChangedFiles } from "../entrypoints/content/files-page";
import { revealDiff, revealDiffLine } from "../entrypoints/content/reveal";
import {
  byId,
  diffList,
  foundPage,
  LAUNCHER_DIFF,
  linkTo,
  loadCommitFixture,
  loadFixture,
} from "./fixtures/files-page";

beforeEach(() => {
  loadFixture();
});

describe("a commit page", () => {
  const diffs = () => byId("diff-content-parent");

  beforeEach(() => {
    loadCommitFixture();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("revealDiff", () => {
    const hashes: string[] = [];
    // happy-dom also fires hashchange, a tick late, whenever replaceState changes the hash.
    const record = (event: Event) => {
      const ours = vi.mocked(HashChangeEvent).mock.results.some(({ value }) => value === event);
      if (ours) hashes.push(location.hash);
    };
    let controller: AbortController;
    const reveal = () =>
      revealDiff(foundPage(), linkTo("bin/caret-launcher"), { signal: controller.signal });

    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(globalThis, "HashChangeEvent");
      controller = new AbortController();
      hashes.length = 0;
      window.addEventListener("hashchange", record);
    });
    afterEach(() => {
      window.removeEventListener("hashchange", record);
      vi.useRealTimers();
    });

    it("moves to the file through the URL hash, as GitHub's own code does, without clicking", () => {
      history.replaceState(null, "", "/o/r/commit/dd95cdc");
      const click = vi.spyOn(linkTo("bin/caret-launcher"), "click");
      reveal();
      expect(click).not.toHaveBeenCalled();
      expect(hashes).toEqual([`#${LAUNCHER_DIFF}`]);
    });

    it("announces a file that is already current as left, then as current again", async () => {
      history.replaceState(null, "", `/o/r/commit/dd95cdc#${LAUNCHER_DIFF}`);
      reveal();
      expect(hashes).toEqual([""]);
      await vi.advanceTimersByTimeAsync(0);
      expect(hashes).toEqual(["", `#${LAUNCHER_DIFF}`]);
    });

    it("leaves a current file unannounced once aborted", async () => {
      history.replaceState(null, "", `/o/r/commit/dd95cdc#${LAUNCHER_DIFF}`);
      reveal();
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(hashes).toEqual([""]);
    });
  });

  describe("revealDiffLine", () => {
    const TEST_DIFF = "diff-82c5c25448a4281c960791601a713d5cb4cdd326f9ff5eab9f9d5bf29a093de4";
    const PATHS_DIFF = "diff-0a35d3bd6fe9cd61f0a4676516db89e8d48cbf49c1b5a23558940a12dd076647";
    const rows = (anchor: string, ...lines: number[]) =>
      `<table>${lines.map((n) => `<tr><td data-line-anchor="${anchor}R${n}">${n}</td></tr>`).join("")}</table>`;
    let scrollIntoView: MockInstance<Element["scrollIntoView"]>;
    const reveal = (path: string, line: number) =>
      revealDiffLine(foundPage(), linkTo(path), line, { signal: new AbortController().signal });

    beforeEach(() => {
      vi.useFakeTimers();
      scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
      vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("scrolls to the row anchored on the file's link", async () => {
      await reveal("bin/caret-launcher", 31);
      expect(scrollIntoView.mock.contexts).toEqual([
        document.querySelector(`[data-line-anchor="${LAUNCHER_DIFF}R31"]`)?.closest("tr"),
      ]);
    });

    it("loads a hidden diff through its Load diff button, then scrolls", async () => {
      const region = document.querySelector(`[role="region"]:has(a[href="#${TEST_DIFF}"])`);
      const load = [...(region?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Load diff",
      );
      load?.addEventListener("click", () => {
        setTimeout(() => region?.insertAdjacentHTML("beforeend", rows(TEST_DIFF, 5)), 100);
      });
      const done = reveal("test/core/commands/install/launcher.test.ts", 5);
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(scrollIntoView.mock.contexts).toEqual([region?.querySelector("tr")]);
    });

    it("mounts an unmounted diff through the URL hash, without clicking, then scrolls", async () => {
      history.replaceState(null, "", "/o/r/commit/dd95cdc");
      const click = vi.spyOn(linkTo("src/adapters/opencode/paths.ts"), "click");
      // GitHub mounts a virtualized diff once the hash names it.
      const mount = () =>
        diffs().insertAdjacentHTML(
          "beforeend",
          `<div role="region"><div><h3><a href="#${PATHS_DIFF}">paths.ts</a></h3></div>${rows(PATHS_DIFF, 187)}</div>`,
        );
      window.addEventListener("hashchange", mount, { once: true });
      const done = reveal("src/adapters/opencode/paths.ts", 187);
      await vi.advanceTimersByTimeAsync(1_000);
      await done;
      expect(click).not.toHaveBeenCalled();
      expect(location.hash).toBe(`#${PATHS_DIFF}`);
      expect(scrollIntoView.mock.contexts).toEqual([
        document.querySelector(`[data-line-anchor="${PATHS_DIFF}R187"]`)?.closest("tr"),
      ]);
    });
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
  const reveal = () => revealDiff(foundPage(), engineLink(), { signal: controller.signal });
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
    revealDiffLine(foundPage(), guideLink(), line, { signal: controller.signal });
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
