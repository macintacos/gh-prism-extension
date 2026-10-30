// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { prismMark } from "../../../entrypoints/content/ui/mark";

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

  it("draws a solid layer and a shaded face at 40% opacity", () => {
    const paths = [...prismMark(document).querySelectorAll(":scope > svg > path")];
    expect(paths.map((path) => path.getAttribute("opacity"))).toEqual([null, "0.4"]);
  });

  it("carries a pulsing copy of its glyph", () => {
    const mark = prismMark(document);
    expect(mark.querySelector(".gh-prism-mark-pulse > svg")?.innerHTML).toBe(
      mark.querySelector(":scope > svg")?.innerHTML,
    );
  });
});
