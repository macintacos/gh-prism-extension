// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import type { EngineResult } from "./engine";
import type { EngineRun, StructuralRequest } from "./request";

export type ToEngine = { id: number; request: StructuralRequest } | { id: number; cancel: true };
export type FromEngine = { id: number; result: EngineResult } | { id: number; error: string };

/** The parts of a Worker the client uses. */
export interface EngineWorker {
  postMessage(message: ToEngine): void;
  terminate(): void;
  onmessage: ((event: { data: FromEngine }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** The parts of a Worker's global the engine script uses. */
export interface EngineScope {
  postMessage(message: FromEngine): void;
  onmessage: ((event: { data: ToEngine }) => void) | null;
}

const FAILED: EngineResult = { ok: false, reason: "failed" };

/** An `EngineRun` that posts each request to a Worker, spawned on first use. */
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
      if ("error" in data) console.warn("gh-prism: the structural engine failed", data.error);
      settle?.("error" in data ? FAILED : data.result);
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

  scope.onmessage = async ({ data }) => {
    if ("cancel" in data) {
      running.get(data.id)?.abort();
      return;
    }

    const controller = new AbortController();
    running.set(data.id, controller);
    try {
      scope.postMessage({ id: data.id, result: await run(data.request, controller.signal) });
    } catch (error) {
      if (!controller.signal.aborted) scope.postMessage({ id: data.id, error: String(error) });
    } finally {
      running.delete(data.id);
    }
  };
}
