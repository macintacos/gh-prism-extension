// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import type { EngineRun } from "./request";

/** What the host needs from the background it runs in. */
export interface HostDeps {
  /** Runs a request on the engine's thread. */
  readonly engine: EngineRun;
  /** A yield that lets queued port messages run first. */
  readonly pause: () => Promise<void>;
}

/**
 * Runs structural requests one at a time, each after a pause, so intent reads are answered between
 * them. A request whose signal aborts while it waits is dropped without running the engine. An
 * aborted request's far side keeps running until its next pause while the next request starts.
 */
export function structuralHost(deps: HostDeps): EngineRun {
  let queueTail: Promise<unknown> = Promise.resolve();

  const runOne: EngineRun = async (request, signal) => {
    signal.throwIfAborted();
    await deps.pause();
    signal.throwIfAborted();
    return deps.engine(request, signal);
  };

  return (request, signal) => {
    const result = queueTail.then(() => runOne(request, signal));
    queueTail = result.catch(() => {});
    return result;
  };
}
