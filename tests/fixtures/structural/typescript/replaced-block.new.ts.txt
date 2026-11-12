import { describe, expect, it, vi } from "vitest";
import type { EngineResult } from "../../../utils/structural/engine";
import { structuralHost } from "../../../utils/structural/host";
import type { EngineRun, StructuralRequest } from "../../../utils/structural/request";
import { REQUEST, RESULT } from "../../fixtures/structural-request";

function setup(run: EngineRun = vi.fn(async () => RESULT)) {
  const pause = vi.fn(async () => {});
  return { host: structuralHost({ engine: run, pause }), pause, run };
}

describe("structuralHost", () => {
  it("returns the engine's result unchanged", async () => {
    const { host } = setup();
    await expect(host(REQUEST, new AbortController().signal)).resolves.toBe(RESULT);
  });

  it("runs requests one after another in arrival order", async () => {
    const first = Promise.withResolvers<EngineResult>();
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
    const gate = Promise.withResolvers<void>();
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
    const first = Promise.withResolvers<EngineResult>();
    const run = vi.fn(async (request: StructuralRequest) =>
      request.oldText === "1" ? first.promise : RESULT,
    );
    const { host, pause } = setup(run);
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
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("does not run the engine for a request aborted before its turn", async () => {
    const { host, run } = setup();
    const aborts = new AbortController();

    const one = host(REQUEST, aborts.signal);
    aborts.abort(new Error("gone"));

    await expect(one).rejects.toThrow("gone");
    expect(run).not.toHaveBeenCalled();
  });
});
