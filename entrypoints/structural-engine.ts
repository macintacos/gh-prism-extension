import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import { yieldToMessages } from "../utils/structural/engine-script";
import { type EngineScope, serveEngineWorker } from "../utils/structural/engine-worker";
import { WASM_DIR } from "../utils/structural/packaged";
import { engineRunner } from "../utils/structural/runner";

/** The engine's dedicated Worker: answers each request its owner posts with an engine run. */
export default defineUnlistedScript(() => {
  serveEngineWorker(
    self as unknown as EngineScope,
    engineRunner({
      // A dedicated Worker has no browser.*; this script sits at the build root beside WASM_DIR.
      urlOf: (file) => new URL(`${WASM_DIR}/${file}`, self.location.href).href,
      now: () => performance.now(),
      pause: yieldToMessages,
    }),
  );
});
