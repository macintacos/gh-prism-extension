/**
 * Breaks the header's lines-changed counter, on a pull request or a commit, out by section once
 * intent lands: a pill per section with the lines it adds and removes. A click switches between
 * that breakout and GitHub's own total. sections-view.css styles the pills; showVisit mounts the
 * sidebar on every page.
 */

import { type Landing, landingOf, type SectionLines, totalsOf } from "@/utils/landing";
import type { LineCounts } from "@/utils/pr-diff";
import { el } from "./dom";
import { type FilesPage, findDiffstat } from "./files-page";
import { markSection, SECTION_CATALOG, sectionIcon } from "./section-catalog";
import type { LandingView } from "./visit";

/** Which view the header counter shows. One per tab, so the choice carries to the next page. */
export interface DiffstatChoice {
  view: "breakout" | "total";
}

const count = (lines: number) => lines.toLocaleString("en-US");

/** `+added` and `−removed` in the diffstat colors, muting a side that changed nothing. */
function counts(doc: Document, { added, removed }: LineCounts): HTMLElement[] {
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

function tip(doc: Document, ...children: Node[]): HTMLElement {
  const node = el(doc, "span", "gh-prism-tip", ...children);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function pill(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const label = SECTION_CATALOG[section].label;
  const node = el(
    doc,
    "span",
    "gh-prism-pill",
    sectionIcon(doc, section),
    ...counts(doc, lines),
    el(
      doc,
      "span",
      "sr-only",
      `${label}: ${count(lines.added)} added, ${count(lines.removed)} removed.`,
    ),
    tip(
      doc,
      el(doc, "strong", "", label),
      el(doc, "span", "", SECTION_CATALOG[section].description),
    ),
  );
  markSection(node, section);
  return node;
}

function tipRow(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const row = el(
    doc,
    "span",
    "gh-prism-tip-row",
    sectionIcon(doc, section),
    el(doc, "span", "", SECTION_CATALOG[section].label),
    ...counts(doc, lines),
  );
  markSection(row, section);
  return row;
}

/**
 * Stands in for GitHub's lines-changed counter, `native`, until `signal` aborts: a pill per section
 * with the lines `landing` places there, or GitHub's total, as `choice` says. A click switches
 * view and records it in `choice`. GitHub's counter stays in the page, hidden by the stylesheet
 * while this sits just before it.
 */
function showCounter(
  native: Element,
  landing: Landing,
  { choice, signal }: { choice: DiffstatChoice; signal: AbortSignal },
): void {
  const doc = native.ownerDocument;
  const sections = totalsOf(landing);
  const pills = sections.map((lines) => pill(doc, lines));
  const breakout = tip(doc, ...sections.map((lines) => tipRow(doc, lines)));
  const button = el(doc, "button", "gh-prism-diffstat");
  button.type = "button";
  const render = () => {
    button.dataset.view = choice.view;
    button.replaceChildren(
      ...(choice.view === "breakout" ? pills : [native.cloneNode(true), breakout]),
    );
  };
  button.addEventListener("click", () => {
    choice.view = choice.view === "breakout" ? "total" : "breakout";
    render();
  });
  render();
  native.before(button);
  signal.addEventListener("abort", () => button.remove());
}

/**
 * Once intent lands, stands in for the header's lines-changed counter as `choice` says, until
 * `signal` aborts. A path-only landing leaves GitHub's counter as is.
 */
export function showDiffstat(
  page: FilesPage,
  { choice, signal }: { choice: DiffstatChoice; signal: AbortSignal },
): LandingView {
  return {
    landed(result) {
      const native = result.ok && findDiffstat(page);
      if (native) showCounter(native, landingOf(result), { choice, signal });
    },
  };
}
