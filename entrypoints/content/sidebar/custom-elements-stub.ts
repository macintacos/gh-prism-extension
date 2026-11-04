// @pierre/trees calls `customElements` as it loads, but its trees mount into our own elements with
// `attachShadow`, so an empty registry will do. Chrome's isolated world has none, and Firefox hands
// a content script the page's, where a definition gives the script its own Element and Node and
// fails every `instanceof Element` on a page node. Import before @pierre/trees.
const registry: Pick<CustomElementRegistry, "define" | "get"> = {
  define: () => {},
  get: () => undefined,
};
Object.defineProperty(globalThis, "customElements", { configurable: true, value: registry });
