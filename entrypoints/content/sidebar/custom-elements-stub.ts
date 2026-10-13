// Chrome content scripts run in an isolated world whose `customElements` is null, and
// @pierre/trees calls `customElements.get` as it loads. Its trees mount into our own elements,
// which needs only `attachShadow`, so an empty registry will do. Import before @pierre/trees.
if (globalThis.customElements == null) {
  const registry: Pick<CustomElementRegistry, "define" | "get"> = {
    define: () => {},
    get: () => undefined,
  };
  Object.defineProperty(globalThis, "customElements", { configurable: true, value: registry });
}
