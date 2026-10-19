// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { byId, loadViewedFixture } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  commentLinesToggle,
  hostOf,
  nativeLink,
  partTexts,
  patchShadowActiveElement,
  press,
  renderSplit,
  rowIn,
  sectionToggle,
  setCommentCount,
  viewed,
} from "../../fixtures/sections-view";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
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

const { landed, abort } = mountsVisit();

describe("showSections", () => {
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

  describe("the Viewed checkbox", () => {
    const boxesIn = (listing: string) => [
      ...(hostOf(listing).shadowRoot?.querySelectorAll<HTMLInputElement>(
        "input[data-item-checkbox]",
      ) ?? []),
    ];
    const boxOf = (listing: string, path: string) => {
      const box = boxesIn(listing).find((input) => input.dataset.itemCheckbox === path);
      if (!box) throw new Error(`${listing} has no checkbox for ${path}`);
      return box;
    };

    it("shows no checkbox until Viewed is offered", () => {
      expect(boxesIn("implementation")).toEqual([]);
    });

    it("leaves a file row's Alt-click to the tree until Viewed is offered", async () => {
      const row = rowIn("implementation", "src/engine.rs");

      clickAt(row, { altKey: true });
      await afterDebounce();

      expect(treeHost("implementation").shadowRoot?.activeElement).toBe(
        rowIn("implementation", "src/engine.rs"),
      );
    });

    it("gives every file row, and no directory row, a checkbox once Viewed is offered", () => {
      viewed();

      expect(boxesIn("implementation").map((box) => box.dataset.itemCheckbox)).toEqual(
        filesIn("implementation"),
      );
    });

    it("ticks a Partial file's boxes in every section", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));
      viewed("src/render.rs");

      expect(boxOf("implementation", "src/render.rs").checked).toBe(true);
      expect(boxOf("docs", "src/render.rs").checked).toBe(true);
      expect(boxOf("implementation", "src/engine.rs").checked).toBe(false);
    });

    it("names the box for its file and says what a click does", () => {
      viewed("src/render.rs");

      expect(boxOf("implementation", "src/render.rs").getAttribute("aria-label")).toBe(
        "Viewed: render.rs",
      );
      expect(boxOf("implementation", "src/render.rs").title).toBe(
        "Mark as not viewed (or Alt-click the row)",
      );
      expect(boxOf("implementation", "src/engine.rs").title).toBe(
        "Mark as viewed (or Alt-click the row)",
      );
    });

    it("calls the Alt key Option on macOS", async () => {
      const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
      await landed(landedWith());

      viewed();

      expect(boxOf("implementation", "src/engine.rs").title).toBe(
        "Mark as viewed (or Option-click the row)",
      );
      platform.mockRestore();
    });

    it("puts only the focused row's box in the tab order", async () => {
      viewed();
      const rows = rowsIn("implementation");
      rows[0]?.focus();
      if (rows[0]) press(rows[0], "End");
      await afterDebounce();

      expect(boxesIn("implementation").filter((box) => box.tabIndex === 0)).toEqual([
        boxOf("implementation", rows.at(-1)?.dataset.itemPath ?? ""),
      ]);
    });

    it("keeps its state through a row's re-render", async () => {
      viewed("src/engine.rs");
      await setCommentCount("src/engine.rs", 2);

      expect(partTexts("implementation", "src/engine.rs")).toEqual(["2"]);
      expect(boxOf("implementation", "src/engine.rs").checked).toBe(true);
    });

    it("appears in a section built later", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();
      viewed("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(boxOf("docs", "docs/intro.md").checked).toBe(true);
    });

    it("never scrolls the sidebar when focused", () => {
      viewed();
      const scrollIntoView = vi
        .spyOn(Element.prototype, "scrollIntoView")
        .mockImplementation(() => {});

      boxOf("implementation", "src/engine.rs").focus();

      expect(scrollIntoView).not.toHaveBeenCalled();
      scrollIntoView.mockRestore();
    });

    describe("a click on it", () => {
      const LIB = "src/lib.rs";
      const APP = "config/app.toml";
      const CARGO = "Cargo.lock";

      const sectionOf = (path: string) => {
        const section = sectionKeys().find((key) => key && filesIn(key).includes(path));
        if (!section) throw new Error(`no section lists ${path}`);
        return section;
      };
      const box = (path: string) => boxOf(sectionOf(path), path);
      const regionOf = (path: string) => byId(nativeLink(path).hash.slice(1));
      const toggleIn = (region: Element) => {
        const toggle = region.querySelector<HTMLButtonElement>('button[aria-label$="Viewed"]');
        if (!toggle) throw new Error(`#${region.id} has no Viewed toggle`);
        return toggle;
      };

      /**
       * Has `path`'s header toggle flip 120 ms after each click, so the box's pending state is
       * observable, then, when `reverts`, flip back as a page that undoes a rejected save would.
       * GitHub flips in a microtask, an ordering happy-dom can't reproduce (the e2e stand-in does),
       * so a timer stands in.
       */
      function stubToggle(path: string, { reverts = false } = {}) {
        const toggle = toggleIn(regionOf(path));
        const show = (pressed: boolean) => {
          toggle.setAttribute("aria-pressed", String(pressed));
          toggle.setAttribute("aria-label", pressed ? "Viewed" : "Not Viewed");
        };
        return vi.spyOn(toggle, "click").mockImplementation(() => {
          const was = toggle.getAttribute("aria-pressed") === "true";
          setTimeout(() => {
            show(!was);
            if (reverts) setTimeout(() => show(was), 500);
          }, 120);
        });
      }

      const settle = () => vi.advanceTimersByTimeAsync(1_000);

      let scrollIntoView: MockInstance<Element["scrollIntoView"]>;

      beforeEach(async () => {
        loadViewedFixture();
        await landed(landedWith());
        scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
      });

      afterEach(() => {
        scrollIntoView.mockRestore();
      });

      it("clicks a mounted file's toggle once, revealing nothing", async () => {
        const toggle = stubToggle(LIB);
        const links = vi.spyOn(HTMLAnchorElement.prototype, "click");

        clickAt(box(LIB));
        await settle();

        expect(toggle).toHaveBeenCalledOnce();
        expect(links).not.toHaveBeenCalled();
        expect(scrollIntoView).not.toHaveBeenCalled();
        links.mockRestore();
      });

      it("leaves the row unselected and unfocused", async () => {
        stubToggle(LIB);

        clickAt(box(LIB));
        await settle();

        expect(rowIn(sectionOf(LIB), LIB).getAttribute("aria-selected")).not.toBe("true");
        expect(treeHost(sectionOf(LIB)).shadowRoot?.activeElement).not.toBe(
          rowIn(sectionOf(LIB), LIB),
        );
      });

      it("shows the box pending until the header flips, then the header's state", async () => {
        stubToggle(LIB);

        clickAt(box(LIB));
        await vi.advanceTimersByTimeAsync(0);
        const pending = box(LIB);

        expect(pending.getAttribute("aria-busy")).toBe("true");
        expect(pending.checked).toBe(false);

        await settle();

        expect(box(LIB).getAttribute("aria-busy")).not.toBe("true");
        expect(box(LIB).checked).toBe(true);
      });

      it("shows the box pending in a section built while it settles", async () => {
        vi.spyOn(toggleIn(regionOf(LIB)), "click").mockImplementation(() => {});
        const link = byId(LIB);
        const { parentElement } = link;
        clickAt(box(LIB));
        await vi.advanceTimersByTimeAsync(0);

        link.remove();
        await afterDebounce();
        parentElement?.append(link);
        await afterDebounce();

        expect(box(LIB).getAttribute("aria-busy")).toBe("true");
      });

      it("clicks the toggle of a file whose diff hasn't loaded", async () => {
        const toggle = stubToggle(CARGO);

        clickAt(box(CARGO));
        await settle();

        expect(toggle).toHaveBeenCalledOnce();
        expect(box(CARGO).checked).toBe(true);
      });

      it("unmarks a viewed file", async () => {
        stubToggle(APP);

        clickAt(box(APP));
        await settle();

        expect(box(APP).checked).toBe(false);
      });

      it("ignores a click while the box is pending", async () => {
        const toggle = stubToggle(LIB);

        clickAt(box(LIB));
        await vi.advanceTimersByTimeAsync(0);
        clickAt(box(LIB));
        await settle();

        expect(toggle).toHaveBeenCalledOnce();
      });

      it("ignores the second click of a double-click", async () => {
        const toggle = stubToggle(LIB);

        clickAt(box(LIB), { detail: 1 });
        clickAt(box(LIB), { detail: 2 });
        await settle();

        expect(toggle).toHaveBeenCalledOnce();
      });

      it("mirrors a page that keeps a rejected save pressed", async () => {
        stubToggle(LIB);

        clickAt(box(LIB));
        await settle();

        expect(box(LIB).checked).toBe(true);
      });

      it("mirrors a page that reverts a rejected save", async () => {
        stubToggle(LIB, { reverts: true });

        clickAt(box(LIB));
        await settle();

        expect(box(LIB).checked).toBe(false);
        expect(box(LIB).getAttribute("aria-busy")).not.toBe("true");
      });

      it("marks a Partial file once and ticks its box in every section", async () => {
        await landed(
          landedWith(
            new Map([
              [
                LIB,
                {
                  kind: "split",
                  shares: [
                    { section: "implementation", hunks: [], lines: { added: 1, removed: 0 } },
                    { section: "docs", hunks: [], lines: { added: 1, removed: 0 } },
                  ],
                },
              ],
            ]),
          ),
        );
        const toggle = stubToggle(LIB);

        clickAt(boxOf("docs", LIB));
        await settle();

        expect(toggle).toHaveBeenCalledOnce();
        expect(boxOf("implementation", LIB).checked).toBe(true);
        expect(boxOf("docs", LIB).checked).toBe(true);
      });

      describe("on a comment-lines row", () => {
        beforeEach(async () => {
          await landed(
            landedWith(
              new Map(),
              new Map([[LIB, { added: 4, removed: 1 }]]),
              new Map([[LIB, { added: 1, removed: 0 }]]),
            ),
          );
          commentLinesToggle().click();
        });

        it("marks the file once and ticks its box in every listing", async () => {
          const toggle = stubToggle(LIB);

          clickAt(boxOf(COMMENT_LINES, LIB));
          await settle();

          expect(toggle).toHaveBeenCalledOnce();
          expect(boxOf(COMMENT_LINES, LIB).checked).toBe(true);
          expect(boxOf("implementation", LIB).checked).toBe(true);
        });

        it("marks the file when the row is Alt-clicked, opening nothing", async () => {
          const toggle = stubToggle(LIB);
          const links = vi.spyOn(HTMLAnchorElement.prototype, "click");

          clickAt(rowIn(COMMENT_LINES, LIB), { altKey: true });
          await settle();

          expect(toggle).toHaveBeenCalledOnce();
          expect(links).not.toHaveBeenCalled();
          expect(boxOf("implementation", LIB).checked).toBe(true);
          links.mockRestore();
        });
      });

      describe("for a file whose diff isn't mounted", () => {
        let entry: Element;

        beforeEach(() => {
          const region = regionOf(LIB);
          entry = region.parentElement ?? region;
          entry.remove();
        });

        const mount = () =>
          document.querySelector('[data-testid="progressive-diffs-list"]')?.append(entry);

        it("reveals it, then clicks its toggle once it mounts", async () => {
          const toggle = toggleIn(entry);
          const flip = vi.spyOn(toggle, "click");
          const link = vi.spyOn(nativeLink(LIB), "click");

          clickAt(box(LIB));
          await settle();

          expect(link).toHaveBeenCalledOnce();
          expect(flip).not.toHaveBeenCalled();

          mount();
          await settle();

          expect(flip).toHaveBeenCalledOnce();
        });

        it("leaves a header that already shows the target alone", async () => {
          const toggle = toggleIn(entry);
          toggle.setAttribute("aria-pressed", "true");
          const flip = vi.spyOn(toggle, "click");

          clickAt(box(LIB));
          mount();
          await settle();

          expect(flip).not.toHaveBeenCalled();
          expect(box(LIB).getAttribute("aria-busy")).not.toBe("true");
        });

        it("marks nothing when the diff never mounts", async () => {
          const flip = vi.spyOn(toggleIn(entry), "click");

          clickAt(box(LIB));
          await vi.advanceTimersByTimeAsync(5_000);
          mount();
          await settle();

          expect(flip).not.toHaveBeenCalled();
          expect(box(LIB).checked).toBe(false);
          expect(box(LIB).getAttribute("aria-busy")).not.toBe("true");
        });

        it("still scrolls the sidebar to it once it later becomes current", async () => {
          clickAt(box(LIB));
          await vi.advanceTimersByTimeAsync(5_000);
          scrollIntoView.mockClear();

          byId(LIB).setAttribute("aria-current", "true");
          await afterDebounce();

          expect(scrollIntoView).toHaveBeenCalled();
        });

        it.each([
          ["a newer row click", () => clickAt(rowIn(sectionOf(APP), APP))],
          ["a newer box click", () => clickAt(box(APP))],
          ["the view's abort", () => abort()],
        ])("marks nothing after %s", async (_, cancel) => {
          const flip = vi.spyOn(toggleIn(entry), "click");

          clickAt(box(LIB));
          await vi.advanceTimersByTimeAsync(0);
          cancel();
          mount();
          await settle();

          expect(flip).not.toHaveBeenCalled();
        });
      });

      it("never scrolls the sidebar", async () => {
        stubToggle(LIB);

        clickAt(box(LIB));
        await settle();

        expect(scrollIntoView).not.toHaveBeenCalled();
      });

      describe("made by Alt-clicking its file's row", () => {
        const altClickRow = (path: string, init: MouseEventInit = {}) =>
          clickAt(rowIn(sectionOf(path), path), { altKey: true, ...init });

        it("marks the file through its toggle, opening nothing", async () => {
          const toggle = stubToggle(LIB);
          const links = vi.spyOn(HTMLAnchorElement.prototype, "click");

          altClickRow(LIB);
          await settle();

          expect(toggle).toHaveBeenCalledOnce();
          expect(links).not.toHaveBeenCalled();
          expect(box(LIB).checked).toBe(true);
          links.mockRestore();
        });

        it("unmarks a viewed file", async () => {
          stubToggle(APP);

          altClickRow(APP);
          await settle();

          expect(box(APP).checked).toBe(false);
        });

        it("leaves the row unselected and unfocused", async () => {
          stubToggle(LIB);

          altClickRow(LIB);
          await settle();

          expect(rowIn(sectionOf(LIB), LIB).getAttribute("aria-selected")).not.toBe("true");
          expect(treeHost(sectionOf(LIB)).shadowRoot?.activeElement).toBeNull();
        });

        it("ignores the second click of a double-click", async () => {
          const toggle = stubToggle(LIB);

          altClickRow(LIB, { detail: 1 });
          await settle();
          altClickRow(LIB, { detail: 2 });
          await settle();

          expect(toggle).toHaveBeenCalledOnce();
        });

        it("leaves a directory's Alt-click to the tree", async () => {
          const toggle = stubToggle(LIB);

          clickAt(rowIn("implementation", "src/"), { altKey: true });
          await settle();

          expect(rowIn("implementation", "src/").getAttribute("aria-expanded")).toBe("false");
          expect(toggle).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("the viewed counts", () => {
    const counter = (section: string) => {
      const found = sectionToggle(section).querySelector(".gh-prism-counter");
      if (!(found instanceof HTMLElement)) throw new Error(`${section} has no counter`);
      return found;
    };
    const countText = (found: Element) =>
      (found.querySelector('[aria-hidden="true"]') ?? found).textContent;
    const counters = () =>
      [...document.querySelectorAll(".gh-prism-section .gh-prism-counter")].map(countText);

    it("counts each section's viewed files once any file is Viewed", () => {
      viewed("src/engine.rs");

      expect(counters()).toEqual(["1/7", "0/1", "0/2", "0/2", "0/1"]);
    });

    it("counts a Partial file in each section that lists it", async () => {
      await landed(renderSplit([{ first: 2, last: 8 }]));

      viewed("src/render.rs");

      expect(counters()).toEqual(["1/7", "0/1", "1/3", "0/2", "0/1"]);
    });

    it("says the count in words in the header's accessible name", () => {
      viewed("src/engine.rs");

      const implementation = counter("implementation");
      expect(
        sectionToggle("implementation").querySelector(".gh-prism-counter .sr-only")?.textContent,
      ).toBe("1 of 7 viewed");
      expect(implementation.querySelector("span:not(.sr-only)")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
    });

    it("counts on a collapsed section", () => {
      sectionToggle("docs").click();

      viewed("docs/guide.md");

      expect(countText(counter("docs"))).toBe("1/2");
      expect(sectionToggle("docs").getAttribute("aria-expanded")).toBe("false");
    });

    it("follows marks and unmarks, and goes away once nothing is Viewed", () => {
      viewed("src/engine.rs");
      viewed("src/engine.rs", "src/render.rs");

      expect(countText(counter("implementation"))).toBe("2/7");

      viewed();

      expect(counters()).toEqual(["7", "1", "2", "2", "1"]);
      expect(document.querySelector(".gh-prism-counter .sr-only")).toBeNull();
    });

    it("leaves an unchanged count's DOM alone", () => {
      viewed("src/engine.rs");
      const figure = counter("implementation").querySelector('[aria-hidden="true"]');

      viewed("src/engine.rs", "docs/guide.md");

      expect(counter("implementation").querySelector('[aria-hidden="true"]')).toBe(figure);
    });

    it("counts a section built later", async () => {
      byId("docs/guide.md").remove();
      byId("README.md").remove();
      await afterDebounce();

      viewed("docs/intro.md");
      addNativeFile("docs/intro.md", "config/app.toml");
      await afterDebounce();

      expect(countText(counter("docs"))).toBe("1/1");
    });
  });
});
