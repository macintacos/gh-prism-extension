/** The lines a change adds and removes, as the header's pills and the sidebar's sections show them. */

import type { LineCounts } from "@/utils/github/pr-diff";
import { el } from "./dom";

export const count = (lines: number) => lines.toLocaleString("en-US");

/** `+added` and `−removed` in the diffstat colors, muting a side that changed nothing. */
export function counts(doc: Document, { added, removed }: LineCounts): HTMLElement[] {
  const part = (text: string, color: string) => {
    const span = el(doc, "span", `gh-prism-pill-count ${color}`, text);
    span.setAttribute("aria-hidden", "true");
    return span;
  };
  return [
    part(`+${count(added)}`, added > 0 ? "fgColor-success" : "fgColor-muted"),
    part(`−${count(removed)}`, removed > 0 ? "fgColor-danger" : "fgColor-muted"),
  ];
}

/** `lines` as a pill counts them, said in words to screen readers. */
export const lineTotals = (doc: Document, lines: LineCounts): HTMLElement =>
  el(
    doc,
    "span",
    "gh-prism-line-totals",
    ...counts(doc, lines),
    el(doc, "span", "sr-only", `${count(lines.added)} added, ${count(lines.removed)} removed`),
  );
