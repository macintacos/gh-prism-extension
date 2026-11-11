import { browser } from "wxt/browser";
import { ENGINE_SCRIPT } from "../../utils/structural/engine-script";
import { workerEngine } from "../../utils/structural/engine-worker";
import { serveOffscreen } from "../../utils/structural/offscreen";

/** How long the document stays open after its last answer. */
const IDLE_MS = 30_000;

serveOffscreen({
  run: workerEngine(() => new Worker(browser.runtime.getURL(ENGINE_SCRIPT))),
  listen: (handler) =>
    // sendResponse, not a returned promise: not every Chrome this build targets accepts one.
    browser.runtime.onMessage.addListener((message, sender, sendResponse) =>
      handler(message, sender.tab !== undefined, sendResponse),
    ),
  closeWhenIdle: (close) => {
    const timer = setTimeout(close, IDLE_MS);
    return () => clearTimeout(timer);
  },
  close: () => window.close(),
});
