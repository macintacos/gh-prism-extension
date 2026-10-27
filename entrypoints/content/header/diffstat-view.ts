/**
 * Breaks the header's lines-changed counter, on a pull request or a commit, out by section once
 * intent lands: a pill per section with the lines it adds and removes. A click switches between
 * that breakout and GitHub's own total.
 */

import { type Landing, landingOf, type SectionLines, sum, totalsOf } from "@/utils/intent/landing";
import type { DiffstatView } from "@/utils/prefs";
import { type FilesPage, findDiffstat, observeDiffstat } from "../files-page";
import { el } from "../ui/dom";
import { count, counts } from "../ui/line-counts";
import { markSection, SECTION_CATALOG, sectionIcon } from "../ui/section-catalog";
import type { LandingView } from "../visit/land";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./diffstat-view.css?inline";

/** Which view the header counter shows. One per tab, so the choice carries to the next page. */
export interface DiffstatChoice {
  view: DiffstatView;
}

/** The tab's view choice for `showDiffstat` to apply, and how to persist a switch. */
export interface DiffstatOptions {
  readonly choice: DiffstatChoice;
  /** Remembers a view the counter switched to. */
  readonly save: (view: DiffstatView) => void;
}

const TIP =
  "gh-prism-tip tw:absolute tw:top-[calc(100%+6px)] tw:right-0 tw:z-100 tw:w-max tw:border tw:border-border-default tw:rounded-medium tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:font-normal tw:leading-body-small tw:text-start tw:whitespace-normal";

/** A tooltip laid out by the `layout` classes, hidden from screen readers. */
function tip(doc: Document, layout: string, ...children: Node[]): HTMLElement {
  const node = el(doc, "span", `${TIP} ${layout}`, ...children);
  node.setAttribute("aria-hidden", "true");
  return node;
}

function pill(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const { label, description } = SECTION_CATALOG[section];
  const spoken = `${label}: ${count(lines.added)} added, ${count(lines.removed)} removed.`;
  const node = el(
    doc,
    "span",
    "gh-prism-pill tw:relative tw:inline-flex tw:items-center tw:gap-1 tw:not-first:ps-2 tw:not-last:pe-2 tw:leading-5",
    sectionIcon(doc, section),
    ...counts(doc, lines),
    el(doc, "span", "sr-only", spoken),
    tip(
      doc,
      "tw:grid tw:gap-1 tw:max-w-[260px] tw:py-1.5 tw:px-2",
      el(doc, "strong", "", label),
      el(doc, "span", "tw:text-fg-muted", description),
    ),
  );
  markSection(node, section);
  return node;
}

function tipRow(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const row = el(
    doc,
    "span",
    "gh-prism-tip-row tw:col-span-full tw:grid tw:grid-cols-subgrid tw:items-center",
    sectionIcon(doc, section),
    el(doc, "span", "tw:pe-6", SECTION_CATALOG[section].label),
    ...counts(doc, lines),
  );
  markSection(row, section);
  return row;
}

/**
 * The total view's tooltip: a row per section, ruled off above their sum, then what a click does.
 * The rows share one grid, so their counts line up in columns.
 */
function breakdown(doc: Document, sections: readonly SectionLines[]): HTMLElement {
  const total = el(
    doc,
    "span",
    "gh-prism-tip-total tw:col-span-full tw:grid tw:grid-cols-subgrid tw:items-center tw:mt-1 tw:pt-2 tw:border-t tw:border-border-muted tw:font-semibold",
    el(doc, "span", "tw:col-start-2 tw:pe-6", "Total"),
    ...counts(doc, sum(sections.map(({ lines }) => lines))),
  );

  return tip(
    doc,
    "tw:grid tw:grid-cols-[auto_1fr_auto_auto] tw:gap-x-2 tw:gap-y-1 tw:min-w-48 tw:py-2 tw:px-3 tw:tabular-nums",
    ...sections.map((lines) => tipRow(doc, lines)),
    total,
    el(doc, "span", "tw:col-span-full tw:mt-1 tw:text-fg-muted", "Click to split by section"),
  );
}

/**
 * Stands in for `page`'s lines-changed counter until `signal` aborts: a pill per section with the
 * lines `landing` places there, or GitHub's total, as `choice` says. A click switches view,
 * records it in `choice`, and `save`s it. GitHub's counter stays in the page, hidden by the
 * stylesheet while this sits just before it. A pull request's counter can mount long after intent
 * lands, and GitHub can swap it for a skeleton again, so this follows it, stepping aside while
 * there is none.
 */
function showCounter(
  page: FilesPage,
  landing: Landing,
  { choice, save, signal }: DiffstatOptions & { readonly signal: AbortSignal },
): void {
  const doc = page.sidebar.ownerDocument;
  const sections = totalsOf(landing);
  const pills = sections.map((lines) => pill(doc, lines));
  const breakout = breakdown(doc, sections);

  const button = el(
    doc,
    "button",
    "gh-prism-diffstat tw:relative tw:flex tw:items-center tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-default tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-focus-outline",
  );
  button.type = "button";
  let native: Element | undefined;
  const render = (counter: Element) => {
    button.dataset.view = choice.view;
    button.replaceChildren(
      ...(choice.view === "breakout" ? pills : [counter.cloneNode(true), breakout]),
    );
  };
  button.addEventListener("click", () => {
    choice.view = choice.view === "breakout" ? "total" : "breakout";
    save(choice.view);
    if (native) render(native);
  });

  const follow = () => {
    native = findDiffstat(page);
    if (!native) button.remove();
    else if (button.nextElementSibling !== native) {
      native.before(button);
      render(native);
    }
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  follow();
  doc.head.append(style);
  observeDiffstat(page, follow, { signal });
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
  { choice, save, signal }: DiffstatOptions & { readonly signal: AbortSignal },
): LandingView {
  return {
    landed(result) {
      if (result.ok) showCounter(page, landingOf(result), { choice, save, signal });
    },
  };
}
