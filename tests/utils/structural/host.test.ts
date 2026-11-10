import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, type EngineResult } from "../../../utils/structural/engine";
import { structuralHost } from "../../../utils/structural/host";
import type { EngineRun, StructuralRequest } from "../../../utils/structural/request";

const REQUEST: StructuralRequest = {
  oldText: "a",
  newText: "b",
  grammar: undefined,
  regions: [],
  limits: DEFAULT_LIMITS,
};
const RESULT: EngineResult = { ok: false, reason: "unsupported" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(run: EngineRun = vi.fn(async () => RESULT)) {
  const loadEngine = vi.fn(async () => run);
  const pause = vi.fn(async () => {});
  return { host: structuralHost({ loadEngine, pause }), loadEngine, pause, run };
}

describe("structuralHost", () => {
  it("loads the engine on the first request, and only once", async () => {
    const { host, loadEngine } = setup();
    expect(loadEngine).not.toHaveBeenCalled();

    await host(REQUEST, new AbortController().signal);
    await host(REQUEST, new AbortController().signal);

    expect(loadEngine).toHaveBeenCalledOnce();
  });

  it("returns the engine's result unchanged", async () => {
    const { host } = setup();
    await expect(host(REQUEST, new AbortController().signal)).resolves.toBe(RESULT);
  });

  it("runs requests one after another in arrival order", async () => {
    const first = deferred<EngineResult>();
    const order: string[] = [];
    const run = vi.fn(async (request: StructuralRequest) => {
      order.push(`start ${request.oldText}`);
      if (request.oldText === "1") await first.promise;
      order.push(`end ${request.oldText}`);
      return RESULT;
    });
    const { host } = setup(run);

    const one = host({ ...REQUEST, oldText: "1" }, new AbortController().signal);
    const two = host({ ...REQUEST, oldText: "2" }, new AbortController().signal);
    await vi.waitFor(() => expect(order).toEqual(["start 1"]));
    first.resolve(RESULT);
    await Promise.all([one, two]);

    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("awaits the pause before each run", async () => {
    const gate = deferred<void>();
    const { host, run, pause } = setup();
    pause.mockReturnValueOnce(gate.promise);

    const done = host(REQUEST, new AbortController().signal);
    await vi.waitFor(() => expect(pause).toHaveBeenCalledOnce());
    expect(run).not.toHaveBeenCalled();
    gate.resolve();
    await done;

    expect(run).toHaveBeenCalledOnce();
  });

  it("drops a request aborted while it waits, then runs the next", async () => {
    const first = deferred<EngineResult>();
    const run = vi.fn(async (request: StructuralRequest) =>
      request.oldText === "1" ? first.promise : RESULT,
    );
    const { host, loadEngine, pause } = setup(run);
    const aborts = new AbortController();

    const one = host({ ...REQUEST, oldText: "1" }, new AbortController().signal);
    const two = host({ ...REQUEST, oldText: "2" }, aborts.signal);
    const three = host({ ...REQUEST, oldText: "3" }, new AbortController().signal);
    aborts.abort(new Error("gone"));
    first.resolve(RESULT);

    await expect(two).rejects.toThrow("gone");
    await expect(three).resolves.toBe(RESULT);
    await one;
    expect(run.mock.calls.map(([request]) => request.oldText)).toEqual(["1", "3"]);
    expect(loadEngine).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("does not load the engine for a request aborted before its turn", async () => {
    const { host, loadEngine } = setup();
    const aborts = new AbortController();

    const one = host(REQUEST, aborts.signal);
    aborts.abort(new Error("gone"));

    await expect(one).rejects.toThrow("gone");
    expect(loadEngine).not.toHaveBeenCalled();
  });

  it("refuses with failed when the engine does not load, and retries the load next time", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, loadEngine, run } = setup();
    const error = new Error("no wasm");
    loadEngine.mockRejectedValueOnce(error);

    await expect(host(REQUEST, new AbortController().signal)).resolves.toEqual({
      ok: false,
      reason: "failed",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gh-prism:"), error);
    warn.mockRestore();
    await expect(host(REQUEST, new AbortController().signal)).resolves.toBe(RESULT);
    expect(loadEngine).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
  });
});
