// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { findFilesPage } from "../entrypoints/content/files-page";
import type { IntentResult, IntentSection, Placement } from "../entrypoints/content/intent";
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

const whole = (section: IntentSection): Placement => ({ kind: "whole", section });

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
    deferred.resolve({
      ok: true,
      placements: new Map([
        ["src/parser.rs", whole("docs")],
        ["src/notes.rs", whole("docs")],
      ]),
    });
    await afterDebounce();
    expect(pathsIn("docs")).toEqual([
      "docs/guide.md",
      "src/notes.rs",
      "src/parser.rs",
      "README.md",
    ]);
    expect(document.querySelector(".gh-prism-notice")).toBeNull();
  });

  it("moves a file intent places in tests out of Implementation once it settles", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    deferred.resolve({
      ok: true,
      placements: new Map([["src/lib.rs", whole("tests")]]),
    });
    await afterDebounce();
    expect(pathsIn("tests")).toEqual(["src/lib.rs", "tests/integration.rs"]);
    expect(pathsIn("implementation")).not.toContain("src/lib.rs");
  });

  it("keeps the moved files across a re-render", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    deferred.resolve({
      ok: true,
      placements: new Map([
        ["src/parser.rs", whole("docs")],
        ["src/notes.rs", whole("docs")],
      ]),
    });
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

  it("keeps focus on a file's row when intent moves the file whole", async () => {
    const deferred = Promise.withResolvers<IntentResult>();
    remountWith(deferred.promise);
    row("src/render.rs").focus();
    deferred.resolve({
      ok: true,
      placements: new Map([["src/render.rs", whole("docs")]]),
    });
    await afterDebounce();
    expect(row("src/render.rs").dataset.section).toBe("docs");
    expect(document.activeElement).toBe(row("src/render.rs"));
  });

  it.each([
    {
      problem: "commit-filtered",
      copy: "Grouped by path. Docstring-only and inline-test changes are detected when viewing all commits.",
    },
    {
      problem: "no-access",
      copy: "Grouped by path. Sign in to GitHub to detect docstring-only and inline-test changes.",
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
    deferred.resolve({
      ok: true,
      placements: new Map([["src/parser.rs", whole("docs")]]),
    });
    await afterDebounce();
    expect(view()).toBeNull();
  });

  describe("a split file", () => {
    const RENDER_DIFF = "diff-0a09";
    const RENDER_SPLIT: IntentResult = {
      ok: true,
      placements: new Map([
        [
          "src/render.rs",
          {
            kind: "split",
            shares: [
              { section: "implementation", hunks: [{ first: 2, last: 8 }] },
              { section: "docs", hunks: [{ first: 22, last: 28 }] },
            ],
          },
        ],
      ]),
    };

    let scrollIntoView: MockInstance<Element["scrollIntoView"]>;

    beforeEach(() => {
      scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    });
    afterEach(() => {
      scrollIntoView.mockRestore();
    });

    /** Mounts the view with `result` already landed, and lets it render. */
    async function landed(result: IntentResult): Promise<void> {
      remountWith(Promise.resolve(result));
      await afterDebounce();
    }

    const inSection = (section: string, selector: string) => {
      const found = document.querySelector<HTMLElement>(`[data-section="${section}"] ${selector}`);
      if (!found) throw new Error(`no ${selector} in ${section}`);
      return found;
    };

    const diffList = () => {
      const diffs = document.querySelector('[data-testid="diff-content"]');
      if (!diffs) throw new Error("fixture has no diff list");
      return diffs;
    };

    /** Mounts render.rs's diff under the fixture's diff list, with a row for each of `lines`. */
    function mountRenderDiff(...lines: number[]): void {
      const region = document.createElement("div");
      region.id = RENDER_DIFF;
      region.innerHTML = `<table>${lines
        .map((n) => `<tr><td data-line-anchor="${RENDER_DIFF}R${n}">${n}</td></tr>`)
        .join("")}</table>`;
      diffList().append(region);
    }

    const lineRow = (line: number) => {
      const found = document
        .querySelector(`[data-line-anchor="${RENDER_DIFF}R${line}"]`)
        ?.closest("tr");
      if (!found) throw new Error(`no diff row for line ${line}`);
      return found;
    };

    const clickAt = (target: Element, init: MouseEventInit = {}) => {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it("lists the file under each section its hunks land in, with its own hunk rows", async () => {
      await landed(RENDER_SPLIT);
      const entries = [
        ...document.querySelectorAll<HTMLElement>('a.gh-prism-file[data-path="src/render.rs"]'),
      ].map((file) => ({
        section: file.dataset.section,
        label: file.getAttribute("aria-label"),
        partial: file.querySelector(".gh-prism-partial") !== null,
        hunks: [...(file.closest("li")?.querySelectorAll<HTMLElement>(".gh-prism-hunk") ?? [])].map(
          (hunk) => [hunk.textContent, hunk.getAttribute("href")],
        ),
      }));
      expect(entries).toEqual([
        {
          section: "implementation",
          label: "render.rs, partial",
          partial: true,
          hunks: [["Lines 2–8", "#diff-0a09R2"]],
        },
        {
          section: "docs",
          label: "render.rs, partial",
          partial: true,
          hunks: [["Lines 22–28", "#diff-0a09R22"]],
        },
      ]);
    });

    it("counts the file in each section it is listed under", async () => {
      await landed(RENDER_SPLIT);
      const counts = [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
        (section) => [
          section.dataset.section,
          section.querySelector(".gh-prism-counter")?.textContent,
        ],
      );
      expect(counts).toEqual([
        ["implementation", "7"],
        ["tests", "1"],
        ["docs", "3"],
        ["config", "2"],
        ["generated", "1"],
      ]);
    });

    it("gives a whole-file move and a path-only file no marker and no hunk list", async () => {
      await landed({
        ok: true,
        placements: new Map([["src/parser.rs", whole("docs")]]),
      });
      expect(pathsIn("docs")).toContain("src/parser.rs");
      expect(document.querySelector(".gh-prism-partial, .gh-prism-hunks")).toBeNull();
    });

    it("labels a one-line hunk by its line", async () => {
      await landed({
        ok: true,
        placements: new Map([
          [
            "src/render.rs",
            {
              kind: "split",
              shares: [
                { section: "implementation", hunks: [{ first: 2, last: 2 }] },
                { section: "docs", hunks: [{ first: 22, last: 28 }] },
              ],
            },
          ],
        ]),
      });
      expect(inSection("implementation", ".gh-prism-hunk").textContent).toBe("Line 2");
    });

    it("renders a hunk with no head lines as a disabled row that a click leaves alone", async () => {
      await landed({
        ok: true,
        placements: new Map([
          [
            "src/render.rs",
            {
              kind: "split",
              shares: [
                { section: "implementation", hunks: [undefined] },
                { section: "docs", hunks: [{ first: 22, last: 28 }] },
              ],
            },
          ],
        ]),
      });
      const removed = inSection("implementation", ".gh-prism-hunk");
      expect(removed.matches('span.gh-prism-hunk[aria-disabled="true"]')).toBe(true);
      expect(removed.textContent).toBe("Removed lines");
      expect(removed.title).not.toBe("");
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");
      const event = clickAt(removed);
      expect(event.defaultPrevented).toBe(false);
      expect(click).not.toHaveBeenCalled();
    });

    it("reveals a hunk's row on a plain click, keeping the default from following the link", async () => {
      await landed(RENDER_SPLIT);
      mountRenderDiff(2, 22);
      const event = clickAt(inSection("docs", ".gh-prism-hunk"));
      await afterDebounce();
      expect(event.defaultPrevented).toBe(true);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(lineRow(22));
    });

    it.each([{ metaKey: true }, { ctrlKey: true }])(
      "lets %o hunk clicks follow the href",
      async (modifiers) => {
        await landed(RENDER_SPLIT);
        mountRenderDiff(2, 22);
        const click = vi.spyOn(nativeLink("src/render.rs"), "click");
        const event = clickAt(inSection("docs", ".gh-prism-hunk"), modifiers);
        await afterDebounce();
        expect(event.defaultPrevented).toBe(false);
        expect(click).not.toHaveBeenCalled();
        expect(scrollIntoView).not.toHaveBeenCalled();
      },
    );

    it("cancels a jump still waiting for its diff to mount when another hunk is clicked", async () => {
      await landed(RENDER_SPLIT);
      clickAt(inSection("implementation", ".gh-prism-hunk"));
      clickAt(inSection("docs", ".gh-prism-hunk"));
      mountRenderDiff(2, 22);
      await afterDebounce();
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(lineRow(22));
    });

    it("cancels a jump still waiting for its diff to mount when the view is aborted", async () => {
      await landed(RENDER_SPLIT);
      clickAt(inSection("docs", ".gh-prism-hunk"));
      controller.abort();
      mountRenderDiff(22);
      await afterDebounce();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("cancels a jump still waiting for its diff to mount when a file row is clicked", async () => {
      await landed(RENDER_SPLIT);
      clickAt(inSection("docs", ".gh-prism-hunk"));
      clickAt(row("src/render.rs"));
      mountRenderDiff(22);
      await afterDebounce();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("leaves a hunk click alone when its native row is gone", async () => {
      await landed(RENDER_SPLIT);
      const docsHunk = inSection("docs", ".gh-prism-hunk");
      byId("src/render.rs").remove();
      const event = clickAt(docsHunk);
      expect(event.defaultPrevented).toBe(false);
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it.each([
      ["file row", 'a.gh-prism-file[data-path="src/render.rs"]'],
      ["hunk row", ".gh-prism-hunk"],
    ])("keeps focus on the Documentation entry's %s across a re-render", async (_, selector) => {
      await landed(RENDER_SPLIT);
      inSection("docs", selector).focus();
      byId("src/lib.rs").removeAttribute("aria-current");
      await afterDebounce();
      expect(document.activeElement).toBe(inSection("docs", selector));
    });

    it("moves focus to the file's first row when the focused row is split away", async () => {
      const deferred = Promise.withResolvers<IntentResult>();
      remountWith(deferred.promise);
      row("src/render.rs").focus();
      deferred.resolve({
        ok: true,
        placements: new Map([
          [
            "src/render.rs",
            {
              kind: "split",
              shares: [
                { section: "tests", hunks: [{ first: 2, last: 8 }] },
                { section: "docs", hunks: [{ first: 22, last: 28 }] },
              ],
            },
          ],
        ]),
      });
      await afterDebounce();
      expect(row("src/render.rs").dataset.section).toBe("tests");
      expect(document.activeElement).toBe(row("src/render.rs"));
    });

    it("renders a split file's path as text and attributes only", async () => {
      const path = "src/<b>render</b>.rs";
      const native = byId("src/render.rs").cloneNode(true);
      if (!(native instanceof HTMLElement)) throw new Error("clone is not an element");
      native.id = path;
      byId("src/render.rs").after(native);
      await landed({
        ok: true,
        placements: new Map([
          [
            path,
            {
              kind: "split",
              shares: [
                { section: "implementation", hunks: [{ first: 2, last: 8 }] },
                { section: "docs", hunks: [{ first: 22, last: 28 }] },
              ],
            },
          ],
        ]),
      });
      expect(view()?.querySelector("b")).toBeNull();
      expect(inSection("docs", ".gh-prism-hunk").dataset.path).toBe(path);
    });
  });
});
