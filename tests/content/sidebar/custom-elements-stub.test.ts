// @vitest-environment happy-dom
import { expect, it } from "vitest";

// Firefox hands a content script the page's registry. A class it defines there gives the
// content script its own Element and Node, so `instanceof Element` fails for every page node.
it("loads the section tree without defining an element in the page's registry", async () => {
  const pageRegistry = globalThis.customElements;

  await import("../../../entrypoints/content/sidebar/section-tree");

  expect(pageRegistry.get("file-tree-container")).toBeUndefined();
});
