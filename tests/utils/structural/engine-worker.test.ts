import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, type EngineResult } from "../../../utils/structural/engine";
import {
  type EngineScope,
  type EngineWorker,
  type FromEngine,
  serveEngineWorker,
  type ToEngine,
  workerEngine,
} from "../../../utils/structural/engine-worker";
import type { EngineRun, StructuralRequest } from "../../../utils/structural/request";

const REQUEST: StructuralRequest = {
  oldText: "a",
  newText: "b",
  grammar: undefined,
  regions: [],
  limits: DEFAULT_LIMITS,
};
const RESULT: EngineResult = { ok: false, reason: "unsupported" };
const FAILED: EngineResult = { ok: false, reason: "failed" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A Worker and its global, each delivering the other's messages a microtask later. */
function workerPair() {
  const scope: EngineScope & { posted: FromEngine[] } = {
    posted: [],
    onmessage: null,
    postMessage(message) {
      scope.posted.push(message);
      queueMicrotask(() => worker.onmessage?.(new MessageEvent("message", { data: message })));
    },
  };
  const worker: EngineWorker & { posted: ToEngine[] } = {
    posted: [],
    onmessage: null,
    onerror: null,
    postMessage(message) {
      worker.posted.push(message);
      queueMicrotask(() => scope.onmessage?.({ data: message }));
    },
    terminate: vi.fn(),
  };
  return { worker, scope };
}

function served(run: EngineRun) {
  const pair = workerPair();
  serveEngineWorker(pair.scope, run);
  return pair;
}

const signal = () => new AbortController().signal;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("workerEngine", () => {
  it("spawns nothing until the first request, then one Worker for many", async () => {
    const { worker } = served(vi.fn(async () => RESULT));
    const spawn = vi.fn(() => worker);
    const engine = workerEngine(spawn);
    expect(spawn).not.toHaveBeenCalled();

    await engine(REQUEST, signal());
    await engine(REQUEST, signal());

    expect(spawn).toHaveBeenCalledOnce();
  });

  it("resolves each overlapping request with the result posted for its id", async () => {
    const run = vi.fn(
      async (request: StructuralRequest): Promise<EngineResult> =>
        request.oldText === "1" ? RESULT : FAILED,
    );
    const { worker } = served(run);
    const engine = workerEngine(() => worker);

    const [one, two] = await Promise.all([
      engine({ ...REQUEST, oldText: "1" }, signal()),
      engine({ ...REQUEST, oldText: "2" }, signal()),
    ]);

    expect(one).toEqual(RESULT);
    expect(two).toEqual(FAILED);
  });

  it("rejects an already aborted request with its reason and posts nothing", async () => {
    const { worker } = workerPair();
    const engine = workerEngine(() => worker);
    const controller = new AbortController();
    controller.abort("gone");

    await expect(engine(REQUEST, controller.signal)).rejects.toBe("gone");
    expect(worker.posted).toEqual([]);
  });

  it("rejects at once on abort, posts a cancel, and ignores a late result", async () => {
    const { worker, scope } = workerPair();
    scope.onmessage = () => {};
    const engine = workerEngine(() => worker);
    const controller = new AbortController();

    const pending = engine(REQUEST, controller.signal);
    controller.abort("gone");

    await expect(pending).rejects.toBe("gone");
    const id = worker.posted[0]?.id;
    expect(worker.posted[1]).toEqual({ id, cancel: true });
    expect(() =>
      worker.onmessage?.(new MessageEvent("message", { data: { id: id ?? 0, result: RESULT } })),
    ).not.toThrow();
  });

  it("resolves failed and warns when the Worker posts an error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { worker } = served(vi.fn(async () => Promise.reject(new Error("boom"))));
    const engine = workerEngine(() => worker);

    await expect(engine(REQUEST, signal())).resolves.toEqual(FAILED);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^gh-prism:/);
  });

  it("on a Worker error, terminates it, fails every pending request, and respawns next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = workerPair();
    first.scope.onmessage = () => {};
    const second = served(vi.fn(async () => RESULT));
    const spawn = vi.fn().mockReturnValueOnce(first.worker).mockReturnValueOnce(second.worker);
    const engine = workerEngine(spawn);

    const one = engine(REQUEST, signal());
    const two = engine(REQUEST, signal());
    // Node has no ErrorEvent; failAll reads nothing off the event.
    first.worker.onerror?.(new Event("error") as ErrorEvent);

    await expect(Promise.all([one, two])).resolves.toEqual([FAILED, FAILED]);
    expect(first.worker.terminate).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalled();
    await expect(engine(REQUEST, signal())).resolves.toEqual(RESULT);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("resolves failed with a warning when spawning throws, and spawns again next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { worker } = served(vi.fn(async () => RESULT));
    const spawn = vi
      .fn<() => EngineWorker>()
      .mockImplementationOnce(() => {
        throw new Error("no Worker");
      })
      .mockReturnValueOnce(worker);
    const engine = workerEngine(spawn);

    await expect(engine(REQUEST, signal())).resolves.toEqual(FAILED);
    expect(warn).toHaveBeenCalled();
    await expect(engine(REQUEST, signal())).resolves.toEqual(RESULT);
  });
});

describe("serveEngineWorker", () => {
  it("runs each request with a signal of its own and posts its result", async () => {
    const run = vi.fn(async (_request: StructuralRequest, _signal: AbortSignal) => RESULT);
    const { worker, scope } = served(run);

    worker.postMessage({ id: 1, request: REQUEST });
    worker.postMessage({ id: 2, request: REQUEST });

    await vi.waitFor(() =>
      expect(scope.posted).toEqual([
        { id: 1, result: RESULT },
        { id: 2, result: RESULT },
      ]),
    );
    expect(run.mock.calls[0]?.[0]).toEqual(REQUEST);
    expect(run.mock.calls[0]?.[1]).not.toBe(run.mock.calls[1]?.[1]);
  });

  it("aborts a cancelled request's signal and posts nothing for it", async () => {
    const run = vi.fn(
      (_request: StructuralRequest, runSignal: AbortSignal) =>
        new Promise<EngineResult>((_resolve, reject) => {
          runSignal.addEventListener("abort", () => reject(runSignal.reason));
        }),
    );
    const { worker, scope } = served(run);

    worker.postMessage({ id: 1, request: REQUEST });
    worker.postMessage({ id: 1, cancel: true });

    await vi.waitFor(() => expect(run.mock.calls[0]?.[1].aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scope.posted).toEqual([]);
  });

  it("posts an error when the run rejects for another reason", async () => {
    const outcome = deferred<EngineResult>();
    const { worker, scope } = served(() => outcome.promise);

    worker.postMessage({ id: 3, request: REQUEST });
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    outcome.reject(new Error("boom"));

    await vi.waitFor(() => expect(scope.posted).toEqual([{ id: 3, error: "Error: boom" }]));
  });
});
