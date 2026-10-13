/** The progress bar that stands in while intent is read. */

import type { IntentProgress } from "@/utils/intent/intent";
import { SECTIONS } from "@/utils/sections";
import { el } from "./dom";
import css from "./loading-view.css?raw";
import { SECTION_CATALOG } from "./section-catalog";

// CSS can't lay down a band per section, so the gradient follows SECTIONS from here.
const BAND = 100 / SECTIONS.length;
const SPECTRUM = `linear-gradient(90deg, ${SECTIONS.map(
  (key, i) => `var(${SECTION_CATALOG[key].hue}) ${i * BAND}% ${(i + 1) * BAND}%`,
).join(", ")})`;

/** A progress bar over a skeleton, drawn while intent is read. */
export interface LoadingView {
  /** The bar and its skeleton, carrying the bar's stylesheet, so it is styled wherever it mounts. */
  readonly root: HTMLElement;
  /** Counts the files checked so far. */
  progress(progress: IntentProgress): void;
}

/** A progress bar that reads the diff, then counts the files checked, over `skeleton`. */
export function loadingView(doc: Document, skeleton: HTMLElement): LoadingView {
  const label = el(doc, "span", "", "Reading the diff");
  const count = el(doc, "span", "gh-prism-loading-count");
  const spectrum = el(doc, "div", "gh-prism-spectrum");
  spectrum.style.setProperty("--gh-prism-spectrum", SPECTRUM);

  const root = el(
    doc,
    "div",
    "gh-prism-loading",
    el(doc, "div", "gh-prism-loading-label", label, count),
    spectrum,
    skeleton,
    Object.assign(doc.createElement("style"), { textContent: css }),
  );
  root.setAttribute("role", "progressbar");
  root.setAttribute("aria-label", "Reading the diff");

  const progress = ({ checked, total }: IntentProgress) => {
    label.textContent = "Sorting files into sections";
    count.textContent = `${checked} of ${total}`;
    root.setAttribute("aria-label", label.textContent);
    root.setAttribute("aria-valuemax", String(total));
    root.setAttribute("aria-valuenow", String(checked));
    root.style.setProperty("--gh-prism-progress", String(total > 0 ? checked / total : 1));
  };
  return { root, progress };
}
