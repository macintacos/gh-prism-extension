// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { showPrismMenu } from "../../../entrypoints/content/diffs/prism-menu";
import { type WrapChoice, wrapLinesItem } from "../../../entrypoints/content/diffs/wrap-lines";
import { type FilesPage, findFilesToolbar } from "../../../entrypoints/content/files-page";
import prToolbar from "../../fixtures/files-page-toolbar.html?raw";
import prMenu from "../../fixtures/layout-menu-pr.html?raw";
import { openMenu, useMenuTest } from "./menu-page";

describe("wrapLinesItem", () => {
  const harness = useMenuTest();
  const { pageOf } = harness;
  const flush = () => vi.advanceTimersByTimeAsync(100);
  const unwrapped = () => document.documentElement.dataset.ghPrismWrap === "off";
  const labelled = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent?.trim() === text,
    );
  const wrapItem = () => labelled("Wrap lines");

  function show(page: FilesPage, on = true) {
    const wrap: WrapChoice = { on };
    const save = vi.fn<(on: boolean) => void>();
    showPrismMenu(page, harness.signal, [
      wrapLinesItem(page, harness.signal, { choice: wrap, save }),
    ]);
    return { wrap, save };
  }

  afterEach(() => {
    delete document.documentElement.dataset.ghPrismWrap;
  });

  it.each(["pr", "commit"] as const)(
    "offers one checked Wrap lines item in gh-prism's group on a %s page",
    async (kind) => {
      const page = pageOf(kind);
      show(page);

      await openMenu(page);

      const items = document.querySelectorAll(
        'ul[aria-label="gh-prism"] > [role="menuitemcheckbox"]',
      );
      expect([...items]).toEqual([wrapItem()]);
      expect(wrapItem()?.getAttribute("aria-checked")).toBe("true");
      expect(unwrapped()).toBe(false);
    },
  );

  it.each([
    { name: "a click", press: (item: HTMLElement) => item.click() },
    {
      name: "Enter",
      press: (item: HTMLElement) =>
        item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
    },
    {
      name: "Space",
      press: (item: HTMLElement) =>
        item.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
    },
  ])("$name flips the choice, saves it, applies it, and closes the menu", async ({ press }) => {
    const page = pageOf("pr");
    const { wrap, save } = show(page);
    await openMenu(page);
    const item = wrapItem();
    if (!item) throw new Error("no Wrap lines item");

    press(item);
    await flush();

    expect(wrap.on).toBe(false);
    expect(save).toHaveBeenCalledWith(false);
    expect(unwrapped()).toBe(true);
    expect(wrapItem()).toBeUndefined();

    await openMenu(page);
    wrapItem()?.click();
    await flush();

    expect(save).toHaveBeenLastCalledWith(true);
    expect(unwrapped()).toBe(false);
  });

  it("leaves Compact line height alone", async () => {
    const page = pageOf("pr");
    show(page);
    await openMenu(page);
    const compact = labelled("Compact line height");
    const clicks = vi.fn();
    compact?.addEventListener("click", clicks);

    wrapItem()?.click();

    expect(compact?.getAttribute("aria-checked")).toBe("true");
    expect(clicks).not.toHaveBeenCalled();
  });

  it("adds no item to a menu without Compact line height, stays wrapped, and warns once", async () => {
    const page = pageOf("pr", { menu: prMenu.replace("Compact line height", "Something else") });
    show(page, false);

    await openMenu(page);
    await openMenu(page);
    await openMenu(page);

    expect(wrapItem()).toBeUndefined();
    expect(unwrapped()).toBe(false);
    expect(harness.warn).toHaveBeenCalledOnce();
  });

  it("stays wrapped and warns once on a page whose diffs render with no gear", async () => {
    const page = pageOf("pr", { gear: false });
    show(page, false);
    await flush();

    page.diffs.append(document.createElement("div"));
    await flush();

    expect(unwrapped()).toBe(false);
    expect(harness.warn).toHaveBeenCalledOnce();
  });

  it("unwraps as the page starts when the saved choice is off", () => {
    show(pageOf("commit"), false);

    expect(unwrapped()).toBe(true);
  });

  it("keeps a line on one row in a sideways-scrolling box while unwrapped", () => {
    show(pageOf("pr"), false);
    const inner = document.querySelector("td.diff-text-cell .diff-text-inner");
    const box = document.querySelector("table[data-diff-anchor]")?.parentElement;
    if (!inner || !box) throw new Error("fixture has no line");

    expect(getComputedStyle(inner).whiteSpace).toBe("pre");
    expect(getComputedStyle(box).overflowX).toBe("auto");
  });

  it("holds a file's notice still at the box's left edge while unwrapped", () => {
    show(pageOf("pr"), false);
    const table = document.querySelector("table[data-diff-anchor]");
    if (!table) throw new Error("fixture has no table");
    const notice = document.createElement("div");
    notice.className = "gh-prism-structural-notice";
    notice.style.top = "150px";
    table.before(notice);

    expect(getComputedStyle(notice).top).toBe("auto");
    expect(getComputedStyle(notice).left).toBe("0px");
  });

  it("leaves hunk headers wrapping while unwrapped", () => {
    show(pageOf("pr"), false);
    const hunk = document.querySelector(".diff-hunk-cell .diff-text-inner");
    if (!hunk) throw new Error("fixture has no hunk header");

    expect(getComputedStyle(hunk).whiteSpace).not.toBe("pre");
  });

  it("offers the item once a gear missing at the start appears", async () => {
    const page = pageOf("pr", { gear: false });
    const { save } = show(page);
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    toolbar.outerHTML = prToolbar;

    await openMenu(page);
    wrapItem()?.click();
    await flush();

    expect(save).toHaveBeenCalledWith(false);
    expect(unwrapped()).toBe(true);
  });

  it("warns once for a missing gear and once for a menu without Compact line height", async () => {
    const page = pageOf("pr", {
      gear: false,
      menu: prMenu.replace("Compact line height", "Something else"),
    });
    show(page);
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    page.diffs.append(document.createElement("div"));
    await flush();
    toolbar.outerHTML = prToolbar;

    await openMenu(page);

    expect(harness.warn).toHaveBeenCalledTimes(2);
  });

  it("leaves lines and their box as GitHub draws them while wrapped", () => {
    show(pageOf("pr"), true);
    const inner = document.querySelector("td.diff-text-cell .diff-text-inner");
    const box = document.querySelector("table[data-diff-anchor]")?.parentElement;
    if (!inner || !box) throw new Error("fixture has no line");

    expect(getComputedStyle(inner).whiteSpace).not.toBe("pre");
    expect(getComputedStyle(box).overflowX).not.toBe("auto");
    expect(
      [...document.head.querySelectorAll("style")].some((style) =>
        style.textContent?.includes("data-gh-prism-wrap"),
      ),
    ).toBe(false);
  });

  it("wraps again once the page is torn down", () => {
    show(pageOf("pr"), false);

    harness.abort();

    expect(unwrapped()).toBe(false);
  });
});
