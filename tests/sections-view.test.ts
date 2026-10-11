// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import type { DiffstatChoice } from "../entrypoints/content/diffstat-view";
import { findFilesPage } from "../entrypoints/content/files-page";
import type {
  FileLines,
  IntentProgress,
  IntentResult,
  IntentSection,
  Placement,
} from "../entrypoints/content/intent";
import {
  type PendingIntent,
  shareIntent,
  showSections,
} from "../entrypoints/content/sections-view";
import css from "../entrypoints/content/sections-view.css?raw";
import { byId, loadFixture } from "./fixtures/files-page";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

// happy-dom's ShadowRoot.activeElement throws when focus sits in another shadow root, which is
// exactly when the answer is null.
const shadowActiveElement = Object.getOwnPropertyDescriptor(ShadowRoot.prototype, "activeElement");
Object.defineProperty(ShadowRoot.prototype, "activeElement", {
  configurable: true,
  get(this: ShadowRoot) {
    try {
      return shadowActiveElement?.get?.call(this) ?? null;
    } catch {
      return null;
    }
  },
});

let controller: AbortController;

const view = () => document.querySelector<HTMLElement>(".gh-prism-sections");
const progressBar = () => view()?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;

const sectionKeys = () =>
  [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
    (section) => section.dataset.section,
  );

function treeHost(section: string): HTMLElement {
  const host = document.querySelector<HTMLElement>(
    `.gh-prism-section[data-section="${section}"] .gh-prism-tree`,
  );
  if (!host) throw new Error(`no tree in ${section}`);
  return host;
}

const rowsIn = (section: string) => [
  ...(treeHost(section).shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
];

const filesIn = (section: string) =>
  rowsIn(section)
    .filter((row) => row.dataset.itemType === "file")
    .map((row) => row.dataset.itemPath);

function rowIn(section: string, path: string): HTMLElement {
  const found = rowsIn(section).find((row) => row.dataset.itemPath === path);
  if (!found) throw new Error(`${section} has no row for ${path}`);
  return found;
}

const partsOf = (section: string, path: string) => [
  ...rowIn(section, path).querySelectorAll<HTMLElement>(
    '[data-item-section="decoration"] > span > span',
  ),
];

const partTexts = (section: string, path: string) =>
  partsOf(section, path).map((part) => part.textContent);

const decorationTitle = (section: string, path: string) =>
  rowIn(section, path)
    .querySelector('[data-item-section="decoration"] > span')
    ?.getAttribute("title") ?? "";

const nativeLink = (path: string) => {
  const link = byId(path).querySelector('a[href^="#diff-"]');
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no native link for ${path}`);
  return link;
};

/** Adds a native row for `path` after `after`'s row, as GitHub does when a file joins the PR. */
function addNativeFile(path: string, after: string): void {
  const native = byId(after).cloneNode(true);
  if (!(native instanceof HTMLElement)) throw new Error("clone is not an element");
  native.id = path;
  byId(after).after(native);
}

/** Clicks `target` as a user would: the event crosses out of the tree's shadow root. */
const clickAt = (target: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

/**
 * Presses `key` on `target` as a browser does: a button whose keydown goes unhandled clicks,
 * on keydown for Enter and on keyup for Space.
 */
function press(target: Element, key: "Enter" | " "): void {
  const init = { key, bubbles: true, cancelable: true, composed: true };
  const activates =
    target.dispatchEvent(new KeyboardEvent("keydown", init)) && target instanceof HTMLButtonElement;
  if (activates && key === "Enter") clickAt(target, { detail: 0 });
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  if (activates && key === " ") clickAt(target, { detail: 0 });
}

function sectionToggle(section: string): HTMLButtonElement {
  const toggle = document.querySelector(`.gh-prism-section[data-section="${section}"] h3 button`);
  if (!(toggle instanceof HTMLButtonElement)) throw new Error(`${section} has no header button`);
  return toggle;
}

/** What `section`'s header button shows and hides. */
function filesOf(section: string): HTMLElement {
  const files = document.getElementById(sectionToggle(section).getAttribute("aria-controls") ?? "");
  if (!files) throw new Error(`${section}'s header button controls nothing`);
  return files;
}

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

const whole = (section: IntentSection): Placement => ({ kind: "whole", section });

const landedWith = (
  placements: ReadonlyMap<string, Placement> = new Map(),
  lines: ReadonlyMap<string, FileLines> = new Map(),
): IntentResult => ({ ok: true, placements, lines });

/**
 * Replaces the view `beforeEach` mounted with one that waits on `intent`, in a tab whose header
 * counter last chose `diffstat`.
 */
function remountWith(
  intent?: PendingIntent,
  diffstat: DiffstatChoice = { view: "breakout" },
): void {
  controller.abort();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showSections(page, controller.signal, intent && { intent, diffstat });
}

/** Mounts the view with `result` already landed, and lets it render. */
async function landed(result: IntentResult): Promise<void> {
  remountWith(() => Promise.resolve(result));
  await afterDebounce();
}

/** An intent that settles when the test resolves it, and reports progress when told to. */
function pendingIntent() {
  const deferred = Promise.withResolvers<IntentResult>();
  let report: (progress: IntentProgress) => void = () => {
    throw new Error("the view has not asked for the intent yet");
  };
  const intent: PendingIntent = (onProgress) => {
    report = onProgress;
    return deferred.promise;
  };
  return {
    intent,
    resolve: deferred.resolve,
    progress: (progress: IntentProgress) => report(progress),
  };
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
  it("lists the files in a tree per non-empty section, in section and native-tree order", () => {
    expect(sectionKeys().map((section) => [section, filesIn(section ?? "")])).toEqual([
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

  it("flattens a directory chain that holds no files of its own into one row", async () => {
    await landed(landedWith(new Map([["src/generated/schema.rs", whole("tests")]])));
    expect(rowsIn("tests").map((row) => row.getAttribute("aria-label"))).toEqual([
      "src / generated",
      "schema.rs",
      "tests",
      "integration.rs",
    ]);
  });

  it("names each section by its header", () => {
    const sections = [...document.querySelectorAll(".gh-prism-section")];
    expect(sections).toHaveLength(5);
    for (const section of sections) {
      const header = section.querySelector("h3");
      expect(header).not.toBeNull();
      expect(document.getElementById(section.getAttribute("aria-labelledby") ?? "")).toBe(header);
    }
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

  it("adds a file that joins the native tree, with its status, to its section's tree", async () => {
    addNativeFile("docs/intro.md", "docs/guide.md");
    await afterDebounce();
    expect(filesIn("docs")).toEqual(["docs/guide.md", "docs/intro.md", "README.md"]);
    expect(rowIn("docs", "docs/intro.md").dataset.itemGitStatus).toBe("modified");
    expect(document.querySelector('[data-section="docs"] .gh-prism-counter')?.textContent).toBe(
      "3",
    );
  });

  it("puts a section that gains its first file in section order", async () => {
    byId("docs/guide.md").remove();
    byId("README.md").remove();
    await afterDebounce();
    addNativeFile("docs/intro.md", "config/app.toml");
    await afterDebounce();
    expect(sectionKeys()).toEqual(["implementation", "tests", "docs", "config", "generated"]);
  });

  it("drops a section, and clears its tree, once its last file leaves the native tree", async () => {
    const generated = treeHost("generated");
    byId("Cargo.lock").remove();
    await afterDebounce();
    expect(sectionKeys()).not.toContain("generated");
    expect(generated.shadowRoot?.querySelector('[data-type="item"]')).toBeNull();
  });

  it("sizes each tree to its visible rows, following a collapse", async () => {
    const heightOfRows = (section: string) => {
      const rows = rowsIn(section);
      return `${rows.length * Number.parseFloat(rows[0]?.style.minHeight ?? "")}px`;
    };
    expect(treeHost("implementation").style.height).toBe(heightOfRows("implementation"));
    clickAt(rowIn("implementation", "src/"));
    await afterDebounce();
    expect(rowsIn("implementation")).toHaveLength(1);
    expect(treeHost("implementation").style.height).toBe(heightOfRows("implementation"));
  });

  it("keeps a collapsed directory collapsed when its tree's files change", async () => {
    clickAt(rowIn("implementation", "src/generated/"));
    await afterDebounce();
    byId("src/notes.rs").remove();
    await afterDebounce();
    expect(rowIn("implementation", "src/generated/").getAttribute("aria-expanded")).toBe("false");
    expect(filesIn("implementation")).toEqual([
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/parser.rs",
      "src/render.rs",
    ]);
  });

  it("draws each directory as a folder", () => {
    const icon = rowIn("implementation", "src/").querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("implementation").shadowRoot?.querySelector(
      `symbol${icon?.getAttribute("href")}`,
    );
    expect(symbol?.id).toMatch(/folder/);
  });

  describe("a section's header", () => {
    const expanded = (section: string) => sectionToggle(section).getAttribute("aria-expanded");

    it("hides and shows its section's tree when clicked", () => {
      expect(expanded("docs")).toBe("true");
      expect(filesOf("docs").contains(treeHost("docs"))).toBe(true);
      sectionToggle("docs").click();
      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);
      sectionToggle("docs").click();
      expect(expanded("docs")).toBe("true");
      expect(filesOf("docs").inert).toBe(false);
    });

    it.each(["Enter", " "] as const)("toggles its section, keeping focus, on %j", (key) => {
      const toggle = sectionToggle("tests");
      toggle.focus();
      press(toggle, key);
      expect(expanded("tests")).toBe("false");
      expect(document.activeElement).toBe(toggle);
    });

    it("keeps its section collapsed while the native tree changes", async () => {
      sectionToggle("docs").click();
      addNativeFile("docs/intro.md", "docs/guide.md");
      await afterDebounce();
      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);
      expect(filesIn("docs")).toContain("docs/intro.md");
    });

    it("keeps a collapsed section collapsed when it empties and comes back", async () => {
      sectionToggle("docs").click();
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();
      expect(expanded("docs")).toBe("false");
      expect(filesOf("docs").inert).toBe(true);
    });

    it("collapses and expands its section without rebuilding the tree", async () => {
      const { FileTree } = await import("@pierre/trees");
      const render = vi.spyOn(FileTree.prototype, "render");
      const resetPaths = vi.spyOn(FileTree.prototype, "resetPaths");
      const cleanUp = vi.spyOn(FileTree.prototype, "cleanUp");
      const rows = rowsIn("implementation");
      sectionToggle("implementation").click();
      sectionToggle("implementation").click();
      await afterDebounce();
      expect(render).not.toHaveBeenCalled();
      expect(resetPaths).not.toHaveBeenCalled();
      expect(cleanUp).not.toHaveBeenCalled();
      expect(rowsIn("implementation")).toEqual(rows);
      render.mockRestore();
      resetPaths.mockRestore();
      cleanUp.mockRestore();
    });
  });

  it("renders file names as text", async () => {
    const path = "docs/<img src=x onerror=alert(1)>.md";
    addNativeFile(path, "docs/guide.md");
    await afterDebounce();
    expect(treeHost("docs").shadowRoot?.querySelector("img")).toBeNull();
    expect(rowIn("docs", path).getAttribute("aria-label")).toBe("<img src=x onerror=alert(1)>.md");
  });

  it("removes itself, clears its trees, and stops rendering once aborted", async () => {
    const implementation = treeHost("implementation");
    controller.abort();
    expect(view()).toBeNull();
    expect(implementation.shadowRoot?.querySelector('[data-type="item"]')).toBeNull();
    byId("src/lib.rs").removeAttribute("aria-current");
    await afterDebounce();
    expect(view()).toBeNull();
  });

  it.each([
    ["octicon-file-added", "added"],
    ["octicon-file-removed", "deleted"],
    ["octicon-file-moved", "renamed"],
    ["octicon-file-diff", "modified"],
  ])("marks a file whose native icon is %s as %s", (octicon, status) => {
    byId("src/parser.rs").querySelector("svg.octicon")?.setAttribute("class", `octicon ${octicon}`);
    remountWith();
    expect(rowIn("implementation", "src/parser.rs").dataset.itemGitStatus).toBe(status);
  });

  describe("the active file", () => {
    const selected = (section: string) =>
      rowsIn(section)
        .filter((row) => row.getAttribute("aria-selected") === "true")
        .map((row) => row.dataset.itemPath);

    // section-tree.css draws the current-diff bar on the rows the tree marks selected.
    const barred = (section: string) =>
      rowsIn(section)
        .filter((row) => row.dataset.itemSelected === "true")
        .map((row) => row.dataset.itemPath);

    it("is selected in its section, and nothing else is", () => {
      expect(selected("implementation")).toEqual(["src/lib.rs"]);
      expect(selected("docs")).toEqual([]);
    });

    it("follows the native tree's current row in place", async () => {
      const engine = rowIn("implementation", "src/engine.rs");
      byId("src/lib.rs").removeAttribute("aria-current");
      byId("src/engine.rs").setAttribute("aria-current", "true");
      await afterDebounce();
      expect(selected("implementation")).toEqual(["src/engine.rs"]);
      expect(rowIn("implementation", "src/engine.rs")).toBe(engine);
    });

    it("moves without resetting any tree's paths or statuses", async () => {
      // Imported here, not above: the view must load first to stand in for the null registry.
      const { FileTree } = await import("@pierre/trees");
      const resetPaths = vi.spyOn(FileTree.prototype, "resetPaths");
      const setGitStatus = vi.spyOn(FileTree.prototype, "setGitStatus");
      byId("src/lib.rs").removeAttribute("aria-current");
      byId("README.md").setAttribute("aria-current", "true");
      await afterDebounce();
      expect(selected("docs")).toEqual(["README.md"]);
      expect(resetPaths).not.toHaveBeenCalled();
      expect(setGitStatus).not.toHaveBeenCalled();
      resetPaths.mockRestore();
      setGitStatus.mockRestore();
    });

    it("keeps its selection and bar when a directory is clicked", async () => {
      clickAt(rowIn("implementation", "src/generated/"));
      await afterDebounce();
      expect(selected("implementation")).toEqual(["src/lib.rs"]);
      expect(barred("implementation")).toEqual(["src/lib.rs"]);
    });

    it("stays the only selection when another file is Cmd-clicked", async () => {
      clickAt(rowIn("implementation", "src/notes.rs"), { metaKey: true });
      await afterDebounce();
      expect(selected("implementation")).toEqual(["src/lib.rs"]);
      expect(barred("implementation")).toEqual(["src/lib.rs"]);
    });

    it("is selected in every section a split lists it under", async () => {
      byId("src/lib.rs").removeAttribute("aria-current");
      byId("src/render.rs").setAttribute("aria-current", "true");
      await landed(
        landedWith(
          new Map([
            [
              "src/render.rs",
              {
                kind: "split",
                shares: [
                  {
                    section: "implementation",
                    hunks: [{ first: 2, last: 8 }],
                    lines: { added: 5, removed: 1 },
                  },
                  {
                    section: "docs",
                    hunks: [{ first: 22, last: 28 }],
                    lines: { added: 3, removed: 1 },
                  },
                ],
              },
            ],
          ]),
        ),
      );
      expect(selected("implementation")).toEqual(["src/render.rs"]);
      expect(selected("docs")).toEqual(["src/render.rs"]);
    });
  });

  describe("a row's decoration", () => {
    it("shows a whole file's lines added and removed in the diffstat colors", async () => {
      await landed(landedWith(new Map(), new Map([["src/render.rs", { added: 12, removed: 3 }]])));
      expect(partTexts("implementation", "src/render.rs")).toEqual(["+12", "−3"]);
      const [added, removed] = partsOf("implementation", "src/render.rs");
      expect(added?.style.color).toContain("--fgColor-success");
      expect(removed?.style.color).toContain("--fgColor-danger");
    });

    it("quiets a side that changed no lines", async () => {
      await landed(landedWith(new Map(), new Map([["src/render.rs", { added: 4, removed: 0 }]])));
      expect(partTexts("implementation", "src/render.rs")).toEqual(["+4", "−0"]);
      const [, removed] = partsOf("implementation", "src/render.rs");
      expect(removed?.style.color).not.toContain("--fgColor-danger");
    });

    it("shows each section's share of a split file's lines, marked Partial", async () => {
      await landed(
        landedWith(
          new Map([
            [
              "src/render.rs",
              {
                kind: "split",
                shares: [
                  {
                    section: "implementation",
                    hunks: [{ first: 2, last: 8 }],
                    lines: { added: 5, removed: 1 },
                  },
                  {
                    section: "docs",
                    hunks: [{ first: 22, last: 28 }],
                    lines: { added: 3, removed: 1 },
                  },
                ],
              },
            ],
          ]),
          new Map([["src/render.rs", { added: 8, removed: 2 }]]),
        ),
      );
      expect(partTexts("implementation", "src/render.rs")).toEqual(["Partial", "+5", "−1"]);
      expect(partTexts("docs", "src/render.rs")).toEqual(["Partial", "+3", "−1"]);
    });

    it("counts a split file in each section it is listed under", async () => {
      await landed(
        landedWith(
          new Map([
            [
              "src/render.rs",
              {
                kind: "split",
                shares: [
                  {
                    section: "implementation",
                    hunks: [{ first: 2, last: 8 }],
                    lines: { added: 5, removed: 1 },
                  },
                  {
                    section: "docs",
                    hunks: [{ first: 22, last: 28 }],
                    lines: { added: 3, removed: 1 },
                  },
                ],
              },
            ],
          ]),
        ),
      );
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

    it("shows no counts while they are unknown", () => {
      expect(partTexts("implementation", "src/render.rs")).toEqual([]);
    });

    it("shows no counts for a file that changed no lines", async () => {
      await landed(landedWith(new Map(), new Map([["src/helpers.rs", { added: 0, removed: 0 }]])));
      expect(partTexts("implementation", "src/helpers.rs")).toEqual([]);
    });

    it("marks a binary file, with a title explaining it has no line counts", async () => {
      addNativeFile("src/logo.png", "src/lib.rs");
      await landed(landedWith(new Map(), new Map([["src/logo.png", "binary"]])));
      expect(partTexts("implementation", "src/logo.png")).toEqual(["Binary"]);
      expect(decorationTitle("implementation", "src/logo.png")).not.toBe("");
    });

    it("leads with the file's comment count", async () => {
      await landed(landedWith(new Map(), new Map([["src/engine.rs", { added: 12, removed: 3 }]])));
      expect(partTexts("implementation", "src/engine.rs")).toEqual(["1", "+12", "−3"]);
    });

    it("follows a file's comment count", async () => {
      const count = byId("src/engine.rs").querySelector(".octicon-comment + div");
      if (!count) throw new Error("fixture has no comment count for engine.rs");
      count.textContent = "2";
      byId("src/engine.rs").setAttribute("aria-label", "engine.rs has 2 comments");
      await afterDebounce();
      expect(partTexts("implementation", "src/engine.rs")).toEqual(["2"]);
    });
  });

  describe("a row's accessible name", () => {
    const nameOf = (section: string, path: string) =>
      rowIn(section, path).getAttribute("aria-label");

    it("adds the file's comment count", () => {
      expect(nameOf("implementation", "src/engine.rs")).toBe("engine.rs, 1 comment");
    });

    it("adds the lines the file adds and removes", async () => {
      await landed(landedWith(new Map(), new Map([["src/render.rs", { added: 12, removed: 3 }]])));
      expect(nameOf("implementation", "src/render.rs")).toBe("render.rs, 12 added, 3 removed");
    });

    it("says a split file's entry is partial, with its section's lines", async () => {
      await landed(
        landedWith(
          new Map([
            [
              "src/render.rs",
              {
                kind: "split",
                shares: [
                  {
                    section: "implementation",
                    hunks: [{ first: 2, last: 8 }],
                    lines: { added: 5, removed: 1 },
                  },
                  {
                    section: "docs",
                    hunks: [{ first: 22, last: 28 }],
                    lines: { added: 3, removed: 1 },
                  },
                ],
              },
            ],
          ]),
        ),
      );
      expect(nameOf("docs", "src/render.rs")).toBe(
        "render.rs, Partial: other sections hold the rest. 3 added, 1 removed in this section",
      );
    });

    it("says a binary file has no line counts", async () => {
      addNativeFile("src/logo.png", "src/lib.rs");
      await landed(landedWith(new Map(), new Map([["src/logo.png", "binary"]])));
      expect(nameOf("implementation", "src/logo.png")).toBe(
        "logo.png, Binary file: no line counts",
      );
    });
  });

  describe("a click on a row", () => {
    const RENDER_DIFF = "diff-0a09";
    const renderSplit = (
      implementationHunks: readonly ({ first: number; last: number } | undefined)[],
    ): IntentResult =>
      landedWith(
        new Map([
          [
            "src/render.rs",
            {
              kind: "split",
              shares: [
                {
                  section: "implementation",
                  hunks: implementationHunks,
                  lines: { added: 5, removed: 1 },
                },
                {
                  section: "docs",
                  hunks: [undefined, { first: 22, last: 28 }],
                  lines: { added: 3, removed: 1 },
                },
              ],
            },
          ],
        ]),
      );

    let scrollIntoView: MockInstance<Element["scrollIntoView"]>;

    beforeEach(() => {
      scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    });
    afterEach(() => {
      scrollIntoView.mockRestore();
    });

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

    it("forwards a plain click on a whole file to its native link", () => {
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");
      clickAt(rowIn("implementation", "src/render.rs"));
      expect(click).toHaveBeenCalledOnce();
    });

    it("follows a file's native link once when Enter activates its row", () => {
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");
      press(rowIn("implementation", "src/render.rs"), "Enter");
      expect(click).toHaveBeenCalledOnce();
    });

    it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }])(
      "leaves a %o click to the tree",
      (modifiers) => {
        const click = vi.spyOn(nativeLink("src/render.rs"), "click");
        clickAt(rowIn("implementation", "src/render.rs"), modifiers);
        expect(click).not.toHaveBeenCalled();
      },
    );

    it("toggles a directory without following any file", async () => {
      const clicks = vi.spyOn(HTMLAnchorElement.prototype, "click");
      clickAt(rowIn("implementation", "src/generated/"));
      await afterDebounce();
      expect(rowIn("implementation", "src/generated/").getAttribute("aria-expanded")).toBe("false");
      expect(clicks).not.toHaveBeenCalled();
      clicks.mockRestore();
    });

    it("leaves a click alone when its native file has gone", () => {
      const row = rowIn("implementation", "src/render.rs");
      byId("src/render.rs").remove();
      expect(() => clickAt(row)).not.toThrow();
    });

    it("reveals a partial entry's first hunk with head lines in that section", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      mountRenderDiff(2, 22);
      clickAt(rowIn("docs", "src/render.rs"));
      await afterDebounce();
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(scrollIntoView.mock.contexts[0]).toBe(lineRow(22));
    });

    it("follows the native link for a partial entry with no head lines", async () => {
      await landed(renderSplit([undefined]));
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");
      clickAt(rowIn("implementation", "src/render.rs"));
      expect(click).toHaveBeenCalledOnce();
    });

    it("cancels a jump still waiting for its diff to mount when another entry is clicked", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      clickAt(rowIn("implementation", "src/render.rs"));
      clickAt(rowIn("docs", "src/render.rs"));
      mountRenderDiff(2, 22);
      await afterDebounce();
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView.mock.contexts[0]).toBe(lineRow(22));
    });

    it("cancels a jump still waiting for its diff to mount when the view is aborted", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      clickAt(rowIn("docs", "src/render.rs"));
      controller.abort();
      mountRenderDiff(22);
      await afterDebounce();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("while intent is pending", () => {
    it("shows a busy, indeterminate progress bar and no sections", () => {
      remountWith(pendingIntent().intent);
      expect(view()?.getAttribute("aria-busy")).toBe("true");
      expect(progressBar()?.hasAttribute("aria-valuenow")).toBe(false);
      expect(sectionKeys()).toEqual([]);
    });

    it("reports how many of the diff's files intent has checked", () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.progress({ checked: 3, total: 13 });
      expect(progressBar()?.getAttribute("aria-valuenow")).toBe("3");
      expect(progressBar()?.getAttribute("aria-valuemax")).toBe("13");
    });

    it("keeps loading through changes to the native tree", async () => {
      remountWith(pendingIntent().intent);
      byId("src/lib.rs").removeAttribute("aria-current");
      await afterDebounce();
      expect(progressBar()).not.toBeNull();
      expect(sectionKeys()).toEqual([]);
    });

    it("reveals the sections, intent's moves included, once it settles", async () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.resolve(
        landedWith(
          new Map([
            ["src/parser.rs", whole("docs")],
            ["src/notes.rs", whole("docs")],
          ]),
        ),
      );
      await afterDebounce();
      expect(view()?.hasAttribute("aria-busy")).toBe(false);
      expect(progressBar()).toBeNull();
      expect(view()?.hasAttribute("data-reveal")).toBe(true);
      expect(filesIn("docs")).toEqual([
        "docs/guide.md",
        "src/notes.rs",
        "src/parser.rs",
        "README.md",
      ]);
      expect(filesIn("implementation")).not.toContain("src/parser.rs");
      expect(document.querySelector(".gh-prism-notice")).toBeNull();
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
      "reveals path sections under a notice when the intent is $problem",
      async ({ problem, copy }) => {
        const pending = pendingIntent();
        remountWith(pending.intent);
        pending.resolve({ ok: false, problem });
        await afterDebounce();
        expect(filesIn("implementation")).toContain("src/parser.rs");
        expect(view()?.firstElementChild?.className).toBe("gh-prism-notice");
        expect(view()?.firstElementChild?.textContent).toBe(copy);
      },
    );

    it("reveals path sections under a notice when intent rejects, and logs why", async () => {
      const failure = new Error("intent broke");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      remountWith(() => Promise.reject(failure));
      await afterDebounce();
      expect(view()?.hasAttribute("aria-busy")).toBe(false);
      expect(filesIn("implementation")).toContain("src/parser.rs");
      expect(view()?.firstElementChild?.className).toBe("gh-prism-notice");
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
      consoleError.mockRestore();
    });

    it("builds nothing when the intent settles after abort", async () => {
      const { FileTree } = await import("@pierre/trees");
      const render = vi.spyOn(FileTree.prototype, "render");
      const pending = pendingIntent();
      remountWith(pending.intent);
      controller.abort();
      pending.resolve(landedWith(new Map([["src/parser.rs", whole("docs")]])));
      await afterDebounce();
      expect(view()).toBeNull();
      expect(render).not.toHaveBeenCalled();
      render.mockRestore();
    });
  });

  describe("intent shared by each view of one visit", () => {
    it("is read once, however many views follow it", () => {
      const read = vi.fn(pendingIntent().intent);
      const shared = shareIntent(read);
      remountWith(shared);
      remountWith(shared);
      expect(read).toHaveBeenCalledOnce();
    });

    it("resumes a view mounted mid-read at the latest progress", () => {
      const pending = pendingIntent();
      const shared = shareIntent(pending.intent);
      remountWith(shared);
      pending.progress({ checked: 2, total: 3 });
      remountWith(shared);
      expect(progressBar()?.getAttribute("aria-valuenow")).toBe("2");
      pending.progress({ checked: 3, total: 3 });
      expect(progressBar()?.getAttribute("aria-valuenow")).toBe("3");
    });

    it("shows a view mounted once it has settled at once, with no progress bar or reveal", async () => {
      const shared = shareIntent(() =>
        Promise.resolve(landedWith(new Map([["src/parser.rs", whole("docs")]]))),
      );
      remountWith(shared);
      await afterDebounce();
      remountWith(shared);
      expect(progressBar()).toBeNull();
      expect(view()?.hasAttribute("aria-busy")).toBe(false);
      expect(view()?.hasAttribute("data-reveal")).toBe(false);
      expect(filesIn("docs")).toContain("src/parser.rs");
    });
  });

  describe("the header's lines-changed counter", () => {
    const native = () => {
      const counter = document.querySelector<HTMLElement>(".flex-items-center");
      if (!counter) throw new Error("fixture lacks GitHub's lines-changed counter");
      return counter;
    };
    const counter = () => document.querySelector<HTMLButtonElement>(".gh-prism-diffstat");
    const pills = () => [...document.querySelectorAll<HTMLElement>(".gh-prism-pill")];
    const textsOf = (nodes: Iterable<Element>) => [...nodes].map((node) => node.textContent);
    const pillCounts = () =>
      pills().map((pill) => [
        pill.dataset.section,
        textsOf(pill.querySelectorAll(".gh-prism-pill-count")),
      ]);
    const totalShown = () =>
      textsOf(counter()?.querySelectorAll(".flex-items-center > [aria-hidden]") ?? []);
    const tipOf = (owner: Element | null) => owner?.querySelector(":scope > .gh-prism-tip");

    const split: Placement = {
      kind: "split",
      shares: [
        { section: "implementation", hunks: [], lines: { added: 5, removed: 1 } },
        { section: "docs", hunks: [], lines: { added: 2, removed: 0 } },
      ],
    };
    const counted = landedWith(
      new Map([
        ["src/notes.rs", whole("docs")],
        ["src/render.rs", split],
      ]),
      new Map<string, FileLines>([
        ["src/parser.rs", { added: 10, removed: 3 }],
        ["src/notes.rs", { added: 4, removed: 4 }],
        ["src/render.rs", { added: 7, removed: 1 }],
        ["tests/integration.rs", { added: 20, removed: 0 }],
        ["config/app.toml", "binary"],
        ["Cargo.lock", { added: 1210, removed: 350 }],
      ]),
    );

    it("shows the lines of each section that changed any, in section order", async () => {
      await landed(counted);
      expect(pillCounts()).toEqual([
        ["implementation", ["+15", "−4"]],
        ["tests", ["+20", "−0"]],
        ["docs", ["+6", "−4"]],
        ["generated", ["+1,210", "−350"]],
      ]);
    });

    // happy-dom can't parse the stylesheet, so this pins the adjacency its hiding rule keys on.
    it("sits just before GitHub's counter, which the stylesheet hides", async () => {
      await landed(counted);
      expect(counter()?.nextElementSibling).toBe(native());
    });

    it("switches to GitHub's total when clicked, and back to the sections when clicked again", async () => {
      await landed(counted);
      counter()?.click();
      expect(pills()).toEqual([]);
      expect(totalShown()).toEqual(["+1,604", "-177"]);
      counter()?.click();
      expect(pills()).toHaveLength(4);
      expect(totalShown()).toEqual([]);
    });

    it("opens the next page in the view the tab last chose", async () => {
      const choice: DiffstatChoice = { view: "breakout" };
      remountWith(() => Promise.resolve(counted), choice);
      await afterDebounce();
      counter()?.click();
      remountWith(() => Promise.resolve(counted), choice);
      await afterDebounce();
      expect(pills()).toEqual([]);
      expect(totalShown()).toEqual(["+1,604", "-177"]);
    });

    it("titles each pill's tooltip with its section, over what lands there", async () => {
      await landed(counted);
      const tips = pills().map((pill) => [...(tipOf(pill)?.children ?? [])]);
      expect(tips.map(([title]) => title?.textContent)).toEqual([
        "Implementation",
        "Tests",
        "Documentation",
        "Generated / lockfiles",
      ]);
      for (const [, about] of tips) expect(about?.textContent).not.toBe("");
    });

    it("lists each section's lines in the total's tooltip", async () => {
      await landed(counted);
      counter()?.click();
      const rows = [...(tipOf(counter())?.children ?? [])];
      expect(rows.map((row) => textsOf(row.querySelectorAll("span")))).toEqual([
        ["Implementation", "+15", "−4"],
        ["Tests", "+20", "−0"],
        ["Documentation", "+6", "−4"],
        ["Generated / lockfiles", "+1,210", "−350"],
      ]);
    });

    it("says each section's lines in words, keeping its numbers and tooltip from being read", async () => {
      await landed(counted);
      expect(pills().map((pill) => pill.querySelector(".sr-only")?.textContent)).toEqual([
        "Implementation: 15 added, 4 removed.",
        "Tests: 20 added, 0 removed.",
        "Documentation: 6 added, 4 removed.",
        "Generated / lockfiles: 1,210 added, 350 removed.",
      ]);
      for (const pill of pills()) {
        expect(
          textsOf(pill.querySelectorAll(":scope > :not(.sr-only):not([aria-hidden])")),
        ).toEqual([]);
      }
    });

    it("leaves GitHub's counter alone while intent is pending", () => {
      remountWith(pendingIntent().intent);
      expect(counter()).toBeNull();
    });

    it("leaves GitHub's counter alone when intent has no line counts", async () => {
      await landed({ ok: false, problem: "commit-filtered" });
      expect(counter()).toBeNull();
    });

    it("gives GitHub's counter back once aborted", async () => {
      await landed(counted);
      controller.abort();
      expect(counter()).toBeNull();
    });

    it("marks each sidebar section's heading with the icon its pill shows", async () => {
      await landed(counted);
      const iconOf = (owner: Element | null | undefined) =>
        owner?.querySelector(".gh-prism-section-icon path")?.getAttribute("d");
      const headingIcons = sectionKeys().map((key) =>
        iconOf(document.querySelector(`.gh-prism-section[data-section="${key}"] h3`)),
      );
      expect(new Set(headingIcons).size).toBe(5);
      for (const pill of pills()) {
        const heading = document.querySelector(
          `.gh-prism-section[data-section="${pill.dataset.section}"] h3`,
        );
        expect(iconOf(pill)).toBe(iconOf(heading));
      }
    });
  });

  it("renders at once, without a reveal, when there is no intent to wait for", () => {
    expect(view()?.hasAttribute("aria-busy")).toBe(false);
    expect(view()?.hasAttribute("data-reveal")).toBe(false);
    expect(progressBar()).toBeNull();
    expect(sectionKeys()).toHaveLength(5);
  });
});
