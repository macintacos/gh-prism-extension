/**
 * The keyframes that fold `part` shut and open at `height`, its full height unless given: its
 * height, vertical padding, and vertical borders, clipped, so what follows it moves with its edge.
 */
export function foldFrames(
  win: Window,
  part: Element,
  height = part.getBoundingClientRect().height,
): { open: Keyframe; shut: Keyframe } {
  const { paddingTop, paddingBottom, borderTopWidth, borderBottomWidth } =
    win.getComputedStyle(part);
  const held = { boxSizing: "border-box", minHeight: "0px", overflow: "clip" };
  return {
    open: {
      ...held,
      height: `${height}px`,
      paddingTop,
      paddingBottom,
      borderTopWidth,
      borderBottomWidth,
    },
    shut: {
      ...held,
      height: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
      borderTopWidth: "0px",
      borderBottomWidth: "0px",
    },
  };
}
