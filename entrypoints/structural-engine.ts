import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { ENGINE_GLOBAL, yieldToMessages } from "../utils/structural/engine-script";
import { WASM_DIR } from "../utils/structural/packaged";
import { engineRunner } from "../utils/structural/runner";

export default defineUnlistedScript(() => {
  const run = engineRunner({
    urlOf: (file) => new URL(`${WASM_DIR}/${file}`, browser.runtime.getURL("/")).href,
    now: () => performance.now(),
    pause: yieldToMessages,
  });
  (globalThis as Record<string, unknown>)[ENGINE_GLOBAL] = run;
});
