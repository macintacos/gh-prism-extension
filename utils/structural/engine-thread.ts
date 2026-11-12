// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import { browser } from "wxt/browser";
import { ENGINE_SCRIPT } from "./engine-script";
import { workerEngine } from "./engine-worker";
import { OFFSCREEN_PAGE, offscreenEngine } from "./offscreen";
import type { EngineRun } from "./request";

/**
 * Starts nothing: returns an `EngineRun` that starts the engine's thread on its first request: a
 * Worker in Firefox, the offscreen document that owns one in Chrome.
 */
export function loadEngineThread(): Promise<EngineRun> {
  if (import.meta.env.BROWSER === "firefox")
    return Promise.resolve(workerEngine(() => new Worker(browser.runtime.getURL(ENGINE_SCRIPT))));
  return Promise.resolve(
    offscreenEngine({
      exists: async () =>
        (await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length > 0,
      create: () =>
        browser.offscreen.createDocument({
          url: browser.runtime.getURL(OFFSCREEN_PAGE),
          reasons: ["WORKERS"],
          justification:
            "Runs the structural diff engine in a worker, off the service worker's thread.",
        }),
      send: (message) => browser.runtime.sendMessage(message),
      newId: () => crypto.randomUUID(),
    }),
  );
}
