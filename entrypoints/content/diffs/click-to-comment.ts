/**
 * The "Click anywhere on a line to comment" item in gh-prism's diff settings group: while it is
 * checked, a press or drag on a diff line opens GitHub's own comment box for the line or range,
 * by replaying presses on GitHub's own controls.
 */

import {
  addCommentButton,
  columnSlots,
  type DiffLine,
  diffLineAt,
  type FilesPage,
  isLineAnchor,
  lineNumberCellOf,
} from "../files-page";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./click-to-comment.css?inline";
import type { MenuGate, PrismMenuItem } from "./prism-menu";

/** Whether click to comment is on. One per tab, so the choice carries to the next page. */
export interface ClickToCommentChoice {
  on: boolean;
}

/** The tab's click-to-comment choice for `clickToCommentItem` to apply, and how to persist a flip. */
export interface ClickToCommentOptions {
  readonly choice: ClickToCommentChoice;
  /** Remembers the choice the item flipped to. */
  readonly save: (on: boolean) => void;
}

/**
 * The click-to-comment item, which turns presses on `page`'s diff lines into GitHub comment boxes
 * while it is checked, its group's gate is open, and GitHub's controls have answered, until
 * `signal` aborts.
 */
export function clickToCommentItem(
  page: Pick<FilesPage, "diffs">,
  signal: AbortSignal,
  { choice, save }: ClickToCommentOptions,
): PrismMenuItem {
  const doc = page.diffs.ownerDocument;
  let gate: MenuGate = "closed";
  let gaveUp = false;

  let active: AbortController | undefined;
  const apply = () => {
    if (gate === "open" && choice.on && !gaveUp) {
      if (active) return;
      active = new AbortController();
      const whileActive = AbortSignal.any([signal, active.signal]);
      const style = Object.assign(doc.createElement("style"), { textContent: css });
      doc.head.append(style);
      doc.documentElement.dataset.ghPrismClickComment = "";
      whileActive.addEventListener("abort", () => {
        style.remove();
        delete doc.documentElement.dataset.ghPrismClickComment;
      });
      page.diffs.addEventListener(
        "pointerdown",
        (event) => {
          if (event instanceof PointerEvent) onPress(doc, event, whileActive, giveUp);
        },
        { signal: whileActive },
      );
    } else {
      active?.abort();
      active = undefined;
    }
  };
  const giveUp = () => {
    if (gaveUp) return;
    gaveUp = true;
    console.warn(
      "gh-prism: GitHub's comment controls are missing, so click to comment is off on this page",
    );
    apply();
  };

  return {
    id: "gh-prism-click-to-comment",
    text: "Click anywhere on a line to comment",
    subtitle: "Hold Shift to select text",
    checked: () => choice.on,
    pick: () => {
      choice.on = !choice.on;
      save(choice.on);
      apply();
    },
    follow: (next) => {
      gate = next;
      apply();
    },
  };
}

/** Starts a drag for a plain left mouse press on a commentable line; leaves every other press to GitHub. */
function onPress(doc: Document, event: PointerEvent, active: AbortSignal, giveUp: () => void) {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const line = diffLineAt(event.target);
  if (!line) return;

  // Starts a fresh selection at the press, even with text selected elsewhere.
  if (event.shiftKey) {
    const at = doc.caretPositionFromPoint(event.clientX, event.clientY);
    if (at) doc.getSelection()?.collapse(at.offsetNode, at.offset);
    return;
  }

  if (!addCommentButton(line)) return;
  // Cancelling `pointerdown` suppresses the compatibility `mousedown`, so GitHub starts no cell selection of its own.
  event.preventDefault();
  drag(doc, line, event.pointerId, active, (first, last) => {
    void openCommentBox(doc, first, last).then((opened) => {
      if (!opened) giveUp();
    });
  });
}

const RANGE_ATTR = "data-gh-prism-comment-range";

/**
 * Follows one drag by pointer `pointerId` from `start` until release, marking the range; `release`
 * gets its lines in row order.
 */
function drag(
  doc: Document,
  start: DiffLine,
  pointerId: number,
  active: AbortSignal,
  release: (first: DiffLine, last: DiffLine) => void,
) {
  const dragging = new AbortController();
  const whileDragging = AbortSignal.any([active, dragging.signal]);
  // Captured so a release over a review thread, whose React root stops propagation, still lands.
  const options = { signal: whileDragging, capture: true };
  const ours = (event: Event) => event instanceof PointerEvent && event.pointerId === pointerId;
  let end = start;
  let marked: readonly DiffLine[] = [start];
  start.cell.setAttribute(RANGE_ATTR, "");
  whileDragging.addEventListener("abort", () => {
    for (const line of marked) line.cell.removeAttribute(RANGE_ATTR);
  });

  let lastRow: HTMLTableRowElement | undefined;
  const follow = (y: number) => {
    const row = rowUnder(doc, start, y);
    if (!row || row === lastRow) return;
    lastRow = row;
    const slots = columnSlots(start.table, start.row, row, start.cell.cellIndex);
    const endAt = rangeEnd(slots);
    const slot = slots[endAt];
    if (!slot || typeof slot === "string" || slot === end) return;
    end = slot;
    for (const line of marked) line.cell.removeAttribute(RANGE_ATTR);
    marked = slots.slice(0, endAt + 1).filter((s): s is DiffLine => typeof s !== "string");
    for (const line of marked) line.cell.setAttribute(RANGE_ATTR, "");
  };

  // Scrolls while the pointer rests near the window's top or bottom, re-following the rows that
  // scroll under it.
  const win = doc.defaultView;
  let pointerY = 0;
  let frame: number | undefined;
  const scroll = () => {
    frame = undefined;
    const step = win ? edgeStep(pointerY, win.innerHeight) : 0;
    if (!win || step === 0) return;
    win.scrollBy({ top: step, behavior: "instant" });
    follow(pointerY);
    frame = win.requestAnimationFrame(scroll);
  };
  whileDragging.addEventListener("abort", () => {
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
  });

  doc.addEventListener(
    "pointermove",
    (event) => {
      if (!ours(event) || !(event instanceof PointerEvent)) return;
      pointerY = event.clientY;
      follow(pointerY);
      if (frame === undefined) scroll();
    },
    options,
  );
  doc.addEventListener(
    "pointerup",
    (event) => {
      if (!ours(event)) return;
      dragging.abort();
      const forward = start.row.rowIndex <= end.row.rowIndex;
      release(forward ? start : end, forward ? end : start);
    },
    options,
  );
  doc.addEventListener(
    "pointercancel",
    (event) => {
      if (ours(event)) dragging.abort();
    },
    options,
  );
  // Stopped so GitHub's own Escape handling doesn't also run.
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dragging.abort();
    },
    options,
  );
  // Cancelling `pointerdown` doesn't stop text selection in every engine.
  doc.addEventListener("selectstart", (event) => event.preventDefault(), options);
  doc.defaultView?.addEventListener("blur", () => dragging.abort(), options);
}

/** Index in `slots` (0 = the pressed line) where a range from slot 0 may end: the last line before the first "stop". */
export function rangeEnd(slots: readonly (object | "gap" | "stop")[]): number {
  let end = 0;
  for (const [index, slot] of slots.entries()) {
    if (slot === "stop") break;
    if (slot !== "gap") end = index;
  }
  return end;
}

/** How near the window's top or bottom, in px, a drag's pointer scrolls the page. */
const EDGE = 48;
/** The most a drag scrolls per frame, in px, reached with the pointer at the window's edge. */
const MAX_STEP = 24;

/**
 * Pixels to scroll this frame for a drag's pointer at height `y` in a window `height` tall:
 * negative near the top, positive near the bottom, 0 elsewhere.
 */
export function edgeStep(y: number, height: number): number {
  const depth = y < EDGE ? y - EDGE : y > height - EDGE ? y - (height - EDGE) : 0;
  // ponytail: fixed linear speed curve; ease or accelerate it over time if drags overshoot.
  return Math.round((MAX_STEP * Math.max(-EDGE, Math.min(EDGE, depth))) / EDGE);
}

/**
 * The row of `start`'s table under height `y`, read in `start`'s column; past the table's top or
 * bottom, its first or last row; `undefined` elsewhere off the table.
 */
function rowUnder(doc: Document, start: DiffLine, y: number): HTMLTableRowElement | undefined {
  const { left, width } = start.cell.getBoundingClientRect();
  const hit = doc
    .elementsFromPoint(left + width / 2, y)
    .find((el) => el.closest("table") === start.table);
  const row = hit?.closest("tr");
  if (row) return row;

  const { top, bottom } = start.table.getBoundingClientRect();
  const { rows } = start.table;
  if (y < top) return rows[0];
  if (y > bottom) return rows[rows.length - 1];
  return undefined;
}

/**
 * Opens GitHub's comment box for `first` through `last` by pressing their number cells, then
 * hovering `last` and clicking its "+". `false` when one of those controls is missing.
 */
async function openCommentBox(doc: Document, first: DiffLine, last: DiffLine): Promise<boolean> {
  const range = first !== last;
  if (range || isLineAnchor(doc.location.hash.slice(1))) {
    const from = lineNumberCellOf(first);
    if (!from) return false;
    press(from, false);
  }
  if (range) {
    const to = lineNumberCellOf(last);
    if (!to) return false;
    press(to, true);
  }

  // Only a `mouseover` mounts GitHub's "+"; `pointerover` and `mousemove` don't.
  last.cell.dispatchEvent(new MouseEvent("mouseover", mouseInit(last.cell, false)));
  const plus = await mountedPlus(doc, last);
  plus?.click();
  return plus !== undefined;
}

/** Frames to wait for GitHub to mount a hovered line's "+" before giving up. */
const PLUS_FRAMES = 5;

/** `line`'s "+", polled once a frame for up to `PLUS_FRAMES` frames. */
async function mountedPlus(doc: Document, line: DiffLine): Promise<HTMLButtonElement | undefined> {
  for (let i = 0; i < PLUS_FRAMES; i++) {
    const plus = addCommentButton(line);
    if (plus) return plus;
    await new Promise((resolve) => doc.defaultView?.requestAnimationFrame(resolve));
  }
  return addCommentButton(line);
}

/**
 * A left mouse press and release on `target`, as GitHub's own line-number handlers expect it.
 * Presses only number cells, which `diffLineAt` rejects, and `click()` sends no `pointerdown`, so
 * the replay never re-enters `onPress`.
 */
function press(target: Element, shiftKey: boolean) {
  const mouse = mouseInit(target, shiftKey);
  const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
  target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", mouse));
  target.dispatchEvent(new MouseEvent("click", mouse));
}

function mouseInit(target: Element, shiftKey: boolean): MouseEventInit {
  const { left, top, width, height } = target.getBoundingClientRect();
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: target.ownerDocument.defaultView,
    button: 0,
    shiftKey,
    clientX: left + width / 2,
    clientY: top + height / 2,
  };
}
