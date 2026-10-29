// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followHoverIntent } from "../../../entrypoints/content/ui/hover-intent";

let controller: AbortController;

beforeEach(() => {
  document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

/**
 * Follows hover intent over the page's buttons, each showing a `div` card, and returns the
 * triggers whose card's `close` ran, in order.
 */
function follow(): HTMLElement[] {
  const closed: HTMLElement[] = [];
  followHoverIntent(document, controller.signal, {
    triggerOf: (target) => target.closest("button"),
    show: (trigger) => {
      const element = document.createElement("div");
      document.body.append(element);
      return {
        element,
        close: () => {
          closed.push(trigger);
          element.remove();
        },
      };
    },
  });
  return closed;
}

const button = (id: string) => document.getElementById(id) as HTMLElement;
const focusIn = (target: Element) =>
  target.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
const pointerOver = (target: Element) =>
  target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

describe("followHoverIntent", () => {
  it("closes a card whose trigger left the document 150 ms after the pointer moves on", async () => {
    vi.useFakeTimers();
    const closed = follow();
    pointerOver(button("a"));
    await vi.advanceTimersByTimeAsync(200);
    button("a").remove();

    pointerOver(document.body);
    await vi.advanceTimersByTimeAsync(149);
    const openDuringGrace = document.querySelectorAll("div").length;
    await vi.advanceTimersByTimeAsync(1);

    expect(openDuringGrace).toBe(1);
    expect(document.querySelectorAll("div")).toHaveLength(0);
    expect(closed.map(({ id }) => id)).toEqual(["a"]);
  });

  it("leaves alone a card that closed itself when the next one opens", () => {
    const closed = follow();
    focusIn(button("a"));
    document.querySelector("div")?.remove();

    focusIn(button("b"));

    expect(closed).toEqual([]);
    expect(document.querySelectorAll("div")).toHaveLength(1);
  });
});
