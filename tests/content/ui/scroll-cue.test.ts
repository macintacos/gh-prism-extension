// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollCue } from "../../../entrypoints/content/ui/scroll-cue";

const prefersReducedMotion = (preference: string) => {
  const { happyDOM } = window as unknown as {
    happyDOM: { settings: { device: { prefersReducedMotion: string } } };
  };
  happyDOM.settings.device.prefersReducedMotion = preference;
};

function mount(layout: { clientHeight: number; scrollHeight?: number }, ...content: Node[]) {
  const cue = scrollCue(document, ...content);
  document.body.replaceChildren(cue);
  const list = cue.querySelector<HTMLElement>(".gh-prism-scroll-cue-list");
  const arrow = cue.querySelector<HTMLButtonElement>("button");
  if (!list || !arrow) throw new Error("cue lacks its list or arrow");
  Object.defineProperty(list, "clientHeight", { value: layout.clientHeight });
  Object.defineProperty(list, "scrollHeight", { value: layout.scrollHeight ?? 1000 });
  const scrollBy = vi.fn();
  list.scrollBy = scrollBy;
  return { cue, list, arrow, scrollBy };
}

afterEach(() => {
  prefersReducedMotion("no-preference");
  document.body.replaceChildren();
});

describe("scrollCue", () => {
  it("wraps the content in a list followed by a Scroll down button", () => {
    const row = document.createElement("p");

    const { cue, list, arrow } = mount({ clientHeight: 300 }, row);

    expect(cue.className).toBe("gh-prism-scroll-cue");
    expect([...cue.children]).toEqual([list, arrow]);
    expect(list.firstChild).toBe(row);
    expect(arrow.type).toBe("button");
    expect(arrow.getAttribute("aria-label")).toBe("Scroll down");
    expect(arrow.querySelector("svg")).not.toBeNull();
  });

  it("makes the list a Tab stop only when nothing inside it is focusable", () => {
    const link = document.createElement("a");
    link.href = "https://example.com";

    const plain = mount({ clientHeight: 300 }, document.createElement("p"));
    const linked = mount({ clientHeight: 300 }, link);
    const withButton = mount({ clientHeight: 300 }, document.createElement("button"));

    expect(plain.list.tabIndex).toBe(0);
    expect(linked.list.tabIndex).toBe(-1);
    expect(withButton.list.tabIndex).toBe(-1);
    expect(plain.arrow.tabIndex).toBe(0);
  });

  it("scrolls a page less the overlap that keeps the last row in view", () => {
    const { arrow, scrollBy } = mount({ clientHeight: 300 });

    arrow.click();

    expect(scrollBy).toHaveBeenCalledWith({ top: 236, behavior: "smooth" });
  });

  it("scrolls at least half a short list", () => {
    const { arrow, scrollBy } = mount({ clientHeight: 100 });

    arrow.click();

    expect(scrollBy).toHaveBeenCalledWith({ top: 50, behavior: "smooth" });
  });

  it("jumps under reduced motion", () => {
    prefersReducedMotion("reduce");
    const { arrow, scrollBy } = mount({ clientHeight: 300 });

    arrow.click();

    expect(scrollBy).toHaveBeenCalledWith({ top: 236, behavior: "instant" });
  });

  it("hands focus to the list when a page reaches the end", () => {
    const { list, arrow } = mount({ clientHeight: 300, scrollHeight: 500 });
    arrow.focus();

    arrow.click();

    expect(document.activeElement).toBe(list);
  });

  it("keeps focus on the arrow while more sits below", () => {
    const { arrow } = mount({ clientHeight: 300, scrollHeight: 1000 });
    arrow.focus();

    arrow.click();

    expect(document.activeElement).toBe(arrow);
  });
});
