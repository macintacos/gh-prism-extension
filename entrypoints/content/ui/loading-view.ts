/** The progress bar that stands in while intent is read. */

import type { IntentProgress } from "@/utils/intent/read";
import { SECTIONS } from "@/utils/sections";
import { el } from "./dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./loading-view.css?inline";
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
  const count = el(doc, "span", "gh-prism-loading-count tw:tabular-nums");
  const spectrum = el(
    doc,
    "div",
    "gh-prism-spectrum tw:h-[3px] tw:mx-0 tw:mt-2 tw:mb-1.5 tw:overflow-hidden tw:rounded-[2px] tw:bg-bg-neutral-muted",
  );
  spectrum.style.setProperty("--gh-prism-spectrum", SPECTRUM);

  const root = el(
    doc,
    "div",
    "gh-prism-loading tw:px-2 tw:pt-2 tw:pb-1",
    el(
      doc,
      "div",
      "gh-prism-loading-label tw:flex tw:justify-between tw:gap-2 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
      label,
      count,
    ),
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
