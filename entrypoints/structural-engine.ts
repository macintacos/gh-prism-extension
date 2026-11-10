import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { ENGINE_GLOBAL, yieldToMessages } from "../utils/structural/engine-script";
import { WASM_DIR } from "../utils/structural/packaged";
import { engineRunner } from "../utils/structural/runner";

/**
 * Assigns the engine's `EngineRun` to `ENGINE_GLOBAL`. The top level must only define it: Chrome
 * evaluates this script at install, with structural mode off.
 */
export default defineUnlistedScript(() => {
  const run = engineRunner({
    // Not the typed getURL: the build hook adds the wasm files, so `PublicPath` does not list them.
    urlOf: (file) => new URL(`${WASM_DIR}/${file}`, browser.runtime.getURL("/")).href,
    now: () => performance.now(),
    pause: yieldToMessages,
  });
  (globalThis as Record<string, unknown>)[ENGINE_GLOBAL] = run;
});
