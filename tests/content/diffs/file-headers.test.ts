// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showClickableHeaders } from "../../../entrypoints/content/diffs/file-headers";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import { loadViewedFixture, VIEWED_LIB_RS } from "../../fixtures/files-page";

describe("showClickableHeaders", () => {
  let controller: AbortController;
  let page: FilesPage;
  let chevronClicks: number;

  const bar = () => {
    const found = document.querySelector(`#${VIEWED_LIB_RS} [class*="diff-file-header__"]`);
    if (!found) throw new Error("fixture has no src/lib.rs header");
    return found;
  };
  const inBar = (selector: string) => {
    const found = bar().querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`src/lib.rs's header has no ${selector}`);
    return found;
  };
  const click = (target: Element) =>
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  beforeEach(() => {
    vi.useFakeTimers();
    loadViewedFixture();
    const found = findFilesPage(document);
    if (!found) throw new Error("fixture is not a Files changed page");
    page = found;
    controller = new AbortController();
    chevronClicks = 0;
    inBar("button").addEventListener("click", () => chevronClicks++);
    showClickableHeaders(page, controller.signal);
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it.each([
    ["the bar itself", () => bar()],
    ["a plain div in the bar", () => inBar(":scope > div")],
  ])("forwards a click on %s to the file's chevron once, after a macrotask", async (_, target) => {
    click(target());
    expect(chevronClicks).toBe(0);

    await vi.runAllTimersAsync();

    expect(chevronClicks).toBe(1);
  });

  it("forwards nothing once another extension has toggled the file, as Refined GitHub does", async () => {
    const chevron = inBar("button");
    chevron.addEventListener("click", () =>
      chevron
        .querySelector("svg")
        ?.classList.replace("octicon-chevron-down", "octicon-chevron-right"),
    );
    document.addEventListener(
      "click",
      (event) => {
        if (event.target === bar())
          chevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      { signal: controller.signal },
    );

    click(bar());
    await vi.runAllTimersAsync();

    expect(chevronClicks).toBe(1);
  });

  it.each([
    ["the chevron", () => inBar("button svg"), 1],
    ["the Viewed toggle", () => inBar("button[aria-pressed]"), 0],
    ["the path link", () => inBar("h3 a"), 0],
  ])("forwards nothing from %s", async (_, target, ownClicks) => {
    click(target());

    await vi.runAllTimersAsync();

    expect(chevronClicks).toBe(ownClicks);
  });

  it.each(["altKey", "ctrlKey", "metaKey", "shiftKey"])(
    "leaves a bar click with %s held to GitHub",
    async (modifier) => {
      bar().dispatchEvent(new MouseEvent("click", { bubbles: true, [modifier]: true }));

      await vi.runAllTimersAsync();

      expect(chevronClicks).toBe(0);
    },
  );

  it("removes its style and stops forwarding once its signal aborts", async () => {
    const stylesBefore = document.head.querySelectorAll("style").length;

    controller.abort();
    click(bar());
    await vi.runAllTimersAsync();

    expect(document.head.querySelectorAll("style").length).toBe(stylesBefore - 1);
    expect(chevronClicks).toBe(0);
  });
});
