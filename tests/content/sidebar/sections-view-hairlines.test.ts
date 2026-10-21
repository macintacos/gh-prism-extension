// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { showSections } from "../../../entrypoints/content/sidebar/sections-view";
import { hostOf, patchShadowActiveElement, rowIn, viewed } from "../../fixtures/sections-view";
import { addNativeFile, afterDebounce, mountsVisit } from "../../fixtures/visit";

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

mountsVisit();

const lit = (element: Element) =>
  getComputedStyle(element).getPropertyValue("--gh-prism-lit").trim() === "1";

/** The pieces of `folder`'s hairline that `listing`'s tree renders. */
const pieces = (listing: string, folder: string) => [
  ...(hostOf(listing).shadowRoot?.querySelectorAll(
    `[data-item-section="spacing-item"][data-ancestor-path="${folder}"]`,
  ) ?? []),
];

const allLit = (listing: string, folder: string) => {
  const found = pieces(listing, folder);
  if (found.length === 0) throw new Error(`${listing} draws no hairline for ${folder}`);
  return found.every(lit);
};

const anyLit = (listing: string, folder: string) => pieces(listing, folder).some(lit);

const pointAt = (target: Element) =>
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, composed: true }));

const leave = (listing: string) => hostOf(listing).dispatchEvent(new PointerEvent("pointerleave"));

const scrollPage = () => document.dispatchEvent(new Event("scroll"));

const boxOf = (listing: string, path: string) => {
  const box = hostOf(listing).shadowRoot?.querySelector<HTMLInputElement>(
    `input[data-item-checkbox="${path}"]`,
  );
  if (!box) throw new Error(`${listing} has no checkbox for ${path}`);
  return box;
};

/** Tells the mounted sidebar which files are on screen. */
const onScreen = (...paths: string[]) => {
  const sidebar = vi.mocked(showSections).mock.results.at(-1)?.value;
  if (!sidebar) throw new Error("no sidebar mounted");
  sidebar.onScreen(new Set(paths));
};

describe("showSections", () => {
  describe("the folder hairlines", () => {
    it("light every piece of a hovered file's folder", () => {
      pointAt(rowIn("implementation", "src/engine.rs"));

      expect(allLit("implementation", "src/")).toBe(true);
    });

    it("light a hovered folder's own hairline, not its parent's", async () => {
      addNativeFile("src/parser/lex.rs", "src/lib.rs");
      addNativeFile("src/parser/ast.rs", "src/lib.rs");
      await afterDebounce();

      pointAt(rowIn("implementation", "src/parser/"));

      expect(allLit("implementation", "src/parser/")).toBe(true);
      expect(anyLit("implementation", "src/")).toBe(false);
    });

    it("light a hovered Viewed box's row's folder", () => {
      viewed();

      pointAt(boxOf("implementation", "src/engine.rs"));

      expect(allLit("implementation", "src/")).toBe(true);
    });

    it("go out when the pointer leaves the tree", () => {
      pointAt(rowIn("implementation", "src/engine.rs"));
      leave("implementation");

      expect(anyLit("implementation", "src/")).toBe(false);
    });

    it("keep an on-screen file's piece lit through a hover and after it", () => {
      onScreen("src/engine.rs");
      const piece = () =>
        rowIn("implementation", "src/engine.rs").querySelector(
          ':scope > [data-item-section="spacing"] > :last-child',
        );

      pointAt(rowIn("implementation", "src/lib.rs"));
      leave("implementation");

      const found = piece();
      expect(found && lit(found)).toBe(true);
    });

    it("go out on a page scroll and light again on the next pointer move", () => {
      const row = rowIn("implementation", "src/engine.rs");
      pointAt(row);
      scrollPage();

      expect(anyLit("implementation", "src/")).toBe(false);

      pointAt(row);

      expect(allLit("implementation", "src/")).toBe(true);
    });

    it("light a focused row's folder", () => {
      rowIn("implementation", "src/engine.rs").focus();

      expect(allLit("implementation", "src/")).toBe(true);
    });

    it("go out when focus leaves the tree", () => {
      rowIn("implementation", "src/engine.rs").focus();
      document.body.tabIndex = -1;
      document.body.focus();

      expect(anyLit("implementation", "src/")).toBe(false);
    });

    it("go out for a focused row on a page scroll", () => {
      rowIn("implementation", "src/engine.rs").focus();
      scrollPage();

      expect(anyLit("implementation", "src/")).toBe(false);
    });
  });
});
