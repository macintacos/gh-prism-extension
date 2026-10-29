// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PRISM_GLYPH, prismMark } from "../../../entrypoints/content/ui/mark";
import { SECTION_SPECTRUM } from "../../../entrypoints/content/ui/section-catalog";

describe("prismMark", () => {
  it("is an image named for gh-prism", () => {
    const mark = prismMark(document);
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe("Added by gh-prism");
  });

  it("takes no focus and links nowhere", () => {
    const mark = prismMark(document);
    document.body.append(mark);
    expect(mark.hasAttribute("tabindex")).toBe(false);
    expect(mark.closest("a")).toBeNull();
    expect(mark.querySelector("a")).toBeNull();
    mark.remove();
  });

  it("holds no ids, so several marks on one page can't collide", () => {
    expect(prismMark(document).querySelector("[id]")).toBeNull();
  });

  it("sweeps the section spectrum", () => {
    expect(prismMark(document).style.getPropertyValue("--gh-prism-spectrum")).toBe(
      SECTION_SPECTRUM,
    );
  });

  it("draws the prism glyph", () => {
    expect(prismMark(document).querySelector("svg path")?.getAttribute("d")).toBe(PRISM_GLYPH);
  });
});
