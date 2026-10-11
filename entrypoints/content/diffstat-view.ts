/**
 * Breaks the pull request header's lines-changed counter out by section: a pill per section with
 * the lines it adds and removes. A click switches between that breakout and GitHub's own total.
 */

import type { LineCounts } from "@/utils/pr-diff";
import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import { el } from "./dom";
import type { FileLines, Placement } from "./intent";
import { sectionIcon } from "./section-icons";

/** Which view the header counter shows. One per tab, so the choice carries to the next page. */
export interface DiffstatChoice {
  view: "breakout" | "total";
}

/** Where a pull request's files landed, and the lines each one adds and removes. */
export interface LandedLines {
  readonly placements: ReadonlyMap<string, Placement>;
  readonly lines: ReadonlyMap<string, FileLines>;
}

interface SectionLines {
  readonly section: SectionKey;
  readonly lines: LineCounts;
}

const ABOUT: Record<SectionKey, string> = {
  implementation: "Code that isn't a test, docs, config, or a lockfile",
  tests: "Test files, and changes inside inline test blocks",
  docs: "Docs files, and changes that only touch comments or docstrings",
  config: "Config files such as TOML, YAML, and JSON, dotfiles, and CI settings",
  generated: "Lockfiles such as Cargo.lock, package-lock.json, and go.sum",
};

const labelOf = (section: SectionKey) =>
  SECTIONS.find(({ key }) => key === section)?.label ?? section;

const count = (lines: number) => lines.toLocaleString("en-US");

const sum = (counts: readonly LineCounts[]): LineCounts =>
  counts.reduce(
    (total, { added, removed }) => ({
      added: total.added + added,
      removed: total.removed + removed,
    }),
    { added: 0, removed: 0 },
  );

/** The sections a file's lines land in: each share of a split file, else its whole section. */
function sharesOf(
  path: string,
  lines: FileLines,
  placement: Placement | undefined,
): readonly SectionLines[] {
  if (placement?.kind === "split") return placement.shares;
  if (lines === "binary") return [];
  return [{ section: placement?.section ?? classify(path), lines }];
}

/** Each section's lines across the whole diff, in `SECTIONS` order, for sections that changed any. */
export function linesBySection({ placements, lines }: LandedLines): SectionLines[] {
  const shares = [...lines].flatMap(([path, fileLines]) =>
    sharesOf(path, fileLines, placements.get(path)),
  );
  const bySection = Map.groupBy(shares, ({ section }) => section);
  return SECTIONS.flatMap(({ key }) => {
    const total = sum((bySection.get(key) ?? []).map(({ lines }) => lines));
    return total.added + total.removed > 0 ? [{ section: key, lines: total }] : [];
  });
}

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
  const label = labelOf(section);
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
    tip(doc, el(doc, "strong", "", label), el(doc, "span", "", ABOUT[section])),
  );
  node.dataset.section = section;
  return node;
}

function tipRow(doc: Document, { section, lines }: SectionLines): HTMLElement {
  const row = el(
    doc,
    "span",
    "gh-prism-tip-row",
    sectionIcon(doc, section),
    el(doc, "span", "", labelOf(section)),
    ...counts(doc, lines),
  );
  row.dataset.section = section;
  return row;
}

/**
 * Stands in for GitHub's lines-changed counter, `native`, until `signal` aborts: a pill per section
 * with the lines `landed` places there, or GitHub's total, as `choice` says. A click switches
 * view and records it in `choice`. GitHub's counter stays in the page, hidden by the stylesheet
 * while this sits just before it.
 */
export function showDiffstat(
  native: Element,
  landed: LandedLines,
  { choice, signal }: { choice: DiffstatChoice; signal: AbortSignal },
): void {
  const doc = native.ownerDocument;
  const sections = linesBySection(landed);
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
