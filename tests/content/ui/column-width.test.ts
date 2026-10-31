// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { columnSeparator } from "../../../entrypoints/content/ui/column-width";

type Size = { width: number; height: number };
const setViewport = (size: Size) =>
  (window as unknown as { happyDOM: { setViewport: (size: Size) => void } }).happyDOM.setViewport(
    size,
  );

describe("columnSeparator", () => {
  beforeEach(() => setViewport({ width: 1400, height: 768 }));
  afterEach(() => setViewport({ width: 1024, height: 768 }));

  const separatorFor = (onSize?: (width: number) => void) => {
    const column = document.createElement("div");
    const choice = { width: 300 };
    return {
      column,
      ...columnSeparator(column, { choice, saveWidth: () => {}, label: "Resize panel", onSize }),
    };
  };

  it("names the separator by its label", () => {
    expect(separatorFor().separator.getAttribute("aria-label")).toBe("Resize panel");
  });

  it("tells onSize each width it sizes the column to", () => {
    const onSize = vi.fn();
    const { separator, size } = separatorFor(onSize);

    size();
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(onSize.mock.calls).toEqual([[300], [303]]);
  });
});
