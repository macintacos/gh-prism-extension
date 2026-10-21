// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { showSections } from "../../../entrypoints/content/sidebar/sections-view";
import { byId } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  commentLinesRoot,
  commentLinesToggle,
  hostOf,
  partTexts,
  patchShadowActiveElement,
  press,
  renderSplit,
  rowIn,
  sectionToggle,
  setCommentCount,
  withCommentLines,
} from "../../fixtures/sections-view";
import {
  addNativeFile,
  afterDebounce,
  mountsVisit,
  rowsIn,
  sectionKeys,
  treeHost,
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

patchShadowActiveElement();

const { landed } = mountsVisit();

describe("showSections", () => {
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
      if (rows[0]) press(rows[0], "End");
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

    describe("for a current file with comment lines", () => {
      /** The listings whose trees scrolled the sidebar, in order. */
      const scrolledListings = () =>
        scrollIntoView.mock.contexts.flatMap((context) =>
          ["implementation", COMMENT_LINES].filter(
            (listing) =>
              context instanceof Node && context.getRootNode() === hostOf(listing).shadowRoot,
          ),
        );

      beforeEach(async () => {
        await landed(withCommentLines());
        commentLinesToggle().click();

        scrollIntoView.mockClear();
      });

      it("scrolls Implementation to it", async () => {
        moveCurrentTo("src/engine.rs");
        await afterDebounce();
        expect(scrolledListings()).toEqual(["implementation"]);
      });

      it("scrolls the comment-lines sub-section when it was clicked there", async () => {
        clickAt(rowIn(COMMENT_LINES, "src/engine.rs"));
        moveCurrentTo("src/engine.rs");
        await afterDebounce();
        // The click's focus scrolls the sub-section's tree too.
        expect(new Set(scrolledListings())).toEqual(new Set([COMMENT_LINES]));
      });

      it("scrolls Implementation once Docs & Comments hides the sub-section it was clicked in", async () => {
        clickAt(rowIn(COMMENT_LINES, "src/engine.rs"));
        sectionToggle("docs").click();
        scrollIntoView.mockClear();

        moveCurrentTo("src/engine.rs");
        await afterDebounce();

        expect(scrolledListings()).toEqual(["implementation"]);
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

    const lit = (element: Element) =>
      getComputedStyle(element).getPropertyValue("--gh-prism-lit").trim() === "1";

    /** Whether the row's piece of its folder's hairline is lit, or a top-level row's edge. */
    const marked = (section: string, path: string) => {
      const row = rowIn(section, path);
      return lit(row.querySelector(':scope > [data-item-section="spacing"] > :last-child') ?? row);
    };

    it("lights a nested file's piece of its own folder's hairline alone", () => {
      onScreen("src/engine.rs");

      const row = rowIn("implementation", "src/engine.rs");
      const pieces = [...row.querySelectorAll(':scope > [data-item-section="spacing"] > *')];
      expect(pieces.length).toBeGreaterThan(0);
      expect(pieces.map(lit)).toEqual([...pieces.slice(0, -1).map(() => false), true]);
      expect(lit(row)).toBe(false);
    });

    it("lights a top-level file's row", () => {
      onScreen("README.md");

      expect(lit(rowIn("docs", "README.md"))).toBe(true);
    });

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

    it("marks a file's comment-lines row too", async () => {
      await landed(withCommentLines());
      commentLinesToggle().click();
      onScreen("src/engine.rs");

      expect(marked(COMMENT_LINES, "src/engine.rs")).toBe(true);
      expect(marked(COMMENT_LINES, "src/parser.rs")).toBe(false);
    });

    it("leaves a comment-lines file's header mark to Implementation, which lists it too", async () => {
      await landed(withCommentLines());
      sectionToggle("docs").click();
      onScreen("src/engine.rs");

      expect(sectionRoot("implementation").hasAttribute("data-on-screen")).toBe(true);
      expect(sectionRoot("docs").hasAttribute("data-on-screen")).toBe(false);
      expect(commentLinesRoot()?.hasAttribute("data-on-screen")).toBe(false);
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
});
