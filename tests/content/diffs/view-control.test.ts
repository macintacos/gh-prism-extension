// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(document.head.querySelector("style")).toBeNull();
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
});
