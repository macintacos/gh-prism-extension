// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { place } from "../../../entrypoints/content/ui/place";

const MARGIN = 8;

const popoverOf = (width: number, height: number) => {
  const popover = document.createElement("div");
  Object.defineProperty(popover, "offsetWidth", { value: width });
  Object.defineProperty(popover, "offsetHeight", { value: height });
  return popover;
};

const anchorAt = (top: number) => new DOMRect(100, top, 24, 24);

const boxOf = (popover: HTMLElement) => {
  const top = parseFloat(popover.style.top);
  const maxHeight = parseFloat(popover.style.maxHeight);
  const height = Number.isNaN(maxHeight)
    ? popover.offsetHeight
    : Math.min(popover.offsetHeight, maxHeight);
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

  it.each([
    ["below", 200],
    ["above", 376],
  ])(
    "caps a popover too tall for either side to the roomier side, %s its anchor",
    (_, anchorTop) => {
      const popover = popoverOf(200, 900);
      const anchor = anchorAt(anchorTop);

      place(popover, anchor);

      const { top, bottom } = boxOf(popover);
      expect(bottom <= anchor.top || top >= anchor.bottom).toBe(true);
      expect(top).toBeGreaterThanOrEqual(MARGIN);
      expect(bottom).toBeLessThanOrEqual(600 - MARGIN);
    },
  );
});
