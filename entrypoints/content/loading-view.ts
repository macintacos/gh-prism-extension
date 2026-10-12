/** The progress bar that stands in while intent is read. sections-view.css styles its classes. */

import type { IntentProgress } from "@/utils/intent";
import { el } from "./dom";

export /** A progress bar that reads the diff, then counts the files checked, over `skeleton`. */
function loadingView(doc: Document, skeleton: HTMLElement) {
  const label = el(doc, "span", "", "Reading the diff");
  const count = el(doc, "span", "gh-prism-loading-count");
  const root = el(
    doc,
    "div",
    "gh-prism-loading",
    el(doc, "div", "gh-prism-loading-label", label, count),
    el(doc, "div", "gh-prism-spectrum"),
    skeleton,
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
