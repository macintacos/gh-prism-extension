// Reached from background.js, the offscreen page, and the engine's Worker script: import the engine and runner only as types, or they are bundled into the first two.
import type { EngineResult } from "./engine";
import type { EngineRun, StructuralRequest } from "./request";

/** What the Worker's owner posts: a request, or a cancel for one still running. */
export type ToEngine = { id: number; request: StructuralRequest } | { id: number; cancel: true };
/** What the Worker posts back, once per request that was not cancelled. */
export type FromEngine = { id: number; result: EngineResult } | { id: number; error: string };

/** The parts of a Worker the client uses. */
export interface EngineWorker {
  postMessage(message: ToEngine): void;
  terminate(): void;
  // The DOM's event types, or a real Worker would not be assignable to this interface.
  onmessage: ((event: MessageEvent<FromEngine>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** The parts of a Worker's global the engine script uses. */
export interface EngineScope {
  listen(handler: (message: ToEngine) => void): void;
  post(message: FromEngine): void;
}

const FAILED: EngineResult = { ok: false, reason: "failed" };

/**
 * An `EngineRun` that posts each request to a Worker, spawned on first use. A Worker that errors
 * is terminated, its pending requests resolve `failed`, and the next request spawns another.
 */
export function workerEngine(spawn: () => EngineWorker): EngineRun {
  let worker: EngineWorker | undefined;
  let nextId = 0;
  const pending = new Map<number, (result: EngineResult) => void>();

  const failAll = (event: unknown) => {
    console.warn("gh-prism: the structural engine Worker failed", event);
    worker?.terminate();
    worker = undefined;
    for (const settle of pending.values()) settle(FAILED);
    pending.clear();
  };

  const started = (): EngineWorker => {
    if (worker) return worker;

    const spawned = spawn();
    spawned.onmessage = ({ data }) => {
      const settle = pending.get(data.id);
      pending.delete(data.id);
      if ("error" in data) {
        if (settle) console.warn("gh-prism: the structural engine failed", data.error);
        settle?.(FAILED);
      } else settle?.(data.result);
    };
    spawned.onerror = failAll;

    worker = spawned;
    return spawned;
  };

  return (request, signal) => {
    if (signal.aborted) return Promise.reject(signal.reason);

    let target: EngineWorker;
    try {
      target = started();
    } catch (error) {
      console.warn("gh-prism: couldn't start the structural engine Worker", error);
      return Promise.resolve(FAILED);
    }

    const id = nextId++;
    return new Promise<EngineResult>((resolve, reject) => {
      const onAbort = () => {
        pending.delete(id);
        target.postMessage({ id, cancel: true });
        reject(signal.reason);
      };

      pending.set(id, (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      });
      signal.addEventListener("abort", onAbort, { once: true });

      target.postMessage({ id, request });
    });
  };
}

/** Answers a Worker's requests with `run`, aborting a request its owner cancels. */
export function serveEngineWorker(scope: EngineScope, run: EngineRun): void {
  const running = new Map<number, AbortController>();

  scope.listen(async (message) => {
    if ("cancel" in message) {
      running.get(message.id)?.abort();
      return;
    }

    const controller = new AbortController();
    running.set(message.id, controller);
    try {
      scope.post({ id: message.id, result: await run(message.request, controller.signal) });
    } catch (error) {
      if (!controller.signal.aborted) scope.post({ id: message.id, error: String(error) });
    } finally {
      running.delete(message.id);
    }
  });
}
