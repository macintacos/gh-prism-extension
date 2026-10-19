// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { byId } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  commentLinesToggle,
  decorationTitle,
  nativeLink,
  partsOf,
  partTexts,
  patchShadowActiveElement,
  press,
  renderSplit,
  renderSplitPlacements,
  rowIn,
  setCommentCount,
  withCommentLines,
} from "../../fixtures/sections-view";
import { addNativeFile, afterDebounce, mountsVisit, rowsIn } from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

patchShadowActiveElement();

const { landed, abort } = mountsVisit();

describe("showSections", () => {
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

    it("marks Partial an Implementation row whose comment lines count toward Docs & Comments", async () => {
      await landed(withCommentLines());

      expect(partTexts("implementation", "src/engine.rs")).toEqual(["1", "Partial", "+6", "−2"]);
      expect(partTexts("implementation", "src/parser.rs")).toEqual(["Partial", "+2", "−0"]);
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

    it("reveals the whole file from a comment-lines row, never a share's hunk", async () => {
      await landed(
        landedWith(
          renderSplitPlacements([{ first: 2, last: 8 }]),
          new Map([["src/render.rs", { added: 8, removed: 2 }]]),
          new Map([["src/render.rs", { added: 1, removed: 0 }]]),
        ),
      );
      commentLinesToggle().click();
      mountRenderDiff(2, 22);
      const click = vi.spyOn(nativeLink("src/render.rs"), "click");

      clickAt(rowIn(COMMENT_LINES, "src/render.rs"));
      await afterDebounce();

      expect(click).toHaveBeenCalledOnce();
      expect(diffScrolls()).toEqual([]);
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
});
