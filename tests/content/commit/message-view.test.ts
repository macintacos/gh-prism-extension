// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CommitMessageChoice,
  showCommitMessage,
} from "../../../entrypoints/content/commit/message-view";
import {
  type FilesPage,
  findCommitMessage,
  findFilesPage,
} from "../../../entrypoints/content/files-page";
import { watchFilesPages } from "../../../entrypoints/content/visit/watch";
import type { CommitMessageView } from "../../../utils/prefs";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";

const container = () => document.querySelector<HTMLElement>(".gh-prism-commit-message");
const viewButton = () => document.querySelector<HTMLButtonElement>(".gh-prism-commit-view-switch");
const sheets = () =>
  [...document.head.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes("gh-prism-commit-message"),
  );
const messageOf = () => {
  const found = findCommitMessage(pageOf());
  if (!found) throw new Error("no commit message");
  return found;
};
const box = () => messageOf().box;
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
const afterSections = (task: () => void) => void tasks.push(task);
const runIdle = () => {
  for (const task of tasks.splice(0)) task();
};
let choice: CommitMessageChoice;
let save: (view: CommitMessageView) => void;
const show = () => showCommitMessage(pageOf(), controller.signal, { afterSections, choice, save });

beforeEach(() => {
  choice = { view: "rendered" };
  save = vi.fn();
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

    const shown = box().previousElementSibling as HTMLElement | null;
    expect(shown?.matches(".gh-prism-commit-message")).toBe(true);
    expect(shown?.querySelector(".gh-prism-commit-message-body.markdown-body")).not.toBeNull();
    expect(shown?.dataset.view).toBe("rendered");
    expect(shows(box())).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("opens on GitHub's box, unchanged, when the tab last picked plain text", () => {
    choice.view = "plaintext";
    const before = box().outerHTML;

    show();
    runIdle();

    const shown = box().previousElementSibling;
    expect(shown?.matches(".gh-prism-commit-message")).toBe(true);
    expect(shows(box())).toBe(true);
    const body = shown?.querySelector(".gh-prism-commit-message-body");
    if (!body) throw new Error("no body");
    expect(shows(body)).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("flips to GitHub's box, unchanged, and back, saving each pick", () => {
    show();
    runIdle();
    const before = box().outerHTML;
    const button = viewButton();
    if (!button) throw new Error("no switch");
    const body = container()?.querySelector(".gh-prism-commit-message-body");
    if (!body) throw new Error("no body");
    expect(button.parentElement).toBe(container());
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Show plain text");

    button.click();

    expect(shows(box())).toBe(true);
    expect(shows(body)).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Show rendered Markdown");
    expect(choice.view).toBe("plaintext");
    expect(save).toHaveBeenLastCalledWith("plaintext");
    expect(box().outerHTML).toBe(before);
    expect(viewButton()).toBe(button);

    button.click();

    // happy-dom keeps the box's `display: none` once the `+` rule stops matching; e2e proves it shows.
    expect(container()?.dataset.view).toBe("rendered");
    expect(shows(body)).toBe(true);
    expect(save).toHaveBeenLastCalledWith("rendered");
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
    expect(viewButton()).toBeNull();
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

  it.each(["rendered", "plaintext"] as const)(
    "returns before the box, switch and all, when GitHub re-renders the card in the %s view",
    async (view) => {
      choice.view = view;
      show();
      runIdle();
      container()?.remove();
      await afterMutations();

      expect(box().previousElementSibling).toBe(container());

      const clone = box().cloneNode(true) as Element;
      box().replaceWith(clone);
      await afterMutations();

      expect(clone.previousElementSibling).toBe(container());
      expect(viewButton()?.parentElement).toBe(container());
      expect(shows(clone)).toBe(view === "plaintext");

      clone.remove();
      await afterMutations();

      expect(container()).toBeNull();
    },
  );
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
    return messageOf().title.textContent;
  };
  const watchCommits = () =>
    watchFilesPages(
      window,
      {
        onVisit: () => (page, signal) =>
          showCommitMessage(page, signal, { afterSections: (task) => task(), choice, save }),
        onMissing: () => {},
      },
      controller.signal,
    );

  it("shows each commit's message and leaves nothing behind off commit pages", async () => {
    const mentionTitle = titleOf("mention");
    const shaTitle = titleOf("sha");
    watchCommits();
    await afterMutations();
    expect(title()).toBe(shaTitle);

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));
    expect(title()).toBe(mentionTitle);
    expect(document.querySelectorAll(".gh-prism-commit-message")).toHaveLength(1);

    await navigate("/o/r/pull/1/changes", loadFixture);
    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it("opens the next commit in the view the tab last picked", async () => {
    watchCommits();
    await afterMutations();
    viewButton()?.click();

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));

    expect(container()?.dataset.view).toBe("plaintext");
    expect(shows(box())).toBe(true);
    expect(viewButton()?.getAttribute("aria-label")).toBe("Show rendered Markdown");
  });
});
