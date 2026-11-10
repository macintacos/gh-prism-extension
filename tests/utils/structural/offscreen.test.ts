import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS, type EngineResult } from "../../../utils/structural/engine";
import {
  type OffscreenApi,
  type OffscreenDeps,
  offscreenEngine,
  serveOffscreen,
  type ToOffscreen,
} from "../../../utils/structural/offscreen";
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
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeApi(overrides: Partial<OffscreenApi> = {}) {
  return {
    exists: vi.fn(async () => true),
    create: vi.fn(async () => {}),
    send: vi.fn(async (_message: ToOffscreen): Promise<EngineResult | undefined> => RESULT),
    newId: vi.fn(() => "id-1"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("offscreenEngine", () => {
  it("creates the document only when none exists, checking on every request", async () => {
    const api = fakeApi({ exists: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true) });
    const run = offscreenEngine(api);

    await run(REQUEST, new AbortController().signal);
    await run(REQUEST, new AbortController().signal);

    expect(api.exists).toHaveBeenCalledTimes(2);
    expect(api.create).toHaveBeenCalledOnce();
  });

  it("resolves with the response to its request message", async () => {
    const api = fakeApi();
    const result = await offscreenEngine(api)(REQUEST, new AbortController().signal);

    expect(result).toBe(RESULT);
    expect(api.send).toHaveBeenCalledWith({
      to: "gh-prism:structural",
      id: "id-1",
      request: REQUEST,
    });
  });

  it("rejects with the reason of a signal aborted before the call", async () => {
    const api = fakeApi();
    const controller = new AbortController();
    controller.abort("gone");

    await expect(offscreenEngine(api)(REQUEST, controller.signal)).rejects.toBe("gone");
    expect(api.exists).not.toHaveBeenCalled();
  });

  it("rejects at once on abort while pending, and cancels the request by its id", async () => {
    const response = deferred<EngineResult | undefined>();
    const api = fakeApi({ send: vi.fn(() => response.promise) });
    const controller = new AbortController();

    const pending = offscreenEngine(api)(REQUEST, controller.signal);
    await vi.waitFor(() => expect(api.send).toHaveBeenCalledOnce());
    controller.abort("gone");

    await expect(pending).rejects.toBe("gone");
    expect(api.send).toHaveBeenLastCalledWith({
      to: "gh-prism:structural",
      id: "id-1",
      cancel: true,
    });
  });

  it("swallows the rejected send of a cancel without a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = deferred<EngineResult | undefined>();
    const send = vi.fn((message: ToOffscreen) =>
      "cancel" in message ? Promise.reject(new Error("no receiver")) : response.promise,
    );
    const controller = new AbortController();

    const pending = offscreenEngine(fakeApi({ send }))(REQUEST, controller.signal);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    controller.abort("gone");
    await expect(pending).rejects.toBe("gone");
    await new Promise((r) => setTimeout(r));

    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["exists rejects", { exists: vi.fn(async () => Promise.reject(new Error("x"))) }],
    [
      "create rejects",
      {
        exists: vi.fn(async () => false),
        create: vi.fn(async () => Promise.reject(new Error("x"))),
      },
    ],
    ["send rejects", { send: vi.fn(async () => Promise.reject(new Error("x"))) }],
    ["the document answers nothing", { send: vi.fn(async () => undefined) }],
  ])("resolves a failure with a warning when %s", async (_name, overrides) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await offscreenEngine(fakeApi(overrides))(REQUEST, new AbortController().signal);

    expect(result).toEqual(FAILED);
    expect(warn.mock.calls[0]?.[0]).toMatch(/^gh-prism: /);
  });
});

type Handler = Parameters<OffscreenDeps["listen"]>[0];

function serve(run: EngineRun = vi.fn(async () => RESULT)) {
  let handler!: Handler;
  const cancelClose = vi.fn();
  const deps = {
    run,
    listen: vi.fn((h: Handler) => {
      handler = h;
    }),
    closeWhenIdle: vi.fn((_close: () => void) => cancelClose),
    close: vi.fn(),
  };
  serveOffscreen(deps);
  return {
    deps,
    cancelClose,
    handle: (message: unknown, fromTab = false, respond = vi.fn()) => ({
      handled: handler(message, fromTab, respond),
      respond,
    }),
  };
}

const tagged = (id: string): ToOffscreen => ({ to: "gh-prism:structural", id, request: REQUEST });

describe("serveOffscreen", () => {
  it("ignores a message without its tag, and any message from a tab", () => {
    const { handle, deps } = serve();

    expect(handle({ id: "1", request: REQUEST }).handled).toBe(false);
    expect(handle(tagged("1"), true).handled).toBe(false);
    expect(deps.run).not.toHaveBeenCalled();
  });

  it("runs a tagged request and responds with its result", async () => {
    const { handle } = serve();

    const { handled, respond } = handle(tagged("1"));

    expect(handled).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(RESULT));
  });

  it("responds with a failure when the run rejects", async () => {
    const { handle } = serve(vi.fn(async () => Promise.reject(new Error("x"))));

    const { respond } = handle(tagged("1"));

    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(FAILED));
  });

  it("aborts a request's signal on a matching cancel", () => {
    const run = vi.fn(
      (_request: StructuralRequest, _signal: AbortSignal) => new Promise<EngineResult>(() => {}),
    );
    const { handle } = serve(run);

    handle(tagged("1"));
    handle(tagged("2"));
    handle({ to: "gh-prism:structural", id: "1", cancel: true });

    expect(run.mock.calls[0]?.[1].aborted).toBe(true);
    expect(run.mock.calls[1]?.[1].aborted).toBe(false);
  });

  it("closes when idle only once the last request settles, and cancels that on a new request", async () => {
    const first = deferred<EngineResult>();
    const second = deferred<EngineResult>();
    const run = vi
      .fn<EngineRun>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValue(new Promise(() => {}));
    const { handle, deps, cancelClose } = serve(run);

    const one = handle(tagged("1"));
    handle(tagged("2"));
    first.resolve(RESULT);
    await vi.waitFor(() => expect(one.respond).toHaveBeenCalled());
    expect(deps.closeWhenIdle).not.toHaveBeenCalled();

    second.resolve(RESULT);
    await vi.waitFor(() => expect(deps.closeWhenIdle).toHaveBeenCalledOnce());
    deps.closeWhenIdle.mock.calls[0]?.[0]();
    expect(deps.close).toHaveBeenCalledOnce();

    handle(tagged("3"));
    expect(cancelClose).toHaveBeenCalledOnce();
  });
});
