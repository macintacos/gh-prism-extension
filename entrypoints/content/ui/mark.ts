import { el, icon } from "./dom";

const SOLID =
  "M4.85 2.53Q5.25 1.5 5.3 2.6L5.77 13.55Q5.8 14.35 5.05 14.06L1.75 12.79Q1 12.5 1.29 11.75Z M8.84 4.5H14.25a0.75 0.75 0 0 1 0 1.5H8.84a0.75 0.75 0 0 1 0 -1.5Z M10.23 7.5H14.25a0.75 0.75 0 0 1 0 1.5H10.23a0.75 0.75 0 0 1 0 -1.5Z M11.62 10.5H14.25a0.75 0.75 0 0 1 0 1.5H11.62a0.75 0.75 0 0 1 0 -1.5Z";
const SHADED =
  "M5.37 2.59Q5.25 1.5 5.71 2.5L9.66 11.02Q10 11.75 9.37 12.25L7.33 13.85Q6.7 14.35 6.61 13.56Z";

/** The mark's glyph, a faceted prism and the bands it splits light into, in two tones. */
export function prismGlyph(
  doc: Document,
  attributes: Readonly<Record<string, string>>,
): SVGSVGElement {
  const svg = icon(doc, SOLID, attributes);
  const shaded = doc.createElementNS(svg.namespaceURI, "path");
  shaded.setAttribute("d", SHADED);
  shaded.setAttribute("opacity", "0.4");
  svg.append(shaded);
  return svg;
}

/**
 * gh-prism's mark, an image named "Added by gh-prism" that takes no focus and links nowhere.
 * Hovering it pulses the glyph through the section hues. Its styles live in `ui/mark.css`, which
 * the host's sheet must `@import`; without it the mark gets no muted colour, pulse, or tooltip.
 */
export function prismMark(doc: Document): HTMLElement {
  const mark = el(
    doc,
    "span",
    "gh-prism-mark",
    prismGlyph(doc, {}),
    el(doc, "span", "gh-prism-mark-pulse", prismGlyph(doc, {})),
  );
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", "Added by gh-prism");
  return mark;
}
