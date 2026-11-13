// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRUCTURAL_DIFFS_DOC } from "../../../entrypoints/content/diffs/structural-intro";
import { structuralChoiceOf } from "../../../entrypoints/content/diffs/structural-mode";
import {
  type DiffView,
  showDiffViewControl,
  shownView,
  stepsFor,
} from "../../../entrypoints/content/diffs/view-control";
import {
  type DiffLayout,
  type FilesPage,
  findFilesPage,
  findFilesToolbar,
  findLayoutGear,
  findLayoutMenu,
} from "../../../entrypoints/content/files-page";
import { type PressGuard, pressGuard } from "../../../entrypoints/content/ui/press-guard";
import commitSplit from "../../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../../fixtures/commit-page-diff-unified.html?raw";
import commitToolbar from "../../fixtures/commit-page-toolbar.html?raw";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";
// Two-sided, so its three columns can only be Unified.
import prUnified from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import prToolbar from "../../fixtures/files-page-toolbar.html?raw";
import { installLayoutMenu } from "../../fixtures/layout-menu";
import commitMenu from "../../fixtures/layout-menu-commit.html?raw";
import prMenu from "../../fixtures/layout-menu-pr.html?raw";

// happy-dom has no Popover API.
HTMLElement.prototype.showPopover = () => {};
HTMLElement.prototype.hidePopover = () => {};

describe("shownView", () => {
  it.each<{ layout: DiffLayout | undefined; on: boolean; shown: DiffView | undefined }>([
    { layout: "unified", on: false, shown: "unified" },
    { layout: "unified", on: true, shown: "unified" },
    { layout: "split", on: false, shown: "split" },
    { layout: "split", on: true, shown: "structural" },
    { layout: undefined, on: false, shown: undefined },
    { layout: undefined, on: true, shown: "structural" },
  ])("shows $shown for the layout $layout with the mode on: $on", ({ layout, on, shown }) => {
    expect(shownView(layout, on)).toBe(shown);
  });
});

describe("stepsFor", () => {
  it.each<{
    target: DiffView;
    layout: DiffLayout | undefined;
    on: boolean;
    steps: ReturnType<typeof stepsFor>;
  }>([
    { target: "unified", layout: "unified", on: false, steps: {} },
    { target: "unified", layout: "unified", on: true, steps: { set: false } },
    { target: "unified", layout: "split", on: false, steps: { choose: "unified" } },
    { target: "unified", layout: "split", on: true, steps: { choose: "unified", set: false } },
    { target: "unified", layout: undefined, on: false, steps: { choose: "unified" } },
    { target: "unified", layout: undefined, on: true, steps: { choose: "unified", set: false } },
    { target: "split", layout: "unified", on: false, steps: { choose: "split" } },
    { target: "split", layout: "unified", on: true, steps: { choose: "split", set: false } },
    { target: "split", layout: "split", on: false, steps: {} },
    { target: "split", layout: "split", on: true, steps: { set: false } },
    { target: "split", layout: undefined, on: false, steps: { choose: "split" } },
    { target: "split", layout: undefined, on: true, steps: { choose: "split", set: false } },
    { target: "structural", layout: "unified", on: false, steps: { choose: "split", set: true } },
    { target: "structural", layout: "unified", on: true, steps: { choose: "split" } },
    { target: "structural", layout: "split", on: false, steps: { set: true } },
    { target: "structural", layout: "split", on: true, steps: {} },
    { target: "structural", layout: undefined, on: false, steps: { choose: "split", set: true } },
    { target: "structural", layout: undefined, on: true, steps: { choose: "split" } },
  ])(
    "plans a press on $target from $layout with the mode on: $on",
    ({ target, layout, on, steps }) => {
      expect(stepsFor(target, { layout, on })).toEqual(steps);
    },
  );
});

describe("showDiffViewControl", () => {
  let controller: AbortController;
  let guard: PressGuard;
  const flush = () => vi.advanceTimersByTimeAsync(100);
  const control = () => document.querySelector<HTMLElement>(".gh-prism-diff-view");
  const label = () => document.querySelector<HTMLElement>(".gh-prism-diff-view-name");
  const segment = (view: DiffView) =>
    document.querySelector<HTMLButtonElement>(`.gh-prism-diff-view [data-view="${view}"]`);
  const pressed = () =>
    [...document.querySelectorAll(".gh-prism-diff-view [aria-pressed='true']")].map(
      (button) => (button as HTMLElement).dataset.view,
    );

  /** A page of `kind` with its toolbar's gear, one table in `layout`, and the stand-in menu. */
  function pageOf(
    kind: "pr" | "commit",
    layout: DiffLayout,
    { omit, menu = true }: { omit?: "unified" | "split"; menu?: boolean } = {},
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
    toolbar.outerHTML = fixtures.toolbar;
    findLayoutGear(page)?.setAttribute("aria-expanded", "false");
    const region = document.createElement("div");
    region.innerHTML = fixtures[layout];
    page.diffs.append(region);
    if (menu)
      installLayoutMenu({
        menu: fixtures.menu,
        tables: { unified: fixtures.unified, split: fixtures.split },
        ...(omit ? { omit } : {}),
        signal: controller.signal,
      });
    return page;
  }

  function choiceOf(on: boolean, log: string[] = []) {
    const save = vi.fn<(on: boolean) => void>();
    const choice = structuralChoiceOf(on, save);
    const set = vi.fn((next: boolean) => {
      log.push(`set ${next}`);
      choice.set(next);
    });
    return {
      save,
      set,
      choice: {
        get on() {
          return choice.on;
        },
        get whileOn() {
          return choice.whileOn;
        },
        set,
      },
    };
  }

  function show(
    page: FilesPage,
    choice: ReturnType<typeof choiceOf>["choice"],
    { commit = false, offersStructural = true } = {},
  ) {
    showDiffViewControl(page, controller.signal, {
      choice,
      commit,
      offersStructural,
      search: () => location.search,
      guard,
    });
  }

  /** Records each Layout item clicked in the menu. */
  function recordItemClicks(log: string[]) {
    document.addEventListener(
      "click",
      (event) => {
        const item =
          event.target instanceof Element && event.target.closest('[role="menuitemradio"]');
        if (item) log.push(`choose ${item.textContent?.trim().toLowerCase()}`);
      },
      { capture: true, signal: controller.signal },
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/o/r/pull/1/changes");
    controller = new AbortController();
    guard = pressGuard(document, controller.signal);
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
    document.head.replaceChildren();
  });

  it("mounts nothing while the page has no gear", async () => {
    loadFixture();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture has no page");

    show(page, choiceOf(false).choice);
    await flush();

    expect(control()).toBeNull();
  });

  it.each(["pr", "commit"] as const)("mounts immediately before a %s gear", async (kind) => {
    const page = pageOf(kind, "split");

    show(page, choiceOf(false).choice, { commit: kind === "commit" });

    expect(control()?.nextElementSibling).toBe(findLayoutGear(page));
    expect(control()?.getAttribute("aria-label")).toBe("Diff view");
  });

  it("shows its name before the segments, read to assistive technology off the list alone", () => {
    const page = pageOf("pr", "split");

    show(page, choiceOf(false).choice);

    expect(control()?.previousElementSibling).toBe(label());
    expect(label()?.textContent).toBe(control()?.getAttribute("aria-label"));
    expect(label()?.getAttribute("aria-hidden")).toBe("true");
  });

  it.each(["pr", "commit"] as const)("mounts once a %s gear appears", async (kind) => {
    const page = pageOf(kind, "split");
    const gear = findLayoutGear(page);
    const place = gear?.parentElement;
    gear?.remove();
    show(page, choiceOf(false).choice, { commit: kind === "commit" });
    const before = control();

    if (gear) place?.append(gear);
    await flush();

    expect(before).toBeNull();
    expect(control()?.nextElementSibling).toBe(gear);
  });

  it("mounts before a replacement gear elsewhere, sweeping a stale copy", async () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);
    const stale = control()?.cloneNode(true) as Element;

    const gear = findLayoutGear(page);
    const replacement = gear?.cloneNode(true) as HTMLButtonElement;
    gear?.remove();
    findFilesToolbar(page)?.append(stale, replacement);
    await flush();

    expect(document.querySelectorAll(".gh-prism-diff-view")).toHaveLength(1);
    expect(document.querySelectorAll(".gh-prism-diff-view-name")).toHaveLength(1);
    expect(control()?.nextElementSibling).toBe(replacement);
  });

  it("mounts again when its node is removed", async () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);

    control()?.remove();
    await flush();

    expect(control()?.nextElementSibling).toBe(findLayoutGear(page));
  });

  it("hides while the toolbar has no room for it, and shows again once it has", () => {
    let resized: (() => void) | undefined;
    // happy-dom's ResizeObserver never fires, so the test calls its callback.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const page = pageOf("pr", "split");
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    let room = 600;
    Object.defineProperty(toolbar, "clientWidth", { get: () => room });
    Object.defineProperty(toolbar, "scrollWidth", {
      get: () => Math.max(room, control()?.hidden ? 500 : 700),
    });

    show(page, choiceOf(false).choice);
    const cramped = control()?.hidden;
    room = 800;
    resized?.();

    vi.unstubAllGlobals();
    expect(cramped).toBe(true);
    expect(control()?.hidden).toBe(false);
  });

  it("drops its name before itself as the toolbar's room runs short", () => {
    let resized: (() => void) | undefined;
    // happy-dom's ResizeObserver never fires, so the test calls its callback.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const page = pageOf("pr", "split");
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    let room = 660;
    Object.defineProperty(toolbar, "clientWidth", { get: () => room });
    Object.defineProperty(toolbar, "scrollWidth", {
      get: () => Math.max(room, 500 + (control()?.hidden ? 0 : 150) + (label()?.hidden ? 0 : 60)),
    });

    show(page, choiceOf(false).choice);
    const tight = { name: label()?.hidden, control: control()?.hidden };
    room = 720;
    resized?.();
    const roomy = { name: label()?.hidden, control: control()?.hidden };
    room = 600;
    resized?.();

    vi.unstubAllGlobals();
    expect(tight).toEqual({ name: true, control: false });
    expect(roomy).toEqual({ name: false, control: false });
    expect({ name: label()?.hidden, control: control()?.hidden }).toEqual({
      name: true,
      control: true,
    });
  });

  it("stays shown in a toolbar that overflows as far without it", () => {
    const page = pageOf("pr", "split");
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    Object.defineProperty(toolbar, "clientWidth", { get: () => 600 });
    Object.defineProperty(toolbar, "scrollWidth", { get: () => 608 });

    show(page, choiceOf(false).choice);

    expect(control()?.hidden).toBe(false);
  });

  it("removes the control and its style on abort", () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);

    controller.abort();

    expect(control()).toBeNull();
    expect(label()).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
  });

  describe("GitHub's own Layout group", () => {
    const openGear = async (page: FilesPage) => {
      findLayoutGear(page)?.click();
      await flush();
    };
    const shownItems = () =>
      [...document.querySelectorAll<HTMLElement>('#__primerPortalRoot__ [role^="menuitem"]')]
        .filter((item) => !item.closest("[hidden]"))
        .map((item) => item.querySelector('[data-component="ActionList.Item.Label"]')?.textContent);
    const shownDividers = () =>
      [
        ...document.querySelectorAll(
          '#__primerPortalRoot__ [data-component="ActionList.Divider"]:not([hidden])',
        ),
      ].length;
    const ALL = {
      pr: ["Unified", "Split", "Whitespace changes", "Minimize comments", "Compact line height"],
      commit: ["Unified", "Split", "Minimize comments", "Hide whitespace", "Compact line height"],
    };

    it.each(["pr", "commit"] as const)(
      "leaves a %s gear's menu without its Layout group and the divider under it",
      async (kind) => {
        const page = pageOf(kind, "split");
        show(page, choiceOf(false).choice, { commit: kind === "commit" });

        await openGear(page);

        expect(shownItems()).toEqual(ALL[kind].slice(2));
        expect(shownDividers()).toBe(kind === "pr" ? 2 : 1);
      },
    );

    it("hides each Layout item itself, so Primer's arrow keys skip it", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);

      await openGear(page);

      const menu = findLayoutMenu(document);
      expect([menu?.unified.hidden, menu?.split.hidden]).toEqual([true, true]);
    });

    it("moves the focus GitHub put on a Layout item to the menu's first item left", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);

      await openGear(page);

      expect(document.activeElement?.textContent).toContain("Whitespace changes");
    });

    it("leaves focus where it is when no Layout item holds it", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);
      findLayoutGear(page)?.click();
      await Promise.resolve();
      segment("split")?.focus();

      await flush();

      expect(shownItems()).toEqual(ALL.pr.slice(2));
      expect(document.activeElement).toBe(segment("split"));
    });

    it("hides it again each time the menu opens", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);
      await openGear(page);
      await openGear(page);

      await openGear(page);

      expect(shownItems()).toEqual(ALL.pr.slice(2));
    });

    it("hides it in the menu of a gear GitHub replaces", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);
      const gear = findLayoutGear(page);
      gear?.replaceWith(gear.cloneNode(true));
      await flush();

      await openGear(page);

      expect(shownItems()).toEqual(ALL.pr.slice(2));
    });

    it("still chooses a layout through the menu on a press", async () => {
      const page = pageOf("pr", "split");
      const log: string[] = [];
      recordItemClicks(log);
      show(page, choiceOf(false, log).choice);
      await openGear(page);
      await openGear(page);

      segment("unified")?.click();
      await flush();

      expect(log).toEqual(["choose unified"]);
      expect(pressed()).toEqual(["unified"]);
    });

    it("leaves the menu as GitHub drew it while the control is hidden for want of room", async () => {
      const page = pageOf("pr", "split");
      const toolbar = findFilesToolbar(page);
      if (!toolbar) throw new Error("fixture has no toolbar");
      Object.defineProperty(toolbar, "clientWidth", { get: () => 600 });
      Object.defineProperty(toolbar, "scrollWidth", {
        get: () => (control()?.hidden ? 600 : 700),
      });
      show(page, choiceOf(false).choice);

      await openGear(page);

      expect(control()?.hidden).toBe(true);
      expect(shownItems()).toEqual(ALL.pr);
      expect(shownDividers()).toBe(3);
    });

    it("leaves the menu as GitHub drew it when the Layout group holds another item", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);
      findLayoutGear(page)?.click();
      await Promise.resolve();
      const split = findLayoutMenu(document)?.split;
      const extra = split?.cloneNode(true) as Element;
      const extraLabel = extra.querySelector('[data-component="ActionList.Item.Label"]');
      if (extraLabel) extraLabel.textContent = "Stacked";
      split?.after(extra);

      await flush();

      expect(shownItems()).toEqual(["Unified", "Split", "Stacked", ...ALL.pr.slice(2)]);
    });

    it("leaves the menu as GitHub drew it once the control is gone", async () => {
      const page = pageOf("pr", "split");
      show(page, choiceOf(false).choice);
      controller.abort();
      controller = new AbortController();
      installLayoutMenu({
        menu: prMenu,
        tables: { unified: prUnified, split: prSplit },
        signal: controller.signal,
      });

      await openGear(page);

      expect(shownItems()).toEqual(ALL.pr);
    });
  });

  it.each<{ kind: "pr" | "commit"; layout: DiffLayout; on: boolean; shown: DiffView }>([
    { kind: "pr", layout: "split", on: false, shown: "split" },
    { kind: "pr", layout: "unified", on: false, shown: "unified" },
    { kind: "pr", layout: "split", on: true, shown: "structural" },
    { kind: "commit", layout: "unified", on: false, shown: "unified" },
  ])("presses $shown on a $kind page in $layout (mode on: $on)", ({ kind, layout, on, shown }) => {
    const page = pageOf(kind, layout);

    show(page, choiceOf(on).choice, { commit: kind === "commit" });

    expect(pressed()).toEqual([shown]);
  });

  it("tags the Structural segment Beta, in its name and on screen", () => {
    const page = pageOf("pr", "split");

    show(page, choiceOf(false).choice);

    expect(segment("structural")?.textContent).toBe("Structural Beta");
    expect(
      segment("structural")?.querySelector(".gh-prism-diff-view-tag")?.textContent?.trim(),
    ).toBe("Beta");
  });

  it("leads the Structural segment alone with gh-prism's prism, hidden from assistive technology", () => {
    const page = pageOf("pr", "split");

    show(page, choiceOf(false).choice);

    const prism = segment("structural")?.firstElementChild;
    expect(prism?.querySelector("svg")).not.toBeNull();
    expect(prism?.getAttribute("aria-hidden")).toBe("true");
    expect(prism?.nextElementSibling?.textContent).toBe("Structural");
    expect(segment("unified")?.querySelector("svg")).toBeNull();
    expect(segment("split")?.querySelector("svg")).toBeNull();
  });

  it("presses no segment while the layout can't be told", () => {
    const page = pageOf("pr", "split");
    for (const table of page.diffs.querySelectorAll("table")) table.remove();

    show(page, choiceOf(false).choice);

    expect(pressed()).toEqual([]);
  });

  it("follows a layout chosen from the gear", async () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);

    findLayoutGear(page)?.click();
    await Promise.resolve();
    findLayoutMenu(document)?.unified.click();
    await flush();

    expect(pressed()).toEqual(["unified"]);
  });

  it("follows the mode turning off", async () => {
    const page = pageOf("pr", "split");
    const { choice } = choiceOf(true);
    show(page, choice);

    choice.set(false);
    await Promise.resolve();

    expect(pressed()).toEqual(["split"]);
  });

  it("chooses Unified from Split and leaves the mode off unsaved", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice, set } = choiceOf(false, log);
    show(page, choice);

    segment("unified")?.click();
    await flush();

    expect(log).toEqual(["choose unified"]);
    expect(set).not.toHaveBeenCalled();
    expect(pressed()).toEqual(["unified"]);
  });

  it("chooses Unified from Structural, then turns the mode off", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(true, log);
    show(page, choice);

    segment("unified")?.click();
    await flush();

    expect(log).toEqual(["choose unified", "set false"]);
    expect(pressed()).toEqual(["unified"]);
  });

  it("turns the mode off for Split from Structural without opening the menu", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(true, log);
    show(page, choice);
    const gear = findLayoutGear(page);
    const gearClick = vi.fn();
    gear?.addEventListener("click", gearClick);

    segment("split")?.click();
    await flush();

    expect(log).toEqual(["set false"]);
    expect(gearClick).not.toHaveBeenCalled();
    expect(pressed()).toEqual(["split"]);
  });

  it.each(["pr", "commit"] as const)(
    "chooses Split from Unified on a %s page before turning the mode on",
    async (kind) => {
      const page = pageOf(kind, "unified");
      const log: string[] = [];
      recordItemClicks(log);
      const { choice } = choiceOf(false, log);
      show(page, choice, { commit: kind === "commit" });

      segment("structural")?.click();
      await flush();

      expect(log).toEqual(["choose split", "set true"]);
      expect(pressed()).toEqual(["structural"]);
    },
  );

  it("only turns the mode on for Structural from Split", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(false, log);
    show(page, choice);

    segment("structural")?.click();
    await flush();

    expect(log).toEqual(["set true"]);
  });

  it("does nothing for the pressed segment", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(false, log);
    show(page, choice);

    segment("split")?.click();
    await flush();

    expect(log).toEqual([]);
    expect(findLayoutMenu(document)).toBeUndefined();
  });

  it("gives up for this page when the item never shows, closing the menu", async () => {
    const page = pageOf("pr", "unified", { omit: "split" });
    const { choice, set } = choiceOf(false);
    show(page, choice);

    segment("split")?.click();
    await vi.advanceTimersByTimeAsync(1100);
    findLayoutGear(page)?.replaceWith(findLayoutGear(page)?.cloneNode(true) as Node);
    await flush();

    expect(control()).toBeNull();
    expect(document.querySelector('#__primerPortalRoot__ ul[role="menu"]')).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it("stays for another press when the gear opens no menu", async () => {
    const page = pageOf("pr", "unified", { menu: false });
    const { choice, set } = choiceOf(false);
    show(page, choice);

    segment("split")?.click();
    await vi.advanceTimersByTimeAsync(1100);

    expect(control()).not.toBeNull();
    expect(set).not.toHaveBeenCalled();

    installLayoutMenu({
      menu: prMenu,
      tables: { unified: prUnified, split: prSplit },
      signal: controller.signal,
    });
    segment("split")?.click();
    await vi.advanceTimersByTimeAsync(1100);

    expect(pressed()).toEqual(["split"]);
  });

  it("leaves the mode off when the page still reads Unified after choosing Split", async () => {
    const page = pageOf("pr", "unified");
    const { choice, set } = choiceOf(false);
    show(page, choice);
    // The menu answers, but the tables never change.
    document.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest('[role="menuitemradio"]')) {
          event.stopImmediatePropagation();
          findLayoutMenu(document)?.list.remove();
        }
      },
      { capture: true, signal: controller.signal },
    );

    segment("structural")?.click();
    await vi.advanceTimersByTimeAsync(2100);

    expect(set).not.toHaveBeenCalled();
    expect(pressed()).toEqual(["unified"]);
  });

  it("ignores a press while another is in flight", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(false, log);
    show(page, choice);

    segment("unified")?.click();
    segment("structural")?.click();
    await flush();

    expect(log).toEqual(["choose unified"]);
  });

  it("returns focus from the gear to the pressed segment", async () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);

    segment("unified")?.focus();
    segment("unified")?.click();
    await flush();

    expect(document.activeElement).toBe(segment("unified"));
  });

  it("disables Structural on a page that can't show it", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(true, log);
    show(page, choice, { offersStructural: false });

    segment("structural")?.click();
    await flush();

    expect(segment("structural")?.getAttribute("aria-disabled")).toBe("true");
    expect(segment("structural")?.getAttribute("aria-description")).toMatch(/one commit/);
    expect(pressed()).toEqual(["split"]);
    expect(log).toEqual([]);
  });

  it("runs a press the page re-mounted the control during, between pointerdown and pointerup", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice } = choiceOf(false, log);
    const first = new AbortController();
    showDiffViewControl(page, first.signal, {
      choice,
      commit: false,
      offersStructural: true,
      search: () => location.search,
      guard,
    });

    segment("unified")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    first.abort();
    show(page, choice);
    segment("unified")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await flush();

    expect(log).toEqual(["choose unified"]);
  });

  it("abandons a press whose page is torn down mid-press", async () => {
    const page = pageOf("pr", "unified");
    const log: string[] = [];
    recordItemClicks(log);
    const { choice, set } = choiceOf(false, log);
    const first = new AbortController();
    showDiffViewControl(page, first.signal, {
      choice,
      commit: false,
      offersStructural: true,
      search: () => location.search,
      guard,
    });

    segment("structural")?.click();
    first.abort();
    await flush();

    expect(log).toEqual([]);
    expect(set).not.toHaveBeenCalled();
  });

  it("closes the menu without choosing the layout it already shows", async () => {
    const page = pageOf("pr", "split");
    for (const table of page.diffs.querySelectorAll("table")) table.remove();
    const log: string[] = [];
    recordItemClicks(log);
    show(page, choiceOf(false, log).choice);

    segment("unified")?.click();
    await flush();

    expect(log).toEqual([]);
    expect(findLayoutMenu(document)).toBeUndefined();
    expect(control()).not.toBeNull();
  });

  it("measures the toolbar only on mount, not on a diffs report", async () => {
    const page = pageOf("pr", "split");
    const toolbar = findFilesToolbar(page);
    if (!toolbar) throw new Error("fixture has no toolbar");
    let reads = 0;
    Object.defineProperty(toolbar, "scrollWidth", {
      get: () => {
        reads++;
        return 0;
      },
    });
    show(page, choiceOf(false).choice);
    await flush();
    const readsOnMount = reads;

    page.diffs.append(document.createElement("div"));
    await flush();

    expect(readsOnMount).toBeGreaterThan(0);
    expect(reads).toBe(readsOnMount);
  });

  it("writes nothing to its segments on a report that leaves the view as it was", async () => {
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);
    await flush();
    const writes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => writes.push(...records));
    const list = control();
    if (list) watch.observe(list, { attributes: true, subtree: true });

    page.diffs.append(document.createElement("div"));
    await flush();

    watch.disconnect();
    expect(writes).toEqual([]);
  });

  it("follows a toolbar GitHub replaces, re-observing its room", async () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    const page = pageOf("pr", "split");
    show(page, choiceOf(false).choice);

    const toolbar = findFilesToolbar(page);
    const replacement = toolbar?.cloneNode(true) as Element;
    for (const stale of replacement.querySelectorAll(".gh-prism-diff-view")) stale.remove();
    toolbar?.replaceWith(replacement);
    page.diffs.append(document.createElement("div"));
    await flush();

    vi.unstubAllGlobals();
    expect(observed.at(-1)).toBe(replacement);
    expect(control()?.nextElementSibling).toBe(findLayoutGear(page));
  });

  it("forgets a press released off the control", async () => {
    const page = pageOf("pr", "split");
    const log: string[] = [];
    recordItemClicks(log);
    show(page, choiceOf(false, log).choice);

    segment("unified")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    control()?.remove();
    await flush();
    segment("unified")?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await flush();

    expect(log).toEqual([]);
  });

  describe("Structural popover", () => {
    const card = () => segment("structural")?.nextElementSibling as HTMLElement | null | undefined;
    const focusStructural = () =>
      segment("structural")?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    it("opens at once on focus, beside the segment, with its tip and the doc link", async () => {
      show(pageOf("pr", "split"), choiceOf(false).choice);
      await flush();

      focusStructural();

      const link = card()?.querySelector("a");
      expect(card()?.textContent).toMatch(/Highlights what changed in the code/);
      expect(card()?.textContent).toContain(
        segment("structural")?.getAttribute("aria-description"),
      );
      expect(link?.textContent).toBe("What's a structural diff?");
      expect(link?.href).toBe(STRUCTURAL_DIFFS_DOC);
      expect(link?.target).toBe("_blank");
      expect(link?.rel).toBe("noopener noreferrer");
    });

    it("opens after a 200 ms hover and stays open while the pointer moves into it", async () => {
      show(pageOf("pr", "split"), choiceOf(false).choice);
      await flush();

      segment("structural")?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(199);
      expect(card()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      const opened = card();
      segment("structural")?.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: opened ?? null }),
      );
      opened?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(500);

      expect(opened?.isConnected).toBe(true);
    });

    it("closes on Escape", async () => {
      show(pageOf("pr", "split"), choiceOf(false).choice);
      await flush();
      focusStructural();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(card()).toBeNull();
    });

    it("shows the unavailable tip, and the link, where Structural isn't offered", async () => {
      show(pageOf("pr", "split"), choiceOf(false).choice, { offersStructural: false });
      await flush();

      focusStructural();

      const tip = segment("structural")?.getAttribute("aria-description") ?? "";
      expect(tip).toContain("isn't available");
      expect(card()?.textContent).toContain(tip);
      expect(card()?.querySelector("a")?.href).toBe(STRUCTURAL_DIFFS_DOC);
    });
  });
});
