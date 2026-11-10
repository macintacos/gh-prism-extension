import { browser } from "wxt/browser";
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { WASM_DIR } from "../utils/structural/packaged";
import { engineRunner } from "../utils/structural/runner";

const ENGINE_GLOBAL = "__ghPrismStructural";

export default defineUnlistedScript(() => {
  const run = engineRunner({
    urlOf: (file) => new URL(`${WASM_DIR}/${file}`, browser.runtime.getURL("/")).href,
    now: () => performance.now(),
    pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
  });
  (globalThis as Record<string, unknown>)[ENGINE_GLOBAL] = run;
});
