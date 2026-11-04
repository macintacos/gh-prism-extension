// @pierre/trees defines a custom element as it loads, but its trees mount into our own elements
// with `attachShadow`, so an empty registry will do. Firefox hands a content script the page's
// registry, and a class defined there gives the script its own Element and Node, failing every
// `instanceof Element` on a page node. Import before @pierre/trees.
const registry: Pick<CustomElementRegistry, "define" | "get"> = {
  define: () => {},
  get: () => undefined,
};
Object.defineProperty(globalThis, "customElements", { configurable: true, value: registry });
