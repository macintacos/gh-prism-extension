const SVG_NS = "http://www.w3.org/2000/svg";

/** Octicons 19.15.0 (MIT, GitHub Inc.): x. */
export const X_ICON =
  "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z";

/** Whether `target` takes typed text, so a key pressed there belongs to it. */
export const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select"));

/** A new `tag` element of `doc` with `className`, holding `children`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

/** A decorative 16 px icon that draws `d`; `attributes` add to or override its defaults. */
export function icon(
  doc: Document,
  d: string,
  attributes: Readonly<Record<string, string>>,
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 16 16",
    width: "16",
    height: "16",
    fill: "currentColor",
    "aria-hidden": "true",
    ...attributes,
  })) {
    svg.setAttribute(name, value);
  }
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}
