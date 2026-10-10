// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findFilesPage } from "../entrypoints/content/files-page";
import { showSections } from "../entrypoints/content/sections-view";
import fixture from "./fixtures/files-page.html?raw";

let controller: AbortController;

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el;
};

const view = () => document.querySelector(".gh-prism-sections");

const row = (path: string) => {
  const found = [...document.querySelectorAll<HTMLElement>("a.gh-prism-file")].find(
    (a) => a.dataset.path === path,
  );
  if (!found) throw new Error(`view has no row for ${path}`);
  return found;
};

const nativeLink = (path: string) => {
  const link = byId(path).querySelector('a[href^="#diff-"]');
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no native link for ${path}`);
  return link;
};

// Lets the MutationObserver's microtask run, then the 50 ms debounce.
const settle = () => vi.advanceTimersByTimeAsync(50);

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = fixture;
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
    const sections = [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map((s) => [
      s.dataset.section,
      [...s.querySelectorAll<HTMLElement>("a.gh-prism-file")].map((a) => a.dataset.path),
    ]);
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
      (s) => s.querySelector(".gh-prism-counter")?.textContent,
    );
    expect(counts).toEqual(["7", "1", "2", "2", "1"]);
  });

  it("sits just before the native tree", () => {
    expect(document.querySelector('ul[role="tree"]')?.previousElementSibling).toBe(view());
  });

  it("drops a section once its last file leaves the tree", async () => {
    byId("Cargo.lock").remove();
    await settle();
    expect(document.querySelector('[data-section="generated"]')).toBeNull();
    expect(document.querySelectorAll("a.gh-prism-file")).toHaveLength(12);
  });

  it("follows the active file", async () => {
    expect(row("src/lib.rs").getAttribute("aria-current")).toBe("true");
    byId("src/lib.rs").removeAttribute("aria-current");
    byId("src/engine.rs").setAttribute("aria-current", "true");
    await settle();
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
    await settle();
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

  it.each([{ metaKey: true }, { ctrlKey: true }])("lets %o clicks follow the href", (mods) => {
    const click = vi.spyOn(nativeLink("src/render.rs"), "click");
    row("src/render.rs").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }),
    );
    expect(click).not.toHaveBeenCalled();
  });

  it("collapses a directory across re-renders", async () => {
    const toggle = () => {
      const found = document.querySelector<HTMLElement>(
        '.gh-prism-dir[data-dir="implementation:src/generated"]',
      );
      if (!found) throw new Error("no src/generated toggle");
      return found;
    };
    toggle().click();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(row("src/generated/schema.rs").closest("[hidden]")).not.toBeNull();
    byId("src/lib.rs").removeAttribute("aria-current");
    await settle();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(row("src/generated/schema.rs").closest("[hidden]")).not.toBeNull();
  });

  it("keeps focus on the same file across a re-render", async () => {
    const before = row("src/render.rs");
    before.focus();
    byId("src/lib.rs").removeAttribute("aria-current");
    await settle();
    expect(row("src/render.rs")).not.toBe(before);
    expect(document.activeElement).toBe(row("src/render.rs"));
  });

  it("removes itself and stops rendering once aborted", async () => {
    controller.abort();
    expect(view()).toBeNull();
    byId("src/lib.rs").removeAttribute("aria-current");
    await settle();
    expect(view()).toBeNull();
  });
});
