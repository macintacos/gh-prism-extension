/**
 * The lines a change adds and removes, as the header's pills and the sidebar's sections show them.
 * No sheet of its own: every caller's sheet must `@source` this file for its utilities.
 */

import type { LineCounts } from "@/utils/github/pr-diff";
import { el } from "./dom";

/** `lines` with US thousands separators, as GitHub writes line counts. */
export const count = (lines: number) => lines.toLocaleString("en-US");

/** `+added` and `−removed` in the diffstat colors, muting a side that changed nothing. */
export function counts(doc: Document, { added, removed }: LineCounts): HTMLElement[] {
  const part = (text: string, className: string) => {
    const span = el(doc, "span", className, text);
    span.setAttribute("aria-hidden", "true");
    return span;
  };
  const mutedClass = "gh-prism-pill-count tw:text-fg-muted";
  return [
    part(`+${count(added)}`, added > 0 ? "gh-prism-pill-count tw:text-fg-success" : mutedClass),
    part(`−${count(removed)}`, removed > 0 ? "gh-prism-pill-count tw:text-fg-danger" : mutedClass),
  ];
}

/** `lines` as a pill counts them, said in words to screen readers. */
export const lineTotals = (doc: Document, lines: LineCounts): HTMLElement =>
  el(
    doc,
    "span",
    "gh-prism-line-totals tw:flex tw:shrink-0 tw:gap-1 tw:ms-auto tw:text-body-small tw:whitespace-nowrap",
    ...counts(doc, lines),
    el(doc, "span", "sr-only", `${count(lines.added)} added, ${count(lines.removed)} removed`),
  );
