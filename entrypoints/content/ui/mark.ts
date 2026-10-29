import { el, icon } from "./dom";
import { SECTION_SPECTRUM } from "./section-catalog";

const PRISM = "M5.5 2 10 14H1Z";
const BARS = "M8 4.5h7V6H8Z M9.25 7.5H15V9H9.25Z M10.5 10.5H15V12h-4.5Z";

/** The mark's glyph, a prism and the bands it splits light into, for a control that draws it plain. */
export const PRISM_GLYPH = `${PRISM} ${BARS}`;

/**
 * gh-prism's mark, an image named "Added by gh-prism" that takes no focus and links nowhere.
 * Hovering it sweeps the spectrum across its bars. Its styles live in `ui/mark.css`, which the
 * host's sheet must `@import`; without it the mark gets no muted colour, sweep, or tooltip.
 */
export function prismMark(doc: Document): HTMLElement {
  const bars = el(doc, "span", "gh-prism-mark-bars", el(doc, "span", "gh-prism-mark-sweep"));
  // path() is in px, so this matches the glyph only at 16px; reusing BARS keeps one geometry and no
  // SVG ids a second mark would collide with.
  bars.style.clipPath = `path("${BARS}")`;
  const mark = el(doc, "span", "gh-prism-mark", icon(doc, PRISM_GLYPH, {}), bars);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", "Added by gh-prism");
  mark.style.setProperty("--gh-prism-spectrum", SECTION_SPECTRUM);
  return mark;
}
