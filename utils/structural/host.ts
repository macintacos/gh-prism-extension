import type { EngineResult } from "./engine";
import type { EngineRun } from "./request";

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
  let previous: Promise<unknown> = Promise.resolve();
  let engine: Promise<EngineRun> | undefined;

  const load = () => {
    engine ??= deps.loadEngine().catch((error: unknown) => {
      engine = undefined;
      throw error;
    });
    return engine;
  };
  const runOne: EngineRun = async (request, signal) => {
    await deps.pause();
    signal.throwIfAborted();

    let run: EngineRun;
    try {
      run = await load();
    } catch {
      return { ok: false, reason: "failed" } satisfies EngineResult;
    }
    return run(request, signal);
  };

  return (request, signal) => {
    const result = previous.then(() => runOne(request, signal));
    previous = result.catch(() => {});
    return result;
  };
}
