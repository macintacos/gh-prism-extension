// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showWrapLines } from "../../../entrypoints/content/diffs/wrap-lines";
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
    const wrap = { on };
    const save = vi.fn<(on: boolean) => void>();
    showWrapLines(page, controller.signal, { wrap, save });
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

    expect(item.getAttribute("aria-checked")).toBe("false");
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

  it("wraps again once the page is torn down", () => {
    show(pageOf("pr"), false);

    controller.abort();

    expect(unwrapped()).toBe(false);
  });
});
