// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { followSideScroll, sideReach } from "../../../entrypoints/content/diffs/side-scroll";
import type { FilesPage } from "../../../entrypoints/content/files-page";
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
  let page: FilesPage;

  /** Mounts a file's split table in its own box under the page's diffs, and returns the box. */
  function mountFile(): HTMLElement {
    const box = document.createElement("div");
    box.innerHTML = prSplit;
    page.diffs.append(box);
    return box;
  }

  /** Lays every line of `box` out `width` wide in cells `room` wide; happy-dom lays nothing out. */
  function layOut(box: HTMLElement, { width, room }: { width: number; room: number }) {
    for (const inner of box.querySelectorAll(".diff-text-inner"))
      Object.defineProperty(inner, "offsetWidth", { configurable: true, value: width });
    for (const cell of box.querySelectorAll("td.diff-text-cell"))
      Object.defineProperty(cell, "clientWidth", { configurable: true, value: room });
  }

  beforeEach(() => {
    observer = stubResizeObserver();

    controller = new AbortController();

    document.body.innerHTML = "<div></div>";
    page = { diffs: document.body.firstElementChild } as unknown as FilesPage;
  });

  afterEach(() => {
    controller.abort();
    observer.restore();
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

  it("measures a table that mounts later", async () => {
    followSideScroll(page, controller.signal);
    const box = mountFile();
    layOut(box, { width: 350, room: 300 });

    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.deliver();

    expect(box.style.getPropertyValue("--gh-prism-reach")).toBe("50px");
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
