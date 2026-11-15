// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MenuGate,
  type PrismMenuItem,
  showPrismMenu,
} from "../../../entrypoints/content/diffs/prism-menu";
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

describe("showPrismMenu", () => {
  let controller: AbortController;
  let warn: ReturnType<typeof vi.spyOn>;
  const flush = () => vi.advanceTimersByTimeAsync(100);
  const group = () =>
    document.querySelector('ul[role="group"][aria-label="gh-prism"]')?.parentElement ?? null;

  const KINDS = {
    pr: { load: loadFixture, toolbar: prToolbar, menu: prMenu, unified: prUnified, split: prSplit },
    commit: {
      load: loadCommitFixture,
      toolbar: commitToolbar,
      menu: commitMenu,
      unified: commitUnified,
      split: commitSplit,
    },
  };

  /** A page of `kind` with one diff table and, unless `gear` is false, its toolbar's gear. */
  function pageOf(
    kind: keyof typeof KINDS,
    { gear = true, menu }: { gear?: boolean; menu?: string } = {},
  ): FilesPage {
    const fixtures = KINDS[kind];
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

  const item = (id: string, follow: (gate: MenuGate) => void = () => {}): PrismMenuItem => ({
    id,
    text: id,
    checked: () => true,
    pick: () => {},
    follow,
  });

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
  });

  it.each(["pr", "commit"] as const)(
    "ends a %s page's menu with a divider, then one group headed gh-prism with its glyph",
    async (kind) => {
      const page = pageOf(kind);
      showPrismMenu(page, controller.signal, [item("first"), item("second")]);

      await openMenu(page);

      const menu = document.querySelector('#__primerPortalRoot__ ul[role="menu"]');
      expect(menu?.lastElementChild).toBe(group());
      expect(
        group()?.previousElementSibling?.matches('[data-component="ActionList.Divider"]'),
      ).toBe(true);
      expect(document.querySelectorAll('ul[aria-label="gh-prism"]')).toHaveLength(1);
      const heading = group()?.querySelector('[data-component="GroupHeadingWrap"]');
      expect(heading?.textContent?.trim()).toBe("gh-prism");
      expect(heading?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      expect(heading?.matches('[role^="menuitem"], [tabindex]')).toBe(false);
    },
  );

  it("holds the items in order as checkbox items with no trailing visual", async () => {
    const page = pageOf("pr");
    showPrismMenu(page, controller.signal, [item("first"), item("second")]);

    await openMenu(page);

    const items = [...(group()?.querySelectorAll('[role="menuitemcheckbox"]') ?? [])];
    expect(items.map((el) => el.id)).toEqual(["first", "second"]);
    expect(group()?.querySelector('[data-component="ActionList.TrailingVisual"]')).toBeNull();
  });

  it("gives an item's subtitle to its entry", async () => {
    const page = pageOf("commit");
    showPrismMenu(page, controller.signal, [{ ...item("first"), subtitle: "Below" }]);

    await openMenu(page);

    expect(document.querySelector("#first--description")?.textContent).toBe("Below");
  });

  it.each([
    { name: "without Compact line height", menu: prMenu.replace("Compact line height", "Other") },
    { name: "without its Layout heading", menu: prMenu.replace(/GroupHeadingWrap/g, "Gone") },
  ])("adds no group to a menu $name, gives up, and warns once", async ({ menu }) => {
    const gates: MenuGate[] = [];
    const page = pageOf("pr", { menu });
    showPrismMenu(page, controller.signal, [item("first", (gate) => gates.push(gate))]);

    await openMenu(page);
    await openMenu(page);

    expect(group()).toBeNull();
    expect(gates).toEqual(["open", "given up"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("warns once and stays closed on a page whose diffs render with no gear", async () => {
    const gates: MenuGate[] = [];
    const page = pageOf("pr", { gear: false });
    showPrismMenu(page, controller.signal, [item("first", (gate) => gates.push(gate))]);

    page.diffs.append(document.createElement("div"));
    await flush();
    page.diffs.append(document.createElement("div"));
    await flush();

    expect(gates.every((gate) => gate === "closed")).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});
