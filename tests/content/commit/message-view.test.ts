// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showCommitMessage } from "../../../entrypoints/content/commit/message-view";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import { watchFilesPages } from "../../../entrypoints/content/visit/watch";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";

const container = () => document.querySelector(".gh-prism-commit-message");
const sheets = () =>
  [...document.head.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes("gh-prism-commit-message"),
  );
const box = () => {
  const found = document.querySelector('[class*="commitMessageContainer__"]');
  if (!found) throw new Error("no message box");
  return found;
};
const shows = (element: Element) => getComputedStyle(element).display !== "none";
// Runs the MutationObserver's pending microtask, and no timer.
const afterMutations = () => vi.advanceTimersByTimeAsync(0);

function pageOf(): FilesPage {
  const page = findFilesPage(document);
  if (!page) throw new Error("no Files page");
  return page;
}

let controller: AbortController;
let tasks: (() => void)[];
const idle = (task: () => void) => void tasks.push(task);
const runIdle = () => {
  for (const task of tasks.splice(0)) task();
};
const show = () => showCommitMessage(pageOf(), controller.signal, { idle });

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState(null, "", "/o/r/commit/dd95cdc");
  loadCommitFixture("lists");
  controller = new AbortController();
  tasks = [];
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

describe("showCommitMessage", () => {
  it("leaves GitHub's box showing until the browser is idle", () => {
    show();

    expect(container()).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("stands in for GitHub's box, unchanged, once idle", () => {
    const before = box().outerHTML;
    show();
    runIdle();

    expect(box().previousElementSibling?.matches(".gh-prism-commit-message.markdown-body")).toBe(
      true,
    );
    expect(shows(box())).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("removes itself and its sheet on abort, showing GitHub's box again", () => {
    show();
    runIdle();
    controller.abort();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
  });

  it("keeps GitHub's box for a message too large to render", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = "a".repeat(50_001);
    show();
    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
  });

  it("mounts nothing on a pull request's page", () => {
    history.replaceState(null, "", "/o/r/pull/1/changes");
    loadFixture();
    show();
    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it("mounts nothing when the idle task runs after abort", () => {
    show();
    controller.abort();
    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it("returns before the box when GitHub re-renders the card", async () => {
    show();
    runIdle();
    container()?.remove();
    await afterMutations();

    expect(box().previousElementSibling).toBe(container());

    const clone = box().cloneNode(true) as Element;
    box().replaceWith(clone);
    await afterMutations();

    expect(clone.previousElementSibling).toBe(container());
  });
});

describe("showCommitMessage across navigation", () => {
  const navigate = async (path: string, load: () => void) => {
    history.pushState(null, "", path);
    load();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(0);
  };
  const title = () => container()?.querySelector("h1")?.textContent;
  const titleOf = (name: "sha" | "mention") => {
    loadCommitFixture(name);
    return box().querySelector(":scope > span:first-child > div")?.textContent;
  };

  it("shows each commit's message and leaves nothing behind off commit pages", async () => {
    const mentionTitle = titleOf("mention");
    const shaTitle = titleOf("sha");
    watchFilesPages(
      window,
      {
        onVisit: () => (page, signal) =>
          showCommitMessage(page, signal, { idle: (task) => task() }),
        onMissing: () => {},
      },
      controller.signal,
    );
    await afterMutations();
    expect(title()).toBe(shaTitle);

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));
    expect(title()).toBe(mentionTitle);
    expect(document.querySelectorAll(".gh-prism-commit-message")).toHaveLength(1);

    await navigate("/o/r/pull/1/changes", loadFixture);
    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });
});
