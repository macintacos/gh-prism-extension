const VIEWPORT_MARGIN = 8;

/**
 * Places a freshly built `popover` once: below `anchor`, start-aligned, else above it, 8px
 * inside the viewport. When it fits on neither side, it takes the roomier one and caps its
 * height to that room, so it never covers `anchor`. Owns `popover`'s inline `left`, `top`, and,
 * when capped, `max-height`.
 */
export function place(popover: HTMLElement, anchor: DOMRect): void {
  const view = popover.ownerDocument.defaultView;
  // offset*, not getBoundingClientRect: the entrance transition is still scaling it.
  const { offsetWidth: width, offsetHeight: height } = popover;

  const maxLeft = (view?.innerWidth ?? 0) - width - VIEWPORT_MARGIN;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;

  const { top, room } = spotFor(height, anchor, view?.innerHeight ?? 0);
  popover.style.top = `${top}px`;
  if (room === undefined) return;

  // max-height bounds the content box, as no preflight sets box-sizing.
  const paddingAndBorder = height - parseFloat(view?.getComputedStyle(popover).height ?? "0");
  popover.style.maxHeight = `${room - paddingAndBorder}px`;
}

/**
 * Where a popover `height` tall goes against `anchor` in a view `viewHeight` tall: its top, and,
 * when it fits on neither side, the room that keeps it off `anchor`.
 */
function spotFor(
  height: number,
  anchor: DOMRect,
  viewHeight: number,
): { top: number; room?: number } {
  const belowTop = Math.max(VIEWPORT_MARGIN, anchor.bottom);
  const below = viewHeight - VIEWPORT_MARGIN - belowTop;
  const above = anchor.top - VIEWPORT_MARGIN;
  if (height <= below) return { top: belowTop };
  if (height <= above) return { top: anchor.top - height };
  return below >= above ? { top: belowTop, room: below } : { top: VIEWPORT_MARGIN, room: above };
}
