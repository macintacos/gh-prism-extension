// Keep a placed popover's tw:max-h at 100vh minus twice this.
const VIEWPORT_MARGIN = 8;

/** Puts `popover` below `anchor`, start-aligned, or above it when there's no room below. */
export function place(popover: HTMLElement, anchor: DOMRect): void {
  const view = popover.ownerDocument.defaultView;
  // offset*, not getBoundingClientRect: the entrance transition is still scaling it.
  const { offsetWidth: width, offsetHeight: height } = popover;
  const maxLeft = (view?.innerWidth ?? 0) - width - VIEWPORT_MARGIN;
  const maxTop = (view?.innerHeight ?? 0) - height - VIEWPORT_MARGIN;
  const top = anchor.bottom > maxTop ? anchor.top - height : anchor.bottom;
  popover.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.left, maxLeft))}px`;
  popover.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, maxTop))}px`;
}
