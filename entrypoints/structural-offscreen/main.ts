import { browser } from "wxt/browser";
import { ENGINE_SCRIPT } from "../../utils/structural/engine-script";
import { workerEngine } from "../../utils/structural/engine-worker";
import { OFFSCREEN_IDLE_MS, serveOffscreen } from "../../utils/structural/offscreen";

/** Chrome's offscreen document: owns the engine's Worker and answers the service worker's relayed requests. */
serveOffscreen({
  run: workerEngine(() => new Worker(browser.runtime.getURL(ENGINE_SCRIPT))),
  listen: (handler) =>
    // sendResponse, not a returned promise: not every Chrome this build targets accepts one.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) =>
      handler(message, sender.tab !== undefined, sendResponse),
    ),
  closeWhenIdle: (close) => {
    const timer = setTimeout(close, OFFSCREEN_IDLE_MS);
    return () => clearTimeout(timer);
  },
  close: () => window.close(),
});
