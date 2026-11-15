// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MarkOnCollapseChoice,
  markOnCollapseItem,
} from "../../../entrypoints/content/diffs/mark-on-collapse";
import type { MenuGate } from "../../../entrypoints/content/diffs/prism-menu";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import { loadViewedFixture, VIEWED_APP_TOML, VIEWED_LIB_RS } from "../../fixtures/files-page";

describe("markOnCollapseItem", () => {
  let controller: AbortController;
  let page: FilesPage;
  /** Every Viewed toggle click, by diff anchor. */
  let toggleClicks: string[];

  const region = (anchor: string) => {
    const found = document.getElementById(anchor);
    if (!found) throw new Error(`fixture has no ${anchor}`);
    return found;
  };
  const chevronOf = (anchor: string) => region(anchor).querySelector("button") as HTMLElement;
  const toggleOf = (anchor: string) =>
    region(anchor).querySelector("button[aria-pressed]") as HTMLElement;
  const viewed = (anchor: string) => toggleOf(anchor).getAttribute("aria-pressed") === "true";
  const collapsed = (anchor: string) => region(anchor).children.length === 1;
  const click = (target: Element, altKey = false) =>
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey }));

  /** Mimics GitHub: a chevron collapses or expands its diff; a Viewed toggle flips and collapses or expands it. */
  function standInGitHub(anchor: string) {
    const diff = region(anchor);
    const body = document.createElement("div");
    const icon = () => chevronOf(anchor).querySelector("svg") as SVGElement;
    const show = (open: boolean) => {
      if (open) diff.append(body);
      else body.remove();
      // GitHub swaps the chevron's svg, detaching the clicked target.
      const next = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      next.setAttribute("class", `octicon octicon-chevron-${open ? "down" : "right"}`);
      icon().replaceWith(next);
    };
    if (diff.children.length === 1) body.remove();
    else diff.replaceChildren(diff.children[0] as Element, body);
    chevronOf(anchor).addEventListener("click", () => show(collapsed(anchor)));
    toggleOf(anchor).addEventListener("click", () => {
      toggleClicks.push(anchor);
      const pressed = !viewed(anchor);
      toggleOf(anchor).setAttribute("aria-pressed", String(pressed));
      show(!pressed);
    });
  }

  function show({ on = true, gate = "open" as MenuGate } = {}) {
    const choice: MarkOnCollapseChoice = { on };
    const save = vi.fn<(on: boolean) => void>();
    const marked = new Set<string>();
    const item = markOnCollapseItem(page, controller.signal, { choice, save, marked });
    item.follow(gate);
    return { item, choice, save, marked };
  }

  const settle = () => vi.runAllTimersAsync();

  beforeEach(() => {
    vi.useFakeTimers();
    loadViewedFixture();
    const found = findFilesPage(document);
    if (!found) throw new Error("fixture is not a Files changed page");
    page = found;
    controller = new AbortController();
    toggleClicks = [];
    standInGitHub(VIEWED_LIB_RS);
    standInGitHub(VIEWED_APP_TOML);
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("leaves Viewed alone on a collapse while unchecked", async () => {
    show({ on: false });

    click(chevronOf(VIEWED_LIB_RS).querySelector("svg") as Element);
    await settle();

    expect(collapsed(VIEWED_LIB_RS)).toBe(true);
    expect(toggleClicks).toEqual([]);
  });

  it("marks a collapsed file Viewed and unmarks it when expanded again", async () => {
    const { marked } = show();

    click(chevronOf(VIEWED_LIB_RS).querySelector("svg") as Element);
    await settle();

    expect(viewed(VIEWED_LIB_RS)).toBe(true);
    expect(collapsed(VIEWED_LIB_RS)).toBe(true);
    expect([...marked]).toEqual([VIEWED_LIB_RS]);

    click(chevronOf(VIEWED_LIB_RS).querySelector("svg") as Element);
    await settle();

    expect(viewed(VIEWED_LIB_RS)).toBe(false);
    expect(collapsed(VIEWED_LIB_RS)).toBe(false);
    expect([...marked]).toEqual([]);
  });

  it("never toggles a file the reviewer marked Viewed", async () => {
    show();

    click(chevronOf(VIEWED_APP_TOML));
    await settle();
    click(chevronOf(VIEWED_APP_TOML));
    await settle();

    expect(toggleClicks).toEqual([]);
    expect(viewed(VIEWED_APP_TOML)).toBe(true);
  });

  it("keeps a file Viewed once the reviewer re-ticks it by hand", async () => {
    const { marked } = show();
    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    click(toggleOf(VIEWED_LIB_RS));
    await settle();
    click(toggleOf(VIEWED_LIB_RS));
    await settle();
    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    expect(collapsed(VIEWED_LIB_RS)).toBe(false);
    expect(viewed(VIEWED_LIB_RS)).toBe(true);
    expect(marked.size).toBe(0);
  });

  it("ignores an Alt-click, which collapses every file", async () => {
    show();

    click(chevronOf(VIEWED_LIB_RS), true);
    await settle();

    expect(toggleClicks).toEqual([]);
  });

  it("does not count a Viewed toggle click as a collapse", async () => {
    const { marked } = show();

    click(toggleOf(VIEWED_LIB_RS));
    await settle();

    expect(toggleClicks).toEqual([VIEWED_LIB_RS]);
    expect(marked.size).toBe(0);
  });

  it("does nothing while its gate is closed", async () => {
    show({ gate: "closed" });

    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    expect(toggleClicks).toEqual([]);
  });

  it("forgets marked files and stops once unchecked", async () => {
    const { item, save, marked } = show();
    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    item.pick();
    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    expect(save).toHaveBeenCalledWith(false);
    expect(marked.size).toBe(0);
    expect(toggleClicks).toEqual([VIEWED_LIB_RS]);
    expect(viewed(VIEWED_LIB_RS)).toBe(true);
  });

  it("stops once its signal aborts", async () => {
    show();

    controller.abort();
    click(chevronOf(VIEWED_LIB_RS));
    await settle();

    expect(toggleClicks).toEqual([]);
  });
});
