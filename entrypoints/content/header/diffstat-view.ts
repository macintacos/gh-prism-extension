/**
 * Breaks the header's lines-changed counter out by section once intent lands, on a commit's page
 * or any of a pull request's tabs, and each file header's counts on a Files view: a pill per
 * section with the lines it adds and removes. A click on any of them switches them all between
 * that breakout and GitHub's own totals.
 */

import { type Landing, landingOf, type SectionLines, sum, totalsOf } from "@/utils/intent/landing";
import type { DiffstatView } from "@/utils/prefs";
import {
  anchorOf,
  type FilesPage,
  fileCountsOf,
  findDiffstat,
  findFileDiffstat,
  type Header,
  mountedDiffs,
  observeDiffs,
  observeDiffstat,
  readChangedFiles,
} from "../files-page";
import { el } from "../ui/dom";
import { count, counts } from "../ui/line-counts";
import { prismMark } from "../ui/mark";
import { place } from "../ui/place";
import { markSection, SECTION_CATALOG, sectionIcon } from "../ui/section-catalog";
import type { LandingView } from "../visit/land";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./diffstat-view.css?inline";

/**
 * Which view every diffstat on the page shows, and the breakout it last showed for a pull request's
 * whole diff. One per browser tab, shared by every page in it, so a switch carries to the next page,
 * and the next page of that pull request shows its breakout until its own intent lands.
 */
export interface DiffstatChoice {
  view: DiffstatView;
  held?: { readonly pr: string; readonly landing: Landing };
}

/** The browser tab's view choice for `showDiffstat` to apply, and how to persist a switch. */
export interface DiffstatOptions {
  readonly choice: DiffstatChoice;
  /** Remembers a view the page's diffstats switched to. */
  readonly save: (view: DiffstatView) => void;
  /**
   * The pull request whose whole diff the page breaks out, as `prKeyOf` names it; `undefined` on
   * a commit or a commit filter.
   */
  readonly pr?: string;
}

/** `showDiffstat`'s options for one landing: the tab's choice, and when to give the page back. */
type CountersOptions = DiffstatOptions & {
  readonly files?: FilesPage;
  readonly signal: AbortSignal;
};

/** Where an in-flow tooltip sits: under its owner, at its end. */
const IN_FLOW = "tw:absolute tw:top-[calc(100%+6px)] tw:right-0";

const TIP_GAP = 6;

const TIP = `gh-prism-tip ${IN_FLOW} tw:z-100 tw:w-max tw:rounded-medium tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:font-normal tw:leading-body-small tw:text-start tw:whitespace-normal`;

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
      el(
        doc,
        "span",
        "tw:flex tw:items-center tw:justify-between tw:gap-2",
        el(doc, "strong", "", label),
        prismMark(doc),
      ),
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
    el(
      doc,
      "span",
      "tw:col-span-full tw:flex tw:items-center tw:justify-between tw:gap-2 tw:mt-1",
      el(doc, "span", "tw:text-fg-muted", "Click to split by section"),
      prismMark(doc),
    ),
  );
}

/** What every stand-in on a page shares: the view, the switch, and the redraws it calls. */
interface Counters {
  readonly choice: DiffstatChoice;
  /** Flips `choice.view`, saves it, and redraws every stand-in in `renders`. */
  readonly toggle: () => void;
  /** Every mounted stand-in's redraw: each adds its own as it mounts, and removes it once dropped. */
  readonly renders: Set<() => void>;
  readonly signal: AbortSignal;
}

interface StandIn {
  readonly button: HTMLButtonElement;
  readonly render: () => void;
}

/**
 * A button standing in for one counter: `sections`' pills, or `total()`'s copy of GitHub's counts
 * and the breakdown. Empty until `render` draws the current view.
 */
function standIn(
  doc: Document,
  sections: readonly SectionLines[],
  total: () => Node[],
  { choice, toggle }: Pick<Counters, "choice" | "toggle">,
): StandIn {
  const pills = sections.map((lines) => pill(doc, lines));
  const breakout = breakdown(doc, sections);

  const button = el(
    doc,
    "button",
    "gh-prism-diffstat tw:relative tw:flex tw:items-center tw:p-0 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-default tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-focus-outline",
  );
  button.type = "button";
  button.addEventListener("click", toggle);

  const render = () => {
    button.dataset.view = choice.view;
    button.replaceChildren(...(choice.view === "breakout" ? pills : [...total(), breakout]));
  };
  return { button, render };
}

/**
 * Stands in for `header`'s lines-changed counter just before it, which the stylesheet hides. A pull
 * request's counter can mount long after intent lands, and GitHub can swap it for a skeleton
 * again, so this follows it, stepping aside while there is none.
 */
function followHeader(header: Header, sections: readonly SectionLines[], counters: Counters): void {
  let native: Element | undefined;
  const { button, render } = standIn(
    header.doc,
    sections,
    () => (native ? [native.cloneNode(true)] : []),
    counters,
  );
  counters.renders.add(render);

  const follow = () => {
    native = findDiffstat(header);
    if (!native) button.remove();
    else if (button.nextElementSibling !== native) {
      native.before(button);
      render();
    }
  };

  follow();
  observeDiffstat(header, follow, { signal: counters.signal });
  counters.signal.addEventListener("abort", () => button.remove());
}

/**
 * Paths of the files the native tree lists, by diff anchor. Read from the tree, not `land`'s
 * sections, which don't arrive while intent is pending; a file whose row the tree has dropped
 * (filtered, or in a collapsed directory) keeps GitHub's counts.
 */
const treePathsByAnchor = (files: FilesPage): Map<string, string> =>
  new Map(
    readChangedFiles(files.sidebar).flatMap(({ link, path }) => {
      const anchor = anchorOf(link);
      return anchor ? [[anchor, path] as const] : [];
    }),
  );

/**
 * Stands in for each mounted file header's counts with that file's own breakout, first in the
 * counts row so the stylesheet hides GitHub's count spans after it; a file with no counted lines
 * keeps GitHub's. Follows diffs as they mount, and rows GitHub re-renders.
 */
function followFileHeaders(files: FilesPage, landing: Landing, counters: Counters): void {
  const doc = files.diffs.ownerDocument;
  const shown = new Map<Element, StandIn>();

  const drop = (row: Element, { button, render }: StandIn) => {
    button.remove();
    counters.renders.delete(render);
    shown.delete(row);
  };
  const standInFor = (row: Element, sections: readonly SectionLines[]) => {
    const total = () => fileCountsOf(row).map((span) => span.cloneNode(true));
    const counter = standIn(doc, sections, total, counters);
    counter.button.classList.add("gh-prism-file-diffstat", "tw:data-[view=total]:gap-1");
    row.prepend(counter.button);
    counter.render();
    counters.renders.add(counter.render);
    shown.set(row, counter);
  };

  /** Stands in again for `region`'s counts row unless its stand-in is still first in it. */
  const followRow = (region: Element, pathOf: () => string | undefined) => {
    const row = findFileDiffstat(region);
    const old = row && shown.get(row);
    if (!row || row.firstElementChild === old?.button) return;
    const path = pathOf();
    if (path === undefined) return;
    if (old) drop(row, old);
    const sections = totalsOf(landing, [path]);
    if (sections.length > 0) standInFor(row, sections);
  };

  const follow = () => {
    for (const [row, counter] of shown) if (!row.isConnected) drop(row, counter);

    let paths: Map<string, string> | undefined;
    const pathOf = (anchor: string) => {
      paths ??= treePathsByAnchor(files);
      return paths.get(anchor);
    };
    for (const [anchor, region] of mountedDiffs(files)) followRow(region, () => pathOf(anchor));
  };

  follow();
  observeDiffs(files.diffs, follow, { signal: counters.signal });
  followFileTips(files.diffs, counters.signal);
  counters.signal.addEventListener("abort", () => {
    for (const [row, counter] of shown) drop(row, counter);
  });
}

/** What shows a file stand-in's tooltip: a pill in its breakout, or the whole button in total. */
const FILE_TIP_OWNER =
  ".gh-prism-file-diffstat[data-view='breakout'] > .gh-prism-pill, .gh-prism-file-diffstat[data-view='total']";

/**
 * Shows the file stand-ins' tooltips under `diffs` in the top layer, since a file's region clips
 * whatever leaves its box: one popover, holding a copy of the hovered pill's tip, or the total
 * view's breakdown while hovered or focused. It goes once `signal` aborts.
 */
function followFileTips(diffs: Element, signal: AbortSignal): void {
  const doc = diffs.ownerDocument;
  const popover = el(doc, "div", "");
  popover.setAttribute("popover", "manual");
  // The pills' words already say what it shows.
  popover.setAttribute("aria-hidden", "true");
  doc.body.append(popover);

  let open = false;
  const hide = () => {
    if (open) popover.hidePopover();
    open = false;
  };
  const show = (owner: Element) => {
    const source = owner.querySelector(":scope > .gh-prism-tip");
    if (!source) return hide();
    popover.className = source.className;
    popover.classList.remove(...IN_FLOW.split(" "));
    popover.replaceChildren(...[...source.childNodes].map((node) => node.cloneNode(true)));
    hide();
    popover.showPopover();
    open = true;
    const { left, top, width, height } = owner.getBoundingClientRect();
    place(popover, new DOMRect(left, top - TIP_GAP, width, height + 2 * TIP_GAP));
  };
  const ownerAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest(FILE_TIP_OWNER) : null;

  const options = { signal };
  diffs.addEventListener(
    "pointerover",
    ({ target }) => {
      const owner = ownerAt(target);
      if (owner) show(owner);
    },
    options,
  );
  diffs.addEventListener(
    "pointerout",
    (event) => {
      const owner = ownerAt(event.target);
      const entered = event instanceof MouseEvent ? event.relatedTarget : null;
      if (owner && !(entered instanceof Node && owner.contains(entered))) hide();
    },
    options,
  );
  diffs.addEventListener(
    "focusin",
    ({ target }) => {
      const owner = ownerAt(target);
      if (owner?.matches(".gh-prism-file-diffstat")) show(owner);
    },
    options,
  );
  diffs.addEventListener("focusout", hide, options);
  // A click switches the view, so the tip it showed no longer matches the button.
  diffs.addEventListener("click", hide, options);
  signal.addEventListener("abort", () => {
    hide();
    popover.remove();
  });
}

/**
 * Stands in for the header's lines-changed counter, and each of `files`' file headers' counts, until
 * `signal` aborts: a pill per section with the lines `landing` places there, or GitHub's total, as
 * `choice` says. A click on any of them switches them all, records the view in `choice`, and
 * `save`s it.
 */
function showCounters(
  header: Header,
  landing: Landing,
  { choice, save, files, signal }: CountersOptions,
): void {
  const renders = new Set<() => void>();
  const toggle = () => {
    choice.view = choice.view === "breakout" ? "total" : "breakout";
    save(choice.view);
    for (const render of renders) render();
  };
  const counters: Counters = { choice, toggle, renders, signal };

  const style = Object.assign(header.doc.createElement("style"), { textContent: css });
  followHeader(header, totalsOf(landing), counters);
  header.doc.head.append(style);
  if (files) followFileHeaders(files, landing, counters);
  signal.addEventListener("abort", () => style.remove());
}

/**
 * Stands in for the header's lines-changed counter, and each of `files`' file headers' counts, as
 * `choice` says, until `signal` aborts: while intent is pending, with the breakout `choice` holds
 * for `pr`, if any; once it lands, with its own, which `choice` then holds for `pr`. A path-only
 * landing leaves GitHub's counters as they are.
 */
export function showDiffstat(
  header: Header,
  { choice, save, pr, files, signal }: CountersOptions,
): Required<Pick<LandingView, "pending" | "landed">> {
  let shown = new AbortController();
  const show = (landing: Landing | undefined) => {
    shown.abort();
    shown = new AbortController();
    const until = AbortSignal.any([signal, shown.signal]);
    if (landing) showCounters(header, landing, { choice, save, files, signal: until });
  };

  return {
    pending() {
      if (pr !== undefined && choice.held?.pr === pr) show(choice.held.landing);
    },
    landed(result) {
      const landing = result.ok ? landingOf(result) : undefined;
      if (pr !== undefined) choice.held = landing && { pr, landing };
      show(landing);
    },
  };
}
