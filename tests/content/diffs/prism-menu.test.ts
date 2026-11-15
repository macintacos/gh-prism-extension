// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  type MenuGate,
  type PrismMenuItem,
  showPrismMenu,
} from "../../../entrypoints/content/diffs/prism-menu";
import prMenu from "../../fixtures/layout-menu-pr.html?raw";
import { openMenu, useMenuTest } from "./menu-page";

describe("showPrismMenu", () => {
  const harness = useMenuTest();
  const { pageOf } = harness;
  const flush = () => vi.advanceTimersByTimeAsync(100);
  const group = () =>
    document.querySelector('ul[role="group"][aria-label="gh-prism"]')?.parentElement ?? null;

  const item = (id: string, follow: (gate: MenuGate) => void = () => {}): PrismMenuItem => ({
    id,
    text: id,
    checked: () => true,
    pick: () => {},
    follow,
  });

  it.each(["pr", "commit"] as const)(
    "ends a %s page's menu with a divider, then one group headed gh-prism with its glyph",
    async (kind) => {
      const page = pageOf(kind);
      showPrismMenu(page, harness.signal, [item("first"), item("second")]);

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
    showPrismMenu(page, harness.signal, [item("first"), item("second")]);

    await openMenu(page);

    const items = [...(group()?.querySelectorAll('[role="menuitemcheckbox"]') ?? [])];
    expect(items.map((el) => el.id)).toEqual(["first", "second"]);
    expect(group()?.querySelector('[data-component="ActionList.TrailingVisual"]')).toBeNull();
  });

  it("gives an item's subtitle to its entry", async () => {
    const page = pageOf("commit");
    showPrismMenu(page, harness.signal, [{ ...item("first"), subtitle: "Below" }]);

    await openMenu(page);

    expect(document.querySelector("#first--description")?.textContent).toBe("Below");
  });

  it.each([
    { name: "without Compact line height", menu: prMenu.replace("Compact line height", "Other") },
    { name: "without its Layout heading", menu: prMenu.replace(/GroupHeadingWrap/g, "Gone") },
  ])("adds no group to a menu $name, gives up, and warns once", async ({ menu }) => {
    const gates: MenuGate[] = [];
    const page = pageOf("pr", { menu });
    showPrismMenu(page, harness.signal, [item("first", (gate) => gates.push(gate))]);

    await openMenu(page);
    await openMenu(page);

    expect(group()).toBeNull();
    expect(gates).toEqual(["open", "given up"]);
    expect(harness.warn).toHaveBeenCalledOnce();
  });

  it("warns once and stays closed on a page whose diffs render with no gear", async () => {
    const gates: MenuGate[] = [];
    const page = pageOf("pr", { gear: false });
    showPrismMenu(page, harness.signal, [item("first", (gate) => gates.push(gate))]);

    page.diffs.append(document.createElement("div"));
    await flush();
    page.diffs.append(document.createElement("div"));
    await flush();

    expect(gates).toEqual([]);
    expect(harness.warn).toHaveBeenCalledOnce();
  });
});
