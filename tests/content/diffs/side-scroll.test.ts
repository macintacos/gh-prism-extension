// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followSideScroll, sideReach } from "../../../entrypoints/content/diffs/side-scroll";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import { stubResizeObserver } from "../../fixtures/resize-observer";

describe("sideReach", () => {
  it("returns each side's largest overflow", () => {
    const reach = sideReach([
      { side: "old", end: 500, room: 300 },
      { side: "old", end: 350, room: 300 },
      { side: "new", end: 420, room: 400 },
    ]);

    expect(reach).toEqual({ old: 200, new: 20 });
  });

  it("returns 0 for a side whose lines all fit", () => {
    expect(sideReach([{ side: "new", end: 200, room: 300 }])).toEqual({ old: 0, new: 0 });
  });
});

describe("followSideScroll", () => {
  const REACH_PROPS = ["--gh-prism-reach-old", "--gh-prism-reach-new", "--gh-prism-reach"];
  let controller: AbortController;
  let observer: ReturnType<typeof stubResizeObserver>;
  let page: { diffs: HTMLElement };

  /** Mounts a file's split table in its own box under the page's diffs, and returns the box. */
  function mountFile(): HTMLElement {
    const box = document.createElement("div");
    box.innerHTML = prSplit;
    page.diffs.append(box);
    return box;
  }

  /**
   * Lays every line of `box` out `width` wide in code `room` wide that starts `codeLeft` into its
   * cell; happy-dom lays nothing out.
   */
  function layOut(
    box: HTMLElement,
    { width, room, codeLeft = 0 }: { width: number; room: number; codeLeft?: number },
  ) {
    for (const inner of box.querySelectorAll(".diff-text-inner"))
      Object.defineProperty(inner, "offsetWidth", { configurable: true, value: width });
    for (const code of box.querySelectorAll("td.diff-text-cell > code.diff-text")) {
      Object.defineProperty(code, "offsetLeft", { configurable: true, value: codeLeft });
      Object.defineProperty(code, "clientWidth", { configurable: true, value: room });
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    observer = stubResizeObserver();

    controller = new AbortController();

    document.body.innerHTML = "";
    page = { diffs: document.body.appendChild(document.createElement("div")) };
  });

  afterEach(() => {
    controller.abort();
    observer.restore();
    vi.useRealTimers();
  });

  it("writes a box's scroll offset as --gh-prism-x", () => {
    const box = mountFile();
    followSideScroll(page, controller.signal);

    box.scrollLeft = 40;
    box.dispatchEvent(new Event("scroll"));

    expect(box.style.getPropertyValue("--gh-prism-x")).toBe("40px");
  });

  it("writes each side's reach and the larger of them once a table is measured", () => {
    const box = mountFile();
    layOut(box, { width: 500, room: 300 });
    followSideScroll(page, controller.signal);

    observer.deliver();

    expect(REACH_PROPS.map((prop) => box.style.getPropertyValue(prop))).toEqual([
      "200px",
      "200px",
      "200px",
    ]);
  });

  it("measures a line's reach past its code's right edge, not its cell's", () => {
    const box = mountFile();
    layOut(box, { width: 500, room: 280, codeLeft: 20 });
    followSideScroll(page, controller.signal);

    observer.deliver();

    expect(box.style.getPropertyValue("--gh-prism-reach")).toBe("200px");
  });

  it("measures a table that mounts later", async () => {
    followSideScroll(page, controller.signal);
    const box = mountFile();
    layOut(box, { width: 350, room: 300 });

    await vi.advanceTimersByTimeAsync(50);
    observer.deliver();

    expect(box.style.getPropertyValue("--gh-prism-reach")).toBe("50px");
  });

  it("skips a table that left its box before it was measured, and measures the rest", () => {
    const gone = mountFile();
    const box = mountFile();
    layOut(box, { width: 500, room: 300 });
    followSideScroll(page, controller.signal);

    gone.querySelector("table")?.remove();
    observer.deliver();

    expect(box.style.getPropertyValue("--gh-prism-reach")).toBe("200px");
    expect(() => controller.abort()).not.toThrow();
  });

  it("removes every property it wrote once aborted", () => {
    const box = mountFile();
    layOut(box, { width: 500, room: 300 });
    followSideScroll(page, controller.signal);
    observer.deliver();
    box.scrollLeft = 40;
    box.dispatchEvent(new Event("scroll"));

    controller.abort();

    expect(box.getAttribute("style") ?? "").toBe("");
  });
});
