/**
 * Measures how far each side of an unwrapped diff runs past its cell, and follows each file's
 * sideways scroll, as the custom properties `wrap-lines.css` shifts the text by.
 */

import {
  codeLines,
  type DiffTable,
  diffTables,
  type FilesPage,
  fileBox,
  isFileBox,
  observeDiffs,
} from "../files-page";

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

const REACH_PROPS = ["--gh-prism-reach-old", "--gh-prism-reach-new", "--gh-prism-reach"] as const;

/**
 * Until `signal` aborts, writes each file's scroll offset and each side's reach on its table's
 * box, the one that scrolls sideways; on abort, removes every property written.
 */
export function followSideScroll(page: Pick<FilesPage, "diffs">, signal: AbortSignal): void {
  const filesByTable = new Map<Element, { box: HTMLElement; diff: DiffTable }>();

  // Every entry is measured before any is written, so one batch costs one layout.
  const resizes = new ResizeObserver((entries) => {
    const measured = entries.flatMap(({ target }) => {
      const file = filesByTable.get(target);
      return file && target.isConnected
        ? [{ box: file.box, reach: sideReach(extentsOf(file.diff)) }]
        : [];
    });
    for (const { box, reach } of measured) writeReach(box, reach);
  });
  const observeTables = () => {
    const liveTables = new Map<Element, DiffTable>(
      diffTables(page.diffs).map((diff) => [diff.table, diff]),
    );
    for (const table of filesByTable.keys())
      if (!liveTables.has(table)) {
        resizes.unobserve(table);
        filesByTable.delete(table);
      }
    for (const diff of liveTables.values()) {
      const { table } = diff;
      const box = fileBox(table);
      if (filesByTable.has(table) || !box) continue;
      resizes.observe(table);
      filesByTable.set(table, { box, diff });
    }
  };

  const onScroll = ({ target }: Event) => {
    if (!(target instanceof HTMLElement) || !isFileBox(target)) return;
    target.style.setProperty("--gh-prism-x", `${target.scrollLeft}px`);
  };
  page.diffs.addEventListener("scroll", onScroll, { capture: true, passive: true, signal });

  observeDiffs(page.diffs, observeTables, { signal });
  observeTables();

  signal.addEventListener("abort", () => {
    resizes.disconnect();
    for (const { box } of filesByTable.values()) clearProps(box);
  });
}

/** Each line's extent in `diff`, from layout values the shift's transform leaves alone. */
function* extentsOf(diff: DiffTable): Generator<LineExtent> {
  for (const { inner, cell, side } of codeLines(diff))
    yield { side, end: inner.offsetLeft + inner.offsetWidth, room: cell.clientWidth };
}

function writeReach(box: HTMLElement, reach: Reach): void {
  const [oldProp, newProp, widestProp] = REACH_PROPS;
  box.style.setProperty(oldProp, `${reach.old}px`);
  box.style.setProperty(newProp, `${reach.new}px`);
  box.style.setProperty(widestProp, `${Math.max(reach.old, reach.new)}px`);
}

function clearProps(box: HTMLElement): void {
  for (const prop of ["--gh-prism-x", ...REACH_PROPS]) box.style.removeProperty(prop);
  if (box.getAttribute("style") === "") box.removeAttribute("style");
}
