// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findFilesPage } from "../entrypoints/content/files-page";
import type { IntentResult } from "../entrypoints/content/intent";
import { showSections } from "../entrypoints/content/sections-view";
import css from "../entrypoints/content/sections-view.css?raw";
import { byId, loadFixture } from "./fixtures/files-page";

let controller: AbortController;

const view = () => document.querySelector(".gh-prism-sections");

const generatedDirKey = "implementation:src/generated";

const dirToggle = (key: string) => {
  const found = document.querySelector(`.gh-prism-dir[data-dir="${key}"]`);
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no toggle for ${key}`);
  return found;
};

const row = (path: string) => {
  const found = [...document.querySelectorAll<HTMLElement>("a.gh-prism-file")].find(
    (file) => file.dataset.path === path,
  );
  if (!found) throw new Error(`view has no row for ${path}`);
  return found;
};

const nativeLink = (path: string) => {
  const link = byId(path).querySelector('a[href^="#diff-"]');
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no native link for ${path}`);
  return link;
};

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

const pathsIn = (section: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-section="${section}"] a.gh-prism-file`)].map(
    (file) => file.dataset.path,
  );

/** Replaces the view `beforeEach` mounted with one that waits on `intent`. */
function remountWith(intent: Promise<IntentResult>): void {
  controller.abort();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showSections(page, controller.signal, intent);
}

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showSections(page, controller.signal);
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

describe("showSections", () => {
  it("groups the files into non-empty sections in order", () => {
    const sections = [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
      (section) => [
        section.dataset.section,
        [...section.querySelectorAll<HTMLElement>("a.gh-prism-file")].map(
          (file) => file.dataset.path,
        ),
      ],
    );
    expect(sections).toEqual([
      [
        "implementation",
        [
          "src/generated/schema.rs",
          "src/engine.rs",
          "src/helpers.rs",
          "src/lib.rs",
          "src/notes.rs",
          "src/parser.rs",
          "src/render.rs",
        ],
      ],
      ["tests", ["tests/integration.rs"]],
      ["docs", ["docs/guide.md", "README.md"]],
      ["config", ["config/app.toml", "Cargo.toml"]],
      ["generated", ["Cargo.lock"]],
    ]);
  });

  it("counts each section's files", () => {
    const counts = [...document.querySelectorAll(".gh-prism-section")].map(
      (section) => section.querySelector(".gh-prism-counter")?.textContent,
    );
    expect(counts).toEqual(["7", "1", "2", "2", "1"]);
  });

  it("sits just before the native tree", () => {
    expect(document.querySelector('ul[role="tree"]')?.previousElementSibling).toBe(view());
  });

  it("injects its stylesheet into the document head until aborted", () => {
    const stylesheet = () => document.head.querySelector("style");
    expect(stylesheet()?.textContent).toBe(css);
    controller.abort();
    expect(stylesheet()).toBeNull();
  });

  it("keeps one view when the sidebar comes back holding a stale one", () => {
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    const fresh = new AbortController();
    showSections(page, fresh.signal);
    expect(document.querySelectorAll(".gh-prism-sections")).toHaveLength(1);
    fresh.abort();
  });

  it("drops a section once its last file leaves the tree", async () => {
    byId("Cargo.lock").remove();
    await afterDebounce();
    expect(document.querySelector('[data-section="generated"]')).toBeNull();
    expect(document.querySelectorAll("a.gh-prism-file")).toHaveLength(12);
  });

  it("follows the active file", async () => {
    expect(row("src/lib.rs").getAttribute("aria-current")).toBe("true");
    byId("src/lib.rs").removeAttribute("aria-current");
    byId("src/engine.rs").setAttribute("aria-current", "true");
    await afterDebounce();
    expect(row("src/engine.rs").getAttribute("aria-current")).toBe("true");
    expect(row("src/lib.rs").hasAttribute("aria-current")).toBe(false);
  });

  it("mirrors comment counts and labels", () => {
    expect(row("src/engine.rs").querySelector(".octicon-comment")).not.toBeNull();
    expect(row("src/engine.rs").getAttribute("aria-label")).toBe("engine.rs has 1 comment");
  });

  it("mirrors status icons", () => {
    expect(row("src/helpers.rs").querySelector("svg.octicon-file-moved")).not.toBeNull();
  });

  it("renders file names as text", async () => {
    const path = "docs/<img src=x onerror=alert(1)>.md";
    const native = byId("docs/guide.md").cloneNode(true);
    if (!(native instanceof HTMLElement)) throw new Error("clone is not an element");
    native.id = path;
    byId("docs/guide.md").after(native);
    await afterDebounce();
    expect(view()?.querySelector("img")).toBeNull();
    expect(row(path).querySelector(".gh-prism-name")?.textContent).toBe(
      "<img src=x onerror=alert(1)>.md",
    );
  });

  it("forwards a plain click to the native link", () => {
    const click = vi.spyOn(nativeLink("src/render.rs"), "click");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    row("src/render.rs").dispatchEvent(event);
    expect(click).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves a click alone when its native file has gone", () => {
    byId("src/render.rs").remove();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    row("src/render.rs").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it.each([{ metaKey: true }, { ctrlKey: true }])("lets %o clicks follow the href", (modifiers) => {
    const click = vi.spyOn(nativeLink("src/render.rs"), "click");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
    row("src/render.rs").dispatchEvent(event);
    expect(click).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("collapses a directory across re-renders", async () => {
    dirToggle(generatedDirKey).click();
    expect(dirToggle(generatedDirKey).getAttribute("aria-expanded")).toBe("false");
    expect(row("src/generated/schema.rs").closest("[hidden]")).not.toBeNull();
    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();
    expect(dirToggle(generatedDirKey).getAttribute("aria-expanded")).toBe("false");
    expect(row("src/generated/schema.rs").closest("[hidden]")).not.toBeNull();
  });

  it("re-expands a collapsed directory", () => {
    dirToggle(generatedDirKey).click();
    dirToggle(generatedDirKey).click();
    expect(dirToggle(generatedDirKey).getAttribute("aria-expanded")).toBe("true");
    expect(row("src/generated/schema.rs").closest("[hidden]")).toBeNull();
  });

  it("keeps focus on a directory toggle after activating it", () => {
    const before = dirToggle(generatedDirKey);
    before.focus();
    before.click();
    expect(document.activeElement).toBe(dirToggle(generatedDirKey));
  });

  it("keeps focus on the same file across a re-render", async () => {
    const before = row("src/render.rs");
    before.focus();
    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();
    expect(row("src/render.rs")).not.toBe(before);
    expect(document.activeElement).toBe(row("src/render.rs"));
  });

  it("removes itself and stops rendering once aborted", async () => {
    controller.abort();
    expect(view()).toBeNull();
    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();
    expect(view()).toBeNull();
  });

  it("keeps path sections while the intent is pending", () => {
    remountWith(Promise.withResolvers<IntentResult>().promise);
    expect(pathsIn("implementation")).toContain("src/notes.rs");
    expect(pathsIn("implementation")).toContain("src/parser.rs");
  });

  it("moves intent-marked files into Documentation once it settles", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    deferred.resolve({ ok: true, paths: new Set(["src/parser.rs", "src/notes.rs"]) });
    await afterDebounce();
    expect(pathsIn("docs")).toEqual([
      "docs/guide.md",
      "src/notes.rs",
      "src/parser.rs",
      "README.md",
    ]);
    expect(document.querySelector(".gh-prism-notice")).toBeNull();
  });

  it("keeps the moved files across a re-render", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    deferred.resolve({ ok: true, paths: new Set(["src/parser.rs", "src/notes.rs"]) });
    await afterDebounce();
    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();
    expect(pathsIn("docs")).toEqual([
      "docs/guide.md",
      "src/notes.rs",
      "src/parser.rs",
      "README.md",
    ]);
  });

  it.each([
    {
      problem: "commit-filtered",
      copy: "Grouped by path. Docstring-only changes are detected when viewing all commits.",
    },
    {
      problem: "no-access",
      copy: "Grouped by path. Sign in to GitHub to detect docstring-only changes.",
    },
  ] as const)(
    "keeps path sections and shows a notice when the intent is $problem",
    async ({ problem, copy }) => {
      const deferred = Promise.withResolvers<IntentResult>();
      remountWith(deferred.promise);
      deferred.resolve({ ok: false, problem });
      await afterDebounce();
      expect(pathsIn("implementation")).toContain("src/parser.rs");
      expect(view()?.firstElementChild?.className).toBe("gh-prism-notice");
      expect(view()?.firstElementChild?.textContent).toBe(copy);
    },
  );

  it("leaves no view when the intent settles after abort", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    controller.abort();
    deferred.resolve({ ok: true, paths: new Set(["src/parser.rs"]) });
    await afterDebounce();
    expect(view()).toBeNull();
  });
});
