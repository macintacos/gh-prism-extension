/**
 * Measures how far each side of an unwrapped diff runs past its cell, and follows each file's
 * sideways scroll, as the custom properties `wrap-lines.css` shifts the text by.
 */

import { diffTables, type FilesPage, observeDiffs } from "../files-page";

/** How far each side's widest line runs past its cell, in px. */
export interface Reach {
  readonly old: number;
  readonly new: number;
}

/** One line's layout: where its text ends and how wide its cell is, both from the cell's left. */
export interface LineExtent {
  readonly side: keyof Reach;
  readonly end: number;
  readonly room: number;
}

/** Each side's largest overflow among `lines`, 0 for a side whose lines all fit. */
export function sideReach(lines: Iterable<LineExtent>): Reach {
  const reach = { old: 0, new: 0 };
  for (const { side, end, room } of lines) reach[side] = Math.max(reach[side], end - room);
  return reach;
}

const PROPS = ["--gh-prism-x", "--gh-prism-reach-old", "--gh-prism-reach-new", "--gh-prism-reach"];

/**
 * Until `signal` aborts, writes each file's scroll offset and each side's reach on its table's
 * parent, the box that scrolls sideways; on abort, removes every property written.
 */
export function followSideScroll(page: FilesPage, signal: AbortSignal): void {
  const boxes = new Set<HTMLElement>();
  const boxOf = (table: Element) => {
    const box = table.parentElement as HTMLElement;
    boxes.add(box);
    return box;
  };

  const resizes = new ResizeObserver((entries) => {
    for (const { target } of entries) writeReach(boxOf(target), sideReach(extentsOf(target)));
  });
  const observed = new Set<Element>();
  const observeTables = () => {
    const tables = new Set(diffTables(page.diffs).map(({ table }) => table));
    for (const table of observed)
      if (!tables.has(table as HTMLTableElement)) {
        resizes.unobserve(table);
        observed.delete(table);
      }
    for (const table of tables)
      if (!observed.has(table)) {
        resizes.observe(table);
        observed.add(table);
      }
  };

  const onScroll = ({ target }: Event) => {
    if (!(target instanceof HTMLElement)) return;
    if (!target.querySelector(":scope > table[data-diff-anchor]")) return;
    boxes.add(target);
    target.style.setProperty("--gh-prism-x", `${target.scrollLeft}px`);
  };
  page.diffs.addEventListener("scroll", onScroll, { capture: true, passive: true });

  observeDiffs(page.diffs, observeTables, { signal });
  observeTables();

  signal.addEventListener("abort", () => {
    resizes.disconnect();
    page.diffs.removeEventListener("scroll", onScroll, { capture: true });
    for (const box of boxes) for (const prop of PROPS) box.style.removeProperty(prop);
    for (const box of boxes) if (box.getAttribute("style") === "") box.removeAttribute("style");
  });
}

/**
 * Each line's extent in `table`, from layout values the shift's transform leaves alone. A
 * `td` is its line's offset parent.
 */
function* extentsOf(table: Element): Generator<LineExtent> {
  for (const inner of table.querySelectorAll<HTMLElement>("td.diff-text-cell .diff-text-inner")) {
    const cell = inner.closest("td") as HTMLElement;
    yield {
      side: cell.classList.contains("left-side-diff-cell") ? "old" : "new",
      end: inner.offsetLeft + inner.offsetWidth,
      room: cell.clientWidth,
    };
  }
}

function writeReach(box: HTMLElement, reach: Reach): void {
  box.style.setProperty("--gh-prism-reach-old", `${reach.old}px`);
  box.style.setProperty("--gh-prism-reach-new", `${reach.new}px`);
  box.style.setProperty("--gh-prism-reach", `${Math.max(reach.old, reach.new)}px`);
}
