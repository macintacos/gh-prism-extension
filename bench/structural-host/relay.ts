import { browser } from "wxt/browser";

/**
 * Bench-only content script body: relays each page message `{ toBg, portName, n }` to the
 * background over a fresh port, and posts the first reply back as `{ fromBg, n }`.
 */
export function relay(): void {
  window.addEventListener("message", (event) => {
    const { toBg, portName, n } = (event.data ?? {}) as {
      toBg?: unknown;
      portName?: string;
      n?: number;
    };
    if (toBg === undefined || !portName) return;

    const port = browser.runtime.connect({ name: portName });
    port.onMessage.addListener((fromBg) => {
      port.disconnect();
      window.postMessage({ fromBg, n }, "*");
    });
    port.onDisconnect.addListener(() => window.postMessage({ fromBg: null, n }, "*"));
    port.postMessage(toBg);
  });
}
