// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { visitViewed } from "../../../entrypoints/content/diffs/viewed";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import { showSections } from "../../../entrypoints/content/sidebar/sections-view";
import css from "../../../entrypoints/content/sidebar/sections-view.css?raw";
import { showVisit } from "../../../entrypoints/content/visit/land";
import type { IntentResult } from "../../../utils/intent/read";
import { byId } from "../../fixtures/files-page";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  progressBar,
  rowsIn,
  sectionKeys,
  sheetsStyling,
  treeHost,
  view,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

// Spied so tests can reach the hooks of the sidebar showVisit mounted.
vi.mock(import("../../../entrypoints/content/sidebar/sections-view"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, showSections: vi.fn(original.showSections) };
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

const { remountWith, landed, abort } = mountsVisit();

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

/** Sets `path`'s native comment count to `count`, as GitHub does, and waits out the debounce. */
async function setCommentCount(path: string, count: number): Promise<void> {
  const native = byId(path);
  const counter = native.querySelector(".octicon-comment + div");
  if (!counter) throw new Error(`fixture has no comment count for ${path}`);
  counter.textContent = String(count);
  native.setAttribute("aria-label", `${path.split("/").at(-1)} has ${count} comments`);
  await afterDebounce();
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

/** render.rs split between implementation, with `implementationHunks`, and docs. */
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

describe("showSections", () => {
  /** Tells the mounted sidebar which files GitHub shows as Viewed. */
  const viewed = (...paths: string[]) => {
    const sidebar = vi.mocked(showSections).mock.results.at(-1)?.value;
    if (!sidebar) throw new Error("no sidebar mounted");
    sidebar.viewed(new Set(paths));
  };

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

  it("tints each section with its hue", () => {
    const hues = Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map((section) => [
        section.dataset.section,
        section.style.getPropertyValue("--gh-prism-hue"),
      ]),
    );

    expect(hues).toEqual({
      implementation: "var(--fgColor-accent)",
      tests: "var(--fgColor-done)",
      docs: "var(--fgColor-attention)",
      config: "var(--fgColor-sponsors)",
      generated: "var(--fgColor-muted)",
    });
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

    expect(
      [...document.querySelectorAll(".gh-prism-section-label")].map((label) => label.textContent),
    ).toEqual(["Implementation", "Tests", "Documentation", "Config", "Generated / lockfiles"]);
  });

  it("sits just before the native tree", () => {
    expect(document.querySelector('ul[role="tree"]')?.previousElementSibling).toBe(view());
  });

  it("injects its stylesheet into the document head until aborted", () => {
    const stylesheet = () => document.head.querySelector("style");
    expect(stylesheet()?.textContent).toBe(css);
    abort();
    expect(stylesheet()).toBeNull();
  });

  it("keeps one view when the sidebar comes back holding a stale one", () => {
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    const fresh = new AbortController();
    showVisit(page, fresh.signal, {
      intent: () => landedWith(),
      diffstat: { view: "breakout" },
      viewed: visitViewed(undefined),
    });
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

  it("draws each file with its type's icon", async () => {
    addNativeFile("src/app.tsx", "src/lib.rs");
    await afterDebounce();

    const icon = rowIn("implementation", "src/app.tsx").querySelector(
      '[data-item-section="icon"] svg',
    );

    expect(icon?.getAttribute("data-icon-token")).toBe("react");
  });

  it("draws a manifest with its ecosystem's icon", () => {
    const use = rowIn("config", "Cargo.toml").querySelector('[data-item-section="icon"] use');
    const symbol = treeHost("config").shadowRoot?.querySelector(
      `symbol${use?.getAttribute("href")}`,
    );

    expect(symbol?.id).toBe("file-tree-builtin-rust");
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

    it("starts the Generated section collapsed and the rest expanded", () => {
      expect(expanded("generated")).toBe("false");
      expect(filesOf("generated").inert).toBe(true);
      expect(expanded("implementation")).toBe("true");

      sectionToggle("generated").click();

      expect(expanded("generated")).toBe("true");
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
    abort();

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
      await setCommentCount("src/engine.rs", 2);

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

    /** What the jump scrolled in the diff list, leaving out the sidebar scrolls a click's focus brings. */
    const diffScrolls = () =>
      scrollIntoView.mock.contexts.filter(
        (context) => context instanceof Node && diffList().contains(context),
      );

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

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "instant" });
      expect(diffScrolls()).toEqual([lineRow(22)]);
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

      expect(diffScrolls()).toEqual([lineRow(22)]);
    });

    it("cancels a jump still waiting for its diff to mount when the view is aborted", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      clickAt(rowIn("docs", "src/render.rs"));
      abort();
      mountRenderDiff(22);
      await afterDebounce();

      expect(diffScrolls()).toEqual([]);
    });
  });

  describe("the sidebar's scroll", () => {
    let scrollIntoView: MockInstance<Element["scrollIntoView"]>;

    const revealedTops = () =>
      scrollIntoView.mock.contexts
        .filter((context) => context instanceof HTMLElement)
        .filter((context) => context.getRootNode() === treeHost("implementation").shadowRoot)
        .map((context) => context.style.top);

    const moveCurrentTo = (path: string) => {
      byId("src/lib.rs").removeAttribute("aria-current");
      byId(path).setAttribute("aria-current", "true");
    };

    beforeEach(() => {
      scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
    });

    afterEach(() => {
      scrollIntoView.mockRestore();
    });

    it("shows each tree the rows where the sidebar's scroll has brought it", () => {
      const shadow = treeHost("implementation").shadowRoot;
      const root = shadow?.querySelector("[data-file-tree-virtualized-root]");
      const scroll = shadow?.querySelector("[data-file-tree-virtualized-scroll]");
      if (!root || !scroll) throw new Error("the implementation tree has no viewport");

      vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 300, 200, 900));
      vi.spyOn(treeHost("implementation"), "getBoundingClientRect").mockReturnValue(
        new DOMRect(0, 100, 200, 2000),
      );

      byId("pr-file-tree").dispatchEvent(new Event("scroll"));

      expect(scroll.scrollTop).toBe(200);
    });

    it("brings the row the keyboard focuses into the sidebar's view", async () => {
      const rows = rowsIn("implementation");

      rows[0]?.focus();
      rows[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      await afterDebounce();

      expect(treeHost("implementation").shadowRoot?.activeElement).toBe(rows.at(-1));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(revealedTops()).toContain(`${(rows.length - 1) * 28}px`);
    });

    it("scrolls GitHub's current file into the sidebar's view when it changes", async () => {
      moveCurrentTo("src/engine.rs");
      await afterDebounce();
      const index = rowsIn("implementation").findIndex(
        (row) => row.dataset.itemPath === "src/engine.rs",
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      expect(revealedTops()).toEqual([`${index * 28}px`]);
    });

    it("leaves the sidebar's scroll alone while the current file stays", async () => {
      moveCurrentTo("src/engine.rs");
      await afterDebounce();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      scrollIntoView.mockClear();
      byId("src/engine.rs").setAttribute("aria-label", "engine.rs has 2 comments");
      await afterDebounce();

      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    describe("for a split current file", () => {
      /** The sections whose trees scrolled the sidebar, in order. */
      const scrolledSections = () =>
        scrollIntoView.mock.contexts.flatMap((context) =>
          sectionKeys().filter(
            (section) =>
              context instanceof Node &&
              context.getRootNode() === treeHost(section ?? "").shadowRoot,
          ),
        );

      beforeEach(async () => {
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

        scrollIntoView.mockClear();
      });

      it("scrolls the first section that lists it", async () => {
        moveCurrentTo("src/render.rs");
        await afterDebounce();
        expect(scrolledSections()).toEqual(["implementation"]);
      });

      it("scrolls the section it was clicked in", async () => {
        clickAt(rowIn("docs", "src/render.rs"));
        moveCurrentTo("src/render.rs");
        await afterDebounce();
        // The click's focus scrolls the docs tree too.
        expect(new Set(scrolledSections())).toEqual(new Set(["docs"]));
      });

      it("skips a collapsed section that lists it", async () => {
        sectionToggle("implementation").click();
        moveCurrentTo("src/render.rs");
        await afterDebounce();
        expect(scrolledSections()).toEqual(["docs"]);
      });
    });

    it("leaves the sidebar alone when the current file moves into a collapsed section", async () => {
      sectionToggle("implementation").click();
      moveCurrentTo("src/engine.rs");
      await afterDebounce();
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it("renders no window for a tree far outside the sidebar's viewport", () => {
      const host = treeHost("implementation");
      const rect = vi.spyOn(host, "getBoundingClientRect");
      rect.mockReturnValue(new DOMRect(0, 3 * innerHeight, 200, 2000));
      byId("pr-file-tree").dispatchEvent(new Event("scroll"));
      expect(host.hasAttribute("data-gh-prism-far")).toBe(true);

      rect.mockReturnValue(new DOMRect(0, 100, 200, 2000));
      byId("pr-file-tree").dispatchEvent(new Event("scroll"));

      expect(host.hasAttribute("data-gh-prism-far")).toBe(false);
    });
  });

  describe("the on-screen highlight", () => {
    /** Tells the mounted sidebar which files are on screen. */
    const onScreen = (...paths: string[]) => {
      const sidebar = vi.mocked(showSections).mock.results.at(-1)?.value;
      if (!sidebar) throw new Error("no sidebar mounted");
      sidebar.onScreen(new Set(paths));
    };

    const marked = (section: string, path: string) =>
      getComputedStyle(rowIn(section, path)).getPropertyValue("--gh-prism-on-screen").trim() ===
      "1";

    const sectionRoot = (section: string) => {
      const root = document.querySelector(`.gh-prism-section[data-section="${section}"]`);
      if (!root) throw new Error(`no ${section} section`);
      return root;
    };

    it("marks the row of each file on screen", () => {
      onScreen("src/engine.rs", "src/lib.rs");

      expect(marked("implementation", "src/engine.rs")).toBe(true);
      expect(marked("implementation", "src/lib.rs")).toBe(true);
      expect(marked("implementation", "src/render.rs")).toBe(false);
    });

    it("marks a split file in every section listing it", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      onScreen("src/render.rs");

      expect(marked("implementation", "src/render.rs")).toBe(true);
      expect(marked("docs", "src/render.rs")).toBe(true);
    });

    it("clears the marks when no file is on screen", () => {
      onScreen("src/engine.rs");
      onScreen();

      expect(marked("implementation", "src/engine.rs")).toBe(false);
    });

    it("keeps a mark while a row's decoration changes", async () => {
      onScreen("src/engine.rs");
      await setCommentCount("src/engine.rs", 2);

      expect(partTexts("implementation", "src/engine.rs")).toEqual(["2"]);
      expect(marked("implementation", "src/engine.rs")).toBe(true);
    });

    it("marks a section listing a file on screen, collapsed or not", () => {
      sectionToggle("docs").click();
      onScreen("README.md");

      expect(sectionRoot("docs").hasAttribute("data-on-screen")).toBe(true);
      expect(sectionToggle("docs").getAttribute("aria-expanded")).toBe("false");
      expect(sectionRoot("config").hasAttribute("data-on-screen")).toBe(false);

      sectionToggle("docs").click();

      expect(sectionRoot("docs").hasAttribute("data-on-screen")).toBe(true);
      expect(sectionToggle("docs").getAttribute("aria-expanded")).toBe("true");
    });

    it("marks the row of an on-screen file whose section comes back", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      onScreen("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(marked("docs", "docs/intro.md")).toBe(true);
    });

    it("marks a collapsed section that comes back listing an on-screen file", async () => {
      sectionToggle("docs").click();
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      onScreen("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(sectionRoot("docs").hasAttribute("data-on-screen")).toBe(true);
      expect(sectionToggle("docs").getAttribute("aria-expanded")).toBe("false");
    });

    it("never scrolls the sidebar", () => {
      const scrollIntoView = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});
      onScreen("Cargo.lock", "src/render.rs");

      expect(scrollIntoView).not.toHaveBeenCalled();
      scrollIntoView.mockRestore();
    });
  });

  describe("the Viewed dim", () => {
    const dimmed = (section: string, path: string) =>
      getComputedStyle(rowIn(section, path)).getPropertyValue("--gh-prism-viewed").trim() === "1";

    it("dims a Partial file's rows in every section", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      viewed("src/render.rs");

      expect(dimmed("implementation", "src/render.rs")).toBe(true);
      expect(dimmed("docs", "src/render.rs")).toBe(true);
      expect(dimmed("implementation", "src/engine.rs")).toBe(false);
      expect(dimmed("docs", "README.md")).toBe(false);
    });

    it("keeps dimmed rows listed, ordered, and clickable", () => {
      const before = filesIn("implementation");
      viewed("src/render.rs", "src/engine.rs");

      expect(filesIn("implementation")).toEqual(before);
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");
      clickAt(rowIn("implementation", "src/render.rs"));
      expect(click).toHaveBeenCalledOnce();
    });

    it("dims rows of a section built later", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      viewed("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(dimmed("docs", "docs/intro.md")).toBe(true);
    });

    it("clears the dim", () => {
      viewed("src/engine.rs");
      viewed();

      expect(dimmed("implementation", "src/engine.rs")).toBe(false);
    });

    it("restyles without rebuilding the trees", () => {
      const host = treeHost("implementation");
      const row = rowIn("implementation", "src/engine.rs");
      viewed("src/engine.rs");

      expect(treeHost("implementation")).toBe(host);
      expect(rowIn("implementation", "src/engine.rs")).toBe(row);
    });
  });

  describe("the viewed counts", () => {
    const pill = (section: string) => {
      const counter = sectionToggle(section).querySelector(".gh-prism-counter");
      if (!(counter instanceof HTMLElement)) throw new Error(`${section} has no counter`);
      return counter;
    };
    const shownCount = (counter: Element) =>
      (counter.querySelector('[aria-hidden="true"]') ?? counter).textContent;
    const pills = () =>
      [...document.querySelectorAll(".gh-prism-section .gh-prism-counter")].map(shownCount);

    it("counts each section's viewed files once any file is Viewed", () => {
      viewed("src/engine.rs");

      expect(pills()).toEqual(["1/7", "0/1", "0/2", "0/2", "0/1"]);
    });

    it("counts a Partial file in each section that lists it", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      viewed("src/render.rs");

      for (const section of ["implementation", "docs"])
        expect(shownCount(pill(section))).toBe(`1/${filesIn(section).length}`);
    });

    it("says the count in words in the header's accessible name", () => {
      viewed("src/engine.rs");

      const counter = pill("implementation");
      expect(
        sectionToggle("implementation").querySelector(".gh-prism-counter .sr-only")?.textContent,
      ).toBe("1 of 7 viewed");
      expect(counter.querySelector("span:not(.sr-only)")?.getAttribute("aria-hidden")).toBe("true");
    });

    it("counts on a collapsed section", () => {
      sectionToggle("docs").click();
      viewed("docs/guide.md");

      expect(shownCount(pill("docs"))).toBe("1/2");
      expect(sectionToggle("docs").getAttribute("aria-expanded")).toBe("false");
    });

    it("follows marks and unmarks, and goes away once nothing is Viewed", () => {
      const counter = pill("implementation");
      viewed("src/engine.rs");
      viewed("src/engine.rs", "src/render.rs");

      expect(shownCount(counter)).toBe("2/7");
      expect(pill("implementation")).toBe(counter);

      viewed();

      expect(pills()).toEqual(["7", "1", "2", "2", "1"]);
      expect(document.querySelector(".gh-prism-counter .sr-only")).toBeNull();
    });

    it("counts a section built later", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      viewed("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(shownCount(pill("docs"))).toBe("1/1");
    });
  });

  describe("while intent is pending", () => {
    it("shows a busy, indeterminate progress bar and no sections", () => {
      remountWith(pendingIntent().intent);
      expect(view()?.getAttribute("aria-busy")).toBe("true");
      expect(progressBar()?.hasAttribute("aria-valuenow")).toBe(false);
      expect(sectionKeys()).toEqual([]);
    });

    it("carries the progress bar's stylesheet in the bar itself", () => {
      remountWith(pendingIntent().intent);
      expect(
        sheetsStyling("gh-prism-spectrum").some((sheet) => progressBar()?.contains(sheet)),
      ).toBe(true);
    });

    it("bands the spectrum with every section's hue, in section order", () => {
      remountWith(pendingIntent().intent);
      const spectrum = view()?.querySelector<HTMLElement>(".gh-prism-spectrum");
      expect(spectrum?.style.getPropertyValue("--gh-prism-spectrum")).toBe(
        "linear-gradient(90deg, var(--fgColor-accent) 0% 20%, var(--fgColor-done) 20% 40%, var(--fgColor-attention) 40% 60%, var(--fgColor-sponsors) 60% 80%, var(--fgColor-muted) 80% 100%)",
      );
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
        expect(view()?.firstElementChild?.classList.contains("gh-prism-notice")).toBe(true);
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
      expect(view()?.firstElementChild?.classList.contains("gh-prism-notice")).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);

      consoleError.mockRestore();
    });

    it("builds nothing when the intent settles after abort", async () => {
      const { FileTree } = await import("@pierre/trees");
      const render = vi.spyOn(FileTree.prototype, "render");
      const pending = pendingIntent();
      remountWith(pending.intent);
      abort();
      pending.resolve(landedWith(new Map([["src/parser.rs", whole("docs")]])));
      await afterDebounce();

      expect(view()).toBeNull();
      expect(render).not.toHaveBeenCalled();

      render.mockRestore();
    });
  });

  it("renders at once, without a reveal, when there is no intent to wait for", () => {
    expect(view()?.hasAttribute("aria-busy")).toBe(false);
    expect(view()?.hasAttribute("data-reveal")).toBe(false);
    expect(progressBar()).toBeNull();
    expect(sectionKeys()).toHaveLength(5);
  });
});
