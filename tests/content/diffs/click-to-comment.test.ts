// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ClickToCommentChoice,
  clickToCommentItem,
  edgeStep,
  rangeEnd,
} from "../../../entrypoints/content/diffs/click-to-comment";
import type { MenuGate, PrismMenuItem } from "../../../entrypoints/content/diffs/prism-menu";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import commitSplit from "../../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../../fixtures/commit-page-diff-unified.html?raw";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";
import prUnified from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";

const SPLIT = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";
const COMMIT = "diff-cc3fb1ce8d7fcf13784c71a054155c0fcde23acb2ebee6c808198187e6232c6a";
const RENAME = "diff-c2a0fff5575ebf83634ea4da334a24d52775bcef6700ed6f9d0bc4e3db79e42a";

describe("rangeEnd", () => {
  const line = {};

  it.each([
    { slots: [line], end: 0 },
    { slots: [line, line, line], end: 2 },
    { slots: [line, "gap", line], end: 2 },
    { slots: [line, line, "stop", line], end: 1 },
    { slots: [line, "gap", "gap"], end: 0 },
  ] as const)("ends $slots at $end", ({ slots, end }) => {
    expect(rangeEnd(slots)).toBe(end);
  });
});

describe("edgeStep", () => {
  it.each([
    { y: 500, step: 0 },
    { y: 48, step: 0 },
    { y: 24, step: -12 },
    { y: 0, step: -24 },
    { y: -100, step: -24 },
    { y: 976, step: 12 },
    { y: 1000, step: 24 },
    { y: 1100, step: 24 },
  ])("scrolls $step px for a pointer at $y in a 1000 px window", ({ y, step }) => {
    expect(edgeStep(y, 1000)).toBe(step);
  });
});

describe("clickToCommentItem", () => {
  let controller: AbortController;
  let warn: ReturnType<typeof vi.spyOn>;
  /** Every element GitHub's stand-in "+" was clicked in, and every number cell pressed. */
  let log: string[];

  const active = () => document.documentElement.hasAttribute("data-gh-prism-click-comment");
  const ranged = () =>
    [...document.querySelectorAll("[data-gh-prism-comment-range]")].map((el) =>
      el.getAttribute("data-line-anchor"),
    );

  /** A page holding `table`, from the `kind` page's fixture. */
  function pageOf(table: string, kind: "pr" | "commit" = "pr"): FilesPage {
    (kind === "pr" ? loadFixture : loadCommitFixture)();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture has no page");
    const region = document.createElement("div");
    region.innerHTML = table;
    page.diffs.append(region);
    return page;
  }

  /**
   * Mimics GitHub: one "+" moves into whichever code cell is hovered (or, with `mounts` false,
   * unmounts on a hover), and number-cell presses and "+" clicks are logged.
   */
  function standInGitHub(mounts = true) {
    const plus = document.createElement("div");
    plus.innerHTML = '<button aria-label="Add comment"></button>';
    plus.firstElementChild?.addEventListener("click", () =>
      log.push(`+ ${plus.closest("td")?.getAttribute("data-line-anchor")}`),
    );
    document.addEventListener(
      "mouseover",
      (event) => {
        const cell = (event.target as Element).closest("td.diff-text-cell");
        if (!mounts) plus.remove();
        else if (cell) requestAnimationFrame(() => cell.append(plus));
      },
      { signal: controller.signal },
    );
    document.addEventListener(
      "mousedown",
      (event) => {
        const number = event.target as Element;
        const code = number.nextElementSibling?.matches(".empty-diff-line")
          ? number.nextElementSibling.nextElementSibling
          : number.nextElementSibling;
        log.push(
          `${event.shiftKey ? "shift-press" : "press"} ${code?.getAttribute("data-line-anchor")}`,
        );
      },
      { signal: controller.signal },
    );
    return plus;
  }

  /** Hovers `cell` so the stand-in "+" mounts there, as a pointer moving onto it would. */
  async function hover(cell: Element) {
    cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function show(page: FilesPage, { on = true, gate = "open" as MenuGate } = {}) {
    const choice: ClickToCommentChoice = { on };
    const save = vi.fn<(on: boolean) => void>();
    const item = clickToCommentItem(page, controller.signal, { choice, save });
    item.follow(gate);
    return { item, choice, save };
  }

  const cell = (anchor: string, index = 0) => {
    const found = document.querySelectorAll(`td.diff-text-cell[data-line-anchor="${anchor}"]`)[
      index
    ];
    if (!found) throw new Error(`no cell ${anchor}`);
    return found;
  };
  const textOf = (target: Element) => target.querySelector(".diff-text-inner") ?? target;

  const pointer = (type: string, init: PointerEventInit = {}) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse",
      button: 0,
      ...init,
    });

  /** Presses `target`, moves over each of `over`, and releases. */
  async function drag(target: Element, over: Element[] = [], init: PointerEventInit = {}) {
    target.dispatchEvent(pointer("pointerdown", init));
    for (const cell of over) {
      document.elementsFromPoint = () => [textOf(cell)];
      document.dispatchEvent(pointer("pointermove"));
    }
    document.dispatchEvent(pointer("pointerup"));
    await frames(2);
  }

  async function frames(count: number) {
    for (let i = 0; i < count; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  beforeEach(() => {
    controller = new AbortController();
    log = [];
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    history.replaceState(null, "", "/o/r/pull/1/changes");
    document.elementsFromPoint = () => [];
    document.caretPositionFromPoint = () => null;
  });

  afterEach(() => {
    controller.abort();
    warn.mockRestore();
  });

  it("offers an unchecked item with its subtitle", () => {
    const { item } = show(pageOf(prSplit), { on: false });

    expect(item).toMatchObject<Partial<PrismMenuItem>>({
      id: "gh-prism-click-to-comment",
      text: "Click anywhere on a line to comment",
      subtitle: "Hold Shift to select text",
    });
    expect(item.checked()).toBe(false);
  });

  it("marks the page and mounts its sheet while checked, and clears both once unchecked", () => {
    const { item, save } = show(pageOf(prSplit), { on: false });
    const sheets = () => document.head.querySelectorAll("style").length;
    const before = sheets();

    item.pick();

    expect(save).toHaveBeenLastCalledWith(true);
    expect(active()).toBe(true);
    expect(sheets()).toBe(before + 1);

    item.pick();

    expect(save).toHaveBeenLastCalledWith(false);
    expect(active()).toBe(false);
    expect(sheets()).toBe(before);
  });

  it("listens for no press and marks nothing while unchecked", async () => {
    const page = pageOf(prSplit);
    const listen = vi.spyOn(page.diffs, "addEventListener");
    standInGitHub();
    show(page, { on: false });

    await hover(cell(`${SPLIT}R4`, 1));
    await drag(textOf(cell(`${SPLIT}R4`, 1)));

    expect(listen.mock.calls.map(([type]) => type)).not.toContain("pointerdown");
    expect(ranged()).toEqual([]);
    expect(active()).toBe(false);
    expect(log).toEqual([]);
  });

  it("stays off while the menu's gate is given up", () => {
    const { item } = show(pageOf(prSplit), { on: false, gate: "given up" });

    item.pick();

    expect(active()).toBe(false);
  });

  it.each([
    { name: "a pull request in Split", table: prSplit, kind: "pr", anchor: `${SPLIT}R4` },
    { name: "a pull request in Unified", table: prUnified, kind: "pr", anchor: `${RENAME}L14` },
    { name: "a commit in Split", table: commitSplit, kind: "commit", anchor: `${COMMIT}R135` },
    { name: "a commit in Unified", table: commitUnified, kind: "commit", anchor: `${COMMIT}R135` },
  ] as const)("a click on $name clicks only that line's +", async ({ table, kind, anchor }) => {
    standInGitHub();
    show(pageOf(table, kind));

    await hover(cell(anchor));
    await drag(textOf(cell(anchor)));

    await vi.waitFor(() => expect(log).toEqual([`+ ${anchor}`]));
  });

  it("presses the number cell first while the hash names a line", async () => {
    history.replaceState(null, "", `#${SPLIT}R1-R2`);
    standInGitHub();
    show(pageOf(prSplit));

    await hover(cell(`${SPLIT}R4`, 1));
    await drag(textOf(cell(`${SPLIT}R4`, 1)));

    await vi.waitFor(() => expect(log).toEqual([`press ${SPLIT}R4`, `+ ${SPLIT}R4`]));
  });

  it("selects a dragged range through the number cells, then clicks the last line's +", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);
    start.dispatchEvent(pointer("pointerdown"));
    document.elementsFromPoint = () => [textOf(cell(`${SPLIT}R6`, 1))];
    document.dispatchEvent(pointer("pointermove"));

    expect(ranged()).toEqual([`${SPLIT}R4`, `${SPLIT}R5`, `${SPLIT}R6`]);

    document.dispatchEvent(pointer("pointerup"));
    await vi.waitFor(() => expect(log).toHaveLength(3));

    expect(log).toEqual([`press ${SPLIT}R4`, `shift-press ${SPLIT}R6`, `+ ${SPLIT}R6`]);
    expect(ranged()).toEqual([]);
  });

  it("waits for a press to apply before Shift-pressing, as GitHub's commit page needs", async () => {
    standInGitHub();
    let anchor: string | undefined;
    document.addEventListener(
      "mousedown",
      (event) => {
        const line = (event.target as Element).nextElementSibling?.getAttribute("data-line-anchor");
        if (!event.shiftKey) queueMicrotask(() => (anchor = line ?? undefined));
        else log.push(`range ${anchor ?? "none"}-${line}`);
      },
      { signal: controller.signal },
    );
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);

    await drag(start, [cell(`${SPLIT}R6`, 1)]);

    await vi.waitFor(() => expect(log).toContain(`range ${SPLIT}R4-${SPLIT}R6`));
  });

  it("opens one line's box when the pointer moves within that line before release", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);

    await drag(textOf(start), [start]);

    await vi.waitFor(() => expect(log).toEqual([`+ ${SPLIT}R4`]));
  });

  it("leaves the marks untouched while the pointer moves within the same row", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);
    start.dispatchEvent(pointer("pointerdown"));
    document.elementsFromPoint = () => [textOf(cell(`${SPLIT}R6`, 1))];
    document.dispatchEvent(pointer("pointermove"));
    const writes = new MutationObserver(() => {});
    writes.observe(document.body, { attributes: true, subtree: true });

    document.dispatchEvent(pointer("pointermove"));

    expect(writes.takeRecords()).toEqual([]);
    expect(ranged()).toEqual([`${SPLIT}R4`, `${SPLIT}R5`, `${SPLIT}R6`]);
  });

  it("follows only the pointer that pressed, even when a thread stops its release", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);
    start.addEventListener("pointerup", (event) => event.stopPropagation());
    start.dispatchEvent(pointer("pointerdown", { pointerId: 1 }));

    document.dispatchEvent(pointer("pointerup", { pointerId: 2 }));
    await frames(2);
    expect(log).toEqual([]);

    start.dispatchEvent(pointer("pointerup", { pointerId: 1 }));
    await vi.waitFor(() => expect(log).toEqual([`+ ${SPLIT}R4`]));
  });

  it("cancels a drag on Escape, clearing its marks and opening nothing", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    const start = cell(`${SPLIT}R4`, 1);
    await hover(start);
    start.dispatchEvent(pointer("pointerdown"));
    document.elementsFromPoint = () => [textOf(cell(`${SPLIT}R6`, 1))];
    document.dispatchEvent(pointer("pointermove"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(pointer("pointerup"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ranged()).toEqual([]);
    expect(log).toEqual([]);
  });

  it.each([
    { name: "the number cell", target: () => cell(`${SPLIT}R4`, 1).previousElementSibling },
    { name: "the +", target: () => cell(`${SPLIT}R4`, 1).querySelector("button") },
    { name: "a hunk header", target: () => document.querySelector("td.diff-hunk-cell code") },
    {
      name: "a link in the code",
      target: () => textOf(cell(`${SPLIT}R4`, 1)).appendChild(document.createElement("a")),
    },
  ])("does nothing for a press on $name", async ({ target }) => {
    standInGitHub();
    show(pageOf(prSplit));
    await hover(cell(`${SPLIT}R4`, 1));
    const pressed = target();
    if (!pressed) throw new Error("no target");
    const down = pointer("pointerdown");

    pressed.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(false);
    expect(ranged()).toEqual([]);
  });

  it("leaves a touch press and a line with no + to GitHub", async () => {
    standInGitHub();
    show(pageOf(prSplit));
    await hover(cell(`${SPLIT}R4`, 1));
    const touch = pointer("pointerdown", { pointerType: "touch" });
    const bare = pointer("pointerdown");

    textOf(cell(`${SPLIT}R4`, 1)).dispatchEvent(touch);
    textOf(cell(`${SPLIT}R5`, 1)).dispatchEvent(bare);

    expect(touch.defaultPrevented).toBe(false);
    expect(bare.defaultPrevented).toBe(false);
  });

  it("gives up for the page with one warning once GitHub's + never mounts", async () => {
    const plus = standInGitHub(false);
    show(pageOf(prSplit));
    const line = cell(`${SPLIT}R4`, 1);
    line.append(plus);

    await drag(textOf(line));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());

    expect(warn.mock.calls[0]?.[0]).toMatch(/^gh-prism: /);
    expect(active()).toBe(false);
    const later = pointer("pointerdown");
    textOf(line).dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});
