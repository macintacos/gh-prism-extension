/** A stand-in for the CSS Custom Highlight API's `Highlight`, which happy-dom lacks. */
export class HighlightStub extends Set<Range> {}

/**
 * Installs `HighlightStub` as `window.Highlight` and a fresh `CSS.highlights` registry, keeping
 * `CSS.escape`. Returns the registry and a function that puts the original `CSS` back.
 */
export function stubHighlights(): { highlights: Map<string, unknown>; restore: () => void } {
  const css = Object.getOwnPropertyDescriptor(window, "CSS");
  const highlights = new Map<string, unknown>();
  Object.assign(window, { Highlight: HighlightStub });
  // happy-dom's window builds a new CSS object on every read, so a set registry would not stick.
  const value = { escape: window.CSS.escape, highlights };
  Object.defineProperty(window, "CSS", { configurable: true, value });

  return {
    highlights,
    restore: () => {
      Reflect.deleteProperty(window, "Highlight");
      if (css) Object.defineProperty(window, "CSS", css);
      else Reflect.deleteProperty(window, "CSS");
    },
  };
}
