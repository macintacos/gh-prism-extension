// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";

it("loads the section tree without defining an element in the page's registry", async () => {
  const define = vi.spyOn(globalThis.customElements, "define");

  await import("../../../entrypoints/content/sidebar/section-tree");

  expect(define).not.toHaveBeenCalled();
});
