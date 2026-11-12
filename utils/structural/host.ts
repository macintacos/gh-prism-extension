// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import type { EngineRun } from "./request";
import { retriedOnFailure } from "./retried";

/** What the host needs from the background it runs in. */
export interface HostDeps {
  /** Loads the engine on first use. A rejection is retried by the next request. */
  readonly loadEngine: () => Promise<EngineRun>;
  /** A yield that lets queued port messages run first. */
  readonly pause: () => Promise<void>;
}

/**
 * Runs structural requests one at a time, each after a pause, so intent reads are answered between
 * them. A request whose signal aborts while it waits is dropped without loading or running the
 * engine.
 */
export function structuralHost(deps: HostDeps): EngineRun {
  let queueTail: Promise<unknown> = Promise.resolve();
  const load = retriedOnFailure(deps.loadEngine);

  const runOne: EngineRun = async (request, signal) => {
    signal.throwIfAborted();
    await deps.pause();
    signal.throwIfAborted();

    let run: EngineRun;
    try {
      run = await load();
    } catch (error) {
      console.warn("gh-prism: couldn't load the structural engine", error);
      return { ok: false, reason: "failed" };
    }
    return run(request, signal);
  };

  return (request, signal) => {
    const result = queueTail.then(() => runOne(request, signal));
    queueTail = result.catch(() => {});
    return result;
  };
}
