/** Wires `node` to run `onPress` when a press began on an earlier control of the same `key`. */
export type PressGuard = (node: HTMLElement, key: string, onPress: () => void) => void;

/**
 * For the whole of `visit`, a guard for presses the page re-mounts their control under: GitHub's
 * hydration can replace the control between pointerdown and pointerup, and then no click fires.
 * A press is forgotten once the pointer is released or cancelled anywhere.
 */
export function pressGuard(doc: Document, visit: AbortSignal): PressGuard {
  let pressed: { key: string; node: HTMLElement } | undefined;
  // After the node's own pointerup, which bubbles up to here.
  const forget = () => (pressed = undefined);
  doc.addEventListener("pointerup", forget, { signal: visit });
  doc.addEventListener("pointercancel", forget, { signal: visit });
  return (node, key, onPress) => {
    node.addEventListener("pointerdown", () => (pressed = { key, node }));
    node.addEventListener("pointerup", () => {
      if (pressed?.key === key && !pressed.node.isConnected) onPress();
    });
  };
}
