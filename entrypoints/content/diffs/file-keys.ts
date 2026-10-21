/**
 * Steps through the files with `j` and `k` in the order the sidebar lists them, which the diffs
 * follow, from the file the URL's hash names. CSS `order` leaves the diffs in GitHub's DOM order,
 * so a stepper that walks the DOM, such as Refined GitHub's, jumps around the page; this one takes
 * the keys first.
 */

import { type FilesPage, reorderable } from "../files-page";
import type { LandingView } from "../visit/land";
import { revealDiff } from "./reveal";

const STEPS: ReadonlyMap<string, number> = new Map([
  ["j", 1],
  ["k", -1],
]);

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select"));

/**
 * The link `step` files on from the one `hash` names, or the first link when it names none;
 * `undefined` past either end.
 */
function neighbor(
  links: readonly HTMLAnchorElement[],
  hash: string,
  step: number,
): HTMLAnchorElement | undefined {
  const at = links.findIndex((link) => link.getAttribute("href") === hash);
  return links[at < 0 ? 0 : at + step];
}

/**
 * Has `j` and `k` reveal the next and previous file in the sidebar's order while `page`'s diffs
 * follow it, until `signal` aborts.
 */
export function followFileKeys(page: FilesPage, signal: AbortSignal): LandingView {
  const doc = page.diffs.ownerDocument;
  let links: readonly HTMLAnchorElement[] = [];
  const onKey = (event: KeyboardEvent) => {
    const step = STEPS.get(event.key);
    if (!step || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
    if (links.length === 0 || !reorderable(page)) return;
    // Cancelling the keydown also cancels its keypress, where Refined GitHub listens.
    event.preventDefault();
    event.stopPropagation();
    const next = neighbor(links, doc.location.hash, step);
    if (next) revealDiff(page, next, { signal });
  };

  doc.addEventListener("keydown", onKey, { capture: true, signal });

  return {
    sections(sections) {
      // A file split across sections takes its first one's place, as its diff does.
      links = [...new Set(sections.flatMap(({ entries }) => entries.map(({ file }) => file.link)))];
    },
  };
}
