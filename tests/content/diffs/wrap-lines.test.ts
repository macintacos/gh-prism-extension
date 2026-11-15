// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showWrapLines, type WrapChoice } from "../../../entrypoints/content/diffs/wrap-lines";
import {
  type FilesPage,
  findFilesPage,
  findFilesToolbar,
  findLayoutGear,
} from "../../../entrypoints/content/files-page";
import commitSplit from "../../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../../fixtures/commit-page-diff-unified.html?raw";
import commitToolbar from "../../fixtures/commit-page-toolbar.html?raw";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";
import prUnified from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import prToolbar from "../../fixtures/files-page-toolbar.html?raw";
import { installLayoutMenu } from "../../fixtures/layout-menu";
import commitMenu from "../../fixtures/layout-menu-commit.html?raw";
import prMenu from "../../fixtures/layout-menu-pr.html?raw";

describe("showWrapLines", () => {
  let controller: AbortController;
  let warn: ReturnType<typeof vi.spyOn>;
  const flush = () => vi.advanceTimersByTimeAsync(100);
  const unwrapped = () => document.documentElement.dataset.ghPrismWrap === "off";
  const labelled = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(
      (item) => item.textContent?.trim() === text,
    );
  const wrapItem = () => labelled("Wrap lines");

  /** A page of `kind` with one diff table and, unless `gear` is false, its toolbar's gear. */
  function pageOf(
    kind: "pr" | "commit",
    { gear = true, menu }: { gear?: boolean; menu?: string } = {},
  ): FilesPage {
    const fixtures =
      kind === "pr"
        ? {
            load: loadFixture,
            toolbar: prToolbar,
            menu: prMenu,
            unified: prUnified,
            split: prSplit,
          }
        : {
            load: loadCommitFixture,
            toolbar: commitToolbar,
            menu: commitMenu,
            unified: commitUnified,
            split: commitSplit,
          };
    fixtures.load();
    const page = findFilesPage(document);
    const toolbar = page && findFilesToolbar(page);
    if (!page || !toolbar) throw new Error("fixture has no page or toolbar");
    if (gear) toolbar.outerHTML = fixtures.toolbar;
    else findLayoutGear(page)?.remove();
    const region = document.createElement("div");
    region.innerHTML = fixtures.split;
    page.diffs.append(region);
    installLayoutMenu({
      menu: menu ?? fixtures.menu,
      tables: { unified: fixtures.unified, split: fixtures.split },
      signal: controller.signal,
    });
    return page;
  }

  function show(page: FilesPage, on = true) {
    const wrap: WrapChoice = { on };
    const save = vi.fn<(on: boolean) => void>();
    showWrapLines(page, controller.signal, { choice: wrap, save });
    return { wrap, save };
  }

  async function openMenu(page: FilesPage) {
    findLayoutGear(page)?.click();
    await flush();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    controller.abort();
    warn.mockRestore();
    vi.useRealTimers();
    delete document.documentElement.dataset.ghPrismWrap;
  });

  it.each(["pr", "commit"] as const)(
    "adds one checked Wrap lines item right after Compact line height on a %s page",
    async (kind) => {
      const page = pageOf(kind);
      show(page);

      await openMenu(page);

      expect(document.querySelectorAll('[role="menuitemcheckbox"]')).toContain(wrapItem());
      expect(labelled("Compact line height")?.nextElementSibling).toBe(wrapItem());
      expect(wrapItem()?.getAttribute("aria-checked")).toBe("true");
      expect(unwrapped()).toBe(false);
    },
  );

  it.each(["pr", "commit"] as const)(
    "shows gh-prism's glyph in the item's trailing slot, styled like the menu's own, on a %s page",
    async (kind) => {
      const page = pageOf(kind);
      show(page);

      await openMenu(page);

      const slot = '[data-component="ActionList.TrailingVisual"]';
      const trailing = wrapItem()?.querySelector(slot);
      const primers = [...document.querySelectorAll(slot)].filter((el) => el !== trailing);
      expect(trailing?.className).toBe(primers[0]?.className);
      expect(trailing?.querySelector(":scope > svg")?.getAttribute("aria-hidden")).toBe("true");
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
    expect(warn).toHaveBeenCalledOnce();
  });

  it("stays wrapped and warns once on a page whose diffs render with no gear", async () => {
    const page = pageOf("pr", { gear: false });
    show(page, false);
    await flush();

    page.diffs.append(document.createElement("div"));
    await flush();

    expect(unwrapped()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
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

    expect(warn).toHaveBeenCalledTimes(2);
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

    controller.abort();

    expect(unwrapped()).toBe(false);
  });
});
