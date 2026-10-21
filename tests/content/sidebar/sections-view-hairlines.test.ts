// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  hostOf,
  lit,
  onScreen,
  patchShadowActiveElement,
  rowIn,
  viewed,
} from "../../fixtures/sections-view";
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

/** The pieces of `folder`'s hairline that `listing`'s tree renders; throws when there are none. */
const pieces = (listing: string, folder: string) => {
  const found = [
    ...(hostOf(listing).shadowRoot?.querySelectorAll(
      `[data-item-section="spacing-item"][data-ancestor-path="${folder}"]`,
    ) ?? []),
  ];
  if (found.length === 0) throw new Error(`${listing} draws no hairline for ${folder}`);
  return found;
};

const allLit = (listing: string, folder: string) => pieces(listing, folder).every(lit);

const noneLit = (listing: string, folder: string) => !pieces(listing, folder).some(lit);

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
      expect(noneLit("implementation", "src/")).toBe(true);
    });

    it("light a hovered file's flattened folder chain", async () => {
      addNativeFile("src/deep/inner/a.rs", "src/lib.rs");
      addNativeFile("src/deep/inner/b.rs", "src/lib.rs");
      await afterDebounce();

      pointAt(rowIn("implementation", "src/deep/inner/a.rs"));

      expect(allLit("implementation", "src/deep/inner/")).toBe(true);
    });

    it("light a hovered Viewed box's row's folder", () => {
      viewed();

      pointAt(boxOf("implementation", "src/engine.rs"));

      expect(allLit("implementation", "src/")).toBe(true);
    });

    it("go out when the pointer leaves the tree", () => {
      pointAt(rowIn("implementation", "src/engine.rs"));

      leave("implementation");

      expect(noneLit("implementation", "src/")).toBe(true);
    });

    it("keep an on-screen file's piece lit through a hover and after it", () => {
      onScreen("src/engine.rs");

      pointAt(rowIn("implementation", "src/lib.rs"));
      leave("implementation");

      const piece = rowIn("implementation", "src/engine.rs").querySelector(
        ':scope > [data-item-section="spacing"] > [data-ancestor-path="src/"]',
      );
      expect(piece && lit(piece)).toBe(true);
    });

    it("go out on a page scroll and light again on the next pointer move", () => {
      const row = rowIn("implementation", "src/engine.rs");
      pointAt(row);

      scrollPage();

      expect(noneLit("implementation", "src/")).toBe(true);

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

      expect(noneLit("implementation", "src/")).toBe(true);
    });

    it("go out when focus leaves the tree for nothing focusable", () => {
      const row = rowIn("implementation", "src/engine.rs");
      row.focus();

      row.blur();
      vi.runOnlyPendingTimers();

      expect(noneLit("implementation", "src/")).toBe(true);
    });

    it("go out for a focused row on a page scroll", () => {
      rowIn("implementation", "src/engine.rs").focus();

      scrollPage();

      expect(noneLit("implementation", "src/")).toBe(true);
    });

    it("stay out after a page scroll when the library re-focuses the same row", () => {
      const row = rowIn("implementation", "src/engine.rs");
      row.focus();
      scrollPage();

      row.blur();
      row.focus();

      expect(noneLit("implementation", "src/")).toBe(true);
    });
  });
});
