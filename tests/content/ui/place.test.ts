// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { place } from "../../../entrypoints/content/ui/place";

const MARGIN = 8;

/** A popover whose padding and border add `chrome` to its content's height. */
const popoverOf = (width: number, height: number, chrome = 0) => {
  const popover = document.createElement("div");
  Object.defineProperty(popover, "offsetWidth", { value: width });
  Object.defineProperty(popover, "offsetHeight", { value: height });
  // happy-dom has no layout; its computed height is the inline one.
  popover.style.height = `${height - chrome}px`;
  document.body.append(popover);
  return popover;
};

const anchorAt = (top: number) => new DOMRect(100, top, 24, 24);

const boxOf = (popover: HTMLElement) => {
  const top = parseFloat(popover.style.top);
  const contentHeight = parseFloat(popover.style.height);
  const maxHeight = parseFloat(popover.style.maxHeight);
  const height = Number.isNaN(maxHeight)
    ? popover.offsetHeight
    : Math.min(popover.offsetHeight, popover.offsetHeight - contentHeight + maxHeight);
  return { top, bottom: top + height };
};

describe("place", () => {
  beforeEach(() => {
    Object.assign(window, { innerWidth: 1000, innerHeight: 600 });
  });

  it("puts a popover that fits below its anchor there", () => {
    const popover = popoverOf(200, 100);

    place(popover, anchorAt(50));

    expect(boxOf(popover)).toEqual({ top: 74, bottom: 174 });
  });

  it("puts a popover that fits only above its anchor there", () => {
    const popover = popoverOf(200, 100);

    place(popover, anchorAt(550));

    expect(boxOf(popover)).toEqual({ top: 450, bottom: 550 });
  });

  it("keeps a popover below an anchor near the viewport's top inside the margin", () => {
    const popover = popoverOf(200, 100);

    place(popover, anchorAt(-30));

    expect(boxOf(popover).top).toBe(MARGIN);
  });

  it.each([
    ["below", 200],
    ["above", 376],
  ])(
    "caps a padded popover too tall for either side to the roomier side, %s its anchor",
    (_, anchorTop) => {
      const popover = popoverOf(200, 900, 24);
      const anchor = anchorAt(anchorTop);

      place(popover, anchor);

      const { top, bottom } = boxOf(popover);
      expect(bottom <= anchor.top || top >= anchor.bottom).toBe(true);
      expect(top).toBeGreaterThanOrEqual(MARGIN);
      expect(bottom).toBeLessThanOrEqual(600 - MARGIN);
    },
  );
});
