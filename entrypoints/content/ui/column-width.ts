/**
 * The width of a column on the left of the page, such as a commit's message or the Conversation
 * panel: its bounds on a window, and the separator on its inner edge that a reader drags, or steps
 * with the arrow keys, to set it.
 */

import { el } from "./dom";

// GitHub docks its file tree beside the diffs from 1012px, so the column takes only what a window
// has past that, and the diffs never get less room than GitHub gives them there.
const DOCKED_FROM = 1012;
// Primer's pane minimum.
const MIN_WIDTH = 256;
// Primer's pane divider steps 3px a key press.
const STEP = 3;

/** Whether a `viewport`-wide window has room for the column beside GitHub's docked layout. */
export const fitsColumn = (viewport: number): boolean => viewport - DOCKED_FROM >= MIN_WIDTH;

const widest = (viewport: number): number => Math.max(MIN_WIDTH, viewport - DOCKED_FROM);

/** `width` held to the column's bounds on a `viewport`-wide window. */
const heldWidth = (width: number, viewport: number): number =>
  Math.min(Math.max(width, MIN_WIDTH), widest(viewport));

/** The width a reader picked, shared by every page in the tab. */
export interface ColumnWidthChoice {
  width: number;
}

/**
 * Builds the separator for `column`, which `size` then sizes to `choice.width` held to the
 * window's bounds. Dragging the separator, or its arrow keys, records the width in `choice` and
 * `saveWidth`s it: a drag once on release, a key at each press. `onSize` hears each width the
 * column takes. The separator's rules are in `column-width.css`, which the column's sheet imports.
 */
export function columnSeparator(
  column: HTMLElement,
  {
    choice,
    saveWidth,
    label,
    onSize,
  }: {
    choice: ColumnWidthChoice;
    saveWidth: (width: number) => void;
    label: string;
    onSize?: (width: number) => void;
  },
): { readonly separator: HTMLElement; readonly size: () => void } {
  const doc = column.ownerDocument;
  const separator = el(doc, "div", "gh-prism-column-separator");
  Object.assign(separator, { tabIndex: 0 });
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-orientation", "vertical");
  separator.setAttribute("aria-label", label);

  const viewport = () => doc.defaultView?.innerWidth ?? 0;
  const show = (width: number) => {
    column.style.width = `${width}px`;
    onSize?.(width);
    separator.setAttribute("aria-valuenow", String(width));
    separator.setAttribute("aria-valuemin", String(MIN_WIDTH));
    separator.setAttribute("aria-valuemax", String(widest(viewport())));
  };
  const size = () => show(heldWidth(choice.width, viewport()));
  const pick = (width: number) => {
    choice.width = heldWidth(width, viewport());
    show(choice.width);
  };

  separator.addEventListener("keydown", (event) => {
    const step = KEY_STEPS[event.key];
    if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    pick(heldWidth(choice.width, viewport()) + step * STEP);
    saveWidth(choice.width);
  });

  let drag: { readonly x: number; readonly width: number } | undefined;
  separator.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    separator.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, width: heldWidth(choice.width, viewport()) };
    separator.dataset.dragging = "";
  });
  separator.addEventListener("pointermove", (event) => {
    if (drag) pick(drag.width + event.clientX - drag.x);
  });
  // Fires after pointerup and pointercancel, and when the separator leaves the page mid-drag.
  separator.addEventListener("lostpointercapture", () => {
    if (!drag) return;
    drag = undefined;
    delete separator.dataset.dragging;
    saveWidth(choice.width);
  });

  return { separator, size };
}

const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
};
