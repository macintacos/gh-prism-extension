const VIEWPORT_MARGIN = 8;

/**
 * Puts `popover` below `anchor`, start-aligned, else above it, 8px inside the viewport. When
 * it fits on neither side, it takes the roomier one and caps its max height to that room, so
 * it never covers `anchor`.
 */
export function place(popover: HTMLElement, anchor: DOMRect): void {
  const view = popover.ownerDocument.defaultView;
  const viewHeight = view?.innerHeight ?? 0;
  popover.style.maxHeight = "";
  popover.style.boxSizing = "";
  // offset*, not getBoundingClientRect: the entrance transition is still scaling it.
  const { offsetWidth: width, offsetHeight: height } = popover;
  const maxLeft = (view?.innerWidth ?? 0) - width - VIEWPORT_MARGIN;
  const roomBelow = viewHeight - VIEWPORT_MARGIN - anchor.bottom;
  const roomAbove = anchor.top - VIEWPORT_MARGIN;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;
  if (height <= roomBelow) {
    popover.style.top = `${anchor.bottom}px`;
    return;
  }
  if (height <= roomAbove) {
    popover.style.top = `${anchor.top - height}px`;
    return;
  }
  // So the cap bounds its padding and border too.
  popover.style.boxSizing = "border-box";
  if (roomBelow >= roomAbove) {
    popover.style.maxHeight = `${roomBelow}px`;
    popover.style.top = `${anchor.bottom}px`;
  } else {
    popover.style.maxHeight = `${roomAbove}px`;
    popover.style.top = `${VIEWPORT_MARGIN}px`;
  }
}
