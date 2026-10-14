/**
 * Breaks the header's lines-changed counter, on a pull request or a commit, out by section once
 * intent lands: a pill per section with the lines it adds and removes. A click switches between
 * that breakout and GitHub's own total.
 */

import { type Landing, landingOf, type SectionLines, totalsOf } from "@/utils/intent/landing";
import { type FilesPage, findDiffstat } from "../files-page";
import { el } from "../ui/dom";
import { count, counts } from "../ui/line-counts";
import { markSection, SECTION_CATALOG, sectionIcon } from "../ui/section-catalog";
import type { LandingView } from "../visit/land";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./diffstat-view.css?inline";

/** Which view the header counter shows. One per tab, so the choice carries to the next page. */
export interface DiffstatChoice {
  view: "breakout" | "total";
}

function tip(doc: Document, ...children: Node[]): HTMLElement {
  const node = el(
    doc,
    "span",
    "gh-prism-tip tw:absolute tw:top-[calc(100%+6px)] tw:right-0 tw:z-100 tw:grid tw:gap-1 tw:w-max tw:max-w-[260px] tw:py-1.5 tw:px-2 tw:border tw:border-border-default tw:rounded-medium tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:font-normal tw:leading-body-small tw:text-start tw:whitespace-normal",
    ...children,
  );
  node.setAttribute("aria-hidden", "true");
  return node;
}

function pill(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const { label, description } = SECTION_CATALOG[section];
  const spoken = `${label}: ${count(lines.added)} added, ${count(lines.removed)} removed.`;
  const node = el(
    doc,
    "span",
    "gh-prism-pill tw:relative tw:inline-flex tw:items-center tw:gap-1 tw:pr-2 tw:pl-1.5 tw:rounded-medium tw:bg-hue-tint tw:leading-5",
    sectionIcon(doc, section),
    ...counts(doc, lines),
    el(doc, "span", "sr-only", spoken),
    tip(doc, el(doc, "strong", "", label), el(doc, "span", "", description)),
  );
  markSection(node, section);
  return node;
}

function tipRow(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const row = el(
    doc,
    "span",
    "gh-prism-tip-row tw:flex tw:items-center tw:gap-1",
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

  const button = el(
    doc,
    "button",
    "gh-prism-diffstat tw:relative tw:flex tw:items-center tw:gap-1 tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-default tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-focus-outline",
  );
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

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  native.before(button);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    button.remove();
    style.remove();
  });
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
