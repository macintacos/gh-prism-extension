import { el, icon } from "./dom";
import { SECTION_SPECTRUM } from "./section-catalog";

const PRISM = "M5.5 2 10 14H1Z";
const BARS = "M8 4.5h7V6H8Z M9.25 7.5H15V9H9.25Z M10.5 10.5H15V12h-4.5Z";

/** gh-prism's mark: a prism and the bands it splits light into. */
export const PRISM_GLYPH = `${PRISM} ${BARS}`;

/**
 * gh-prism's mark, an image named "Added by gh-prism" that takes no focus and links nowhere.
 * Hovering it sweeps the spectrum across its bars.
 */
export function prismMark(doc: Document): HTMLElement {
  const bars = el(doc, "span", "gh-prism-mark-bars", el(doc, "span", "gh-prism-mark-sweep"));
  // path() clips the spectrum to the bars from this one constant, with no SVG ids that a second
  // mark on the page would collide with.
  bars.style.clipPath = `path("${BARS}")`;
  const mark = el(doc, "span", "gh-prism-mark", icon(doc, PRISM_GLYPH, {}), bars);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", "Added by gh-prism");
  mark.style.setProperty("--gh-prism-spectrum", SECTION_SPECTRUM);
  return mark;
}
