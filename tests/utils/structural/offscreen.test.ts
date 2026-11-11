import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineResult } from "../../../utils/structural/engine";
import {
  type OffscreenApi,
  type OffscreenDeps,
  offscreenEngine,
  serveOffscreen,
  type ToOffscreen,
} from "../../../utils/structural/offscreen";
import type { EngineRun, StructuralRequest } from "../../../utils/structural/request";
import { FAILED, REQUEST, RESULT } from "../../fixtures/structural-request";

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

  it("shares one pending creation between overlapping requests", async () => {
    const created = Promise.withResolvers<void>();
    const api = fakeApi({ exists: vi.fn(async () => false), create: vi.fn(() => created.promise) });
    const run = offscreenEngine(api);

    const first = run(REQUEST, new AbortController().signal);
    const second = run(REQUEST, new AbortController().signal);
    created.resolve();
    await Promise.all([first, second]);

    expect(api.create).toHaveBeenCalledOnce();
    expect(api.send).toHaveBeenCalledTimes(2);
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

  it("sends nothing for a request aborted while the document is being created", async () => {
    const created = Promise.withResolvers<void>();
    const api = fakeApi({ exists: vi.fn(async () => false), create: vi.fn(() => created.promise) });
    const controller = new AbortController();

    const pending = offscreenEngine(api)(REQUEST, controller.signal);
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    controller.abort("gone");
    await expect(pending).rejects.toBe("gone");
    created.resolve();
    await new Promise((r) => setTimeout(r));

    expect(api.send).not.toHaveBeenCalled();
  });

  it("rejects at once on abort while pending, and cancels the request by its id", async () => {
    const response = Promise.withResolvers<EngineResult | undefined>();
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
    const response = Promise.withResolvers<EngineResult | undefined>();
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

  it("recreates a document that closed before answering, and sends once more", async () => {
    const api = fakeApi({
      exists: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      send: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(RESULT),
    });

    const result = await offscreenEngine(api)(REQUEST, new AbortController().signal);

    expect(result).toBe(RESULT);
    expect(api.create).toHaveBeenCalledOnce();
    expect(api.send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["exists rejects", { exists: vi.fn(async () => Promise.reject(new Error("x"))) }, 0],
    [
      "create rejects",
      {
        exists: vi.fn(async () => false),
        create: vi.fn(async () => Promise.reject(new Error("x"))),
      },
      0,
    ],
    ["send rejects twice", { send: vi.fn(async () => Promise.reject(new Error("x"))) }, 2],
    ["the document answers nothing twice", { send: vi.fn(async () => undefined) }, 2],
  ])("resolves a failure with a warning when %s", async (_name, overrides, sends) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = fakeApi(overrides);

    const result = await offscreenEngine(api)(REQUEST, new AbortController().signal);

    expect(result).toEqual(FAILED);
    expect(api.send).toHaveBeenCalledTimes(sends);
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

  it("responds with a failure and a warning when the run rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handle } = serve(vi.fn(async () => Promise.reject(new Error("x"))));

    const { respond } = handle(tagged("1"));

    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(FAILED));
    expect(warn.mock.calls[0]?.[0]).toMatch(/^gh-prism: /);
  });

  it("responds with a failure and no warning when a cancelled run rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn(
      (_request: StructuralRequest, signal: AbortSignal) =>
        new Promise<EngineResult>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    );
    const { handle } = serve(run);

    const { respond } = handle(tagged("1"));
    handle({ to: "gh-prism:structural", id: "1", cancel: true });

    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith(FAILED));
    expect(warn).not.toHaveBeenCalled();
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

  it("schedules the idle close at start, and cancels it on the first request", () => {
    const { handle, deps, cancelClose } = serve();

    const scheduledBeforeAnyMessage = deps.closeWhenIdle.mock.calls.length;
    handle(tagged("1"));

    expect(scheduledBeforeAnyMessage).toBe(1);
    expect(cancelClose).toHaveBeenCalledOnce();
  });

  it("closes when idle only once the last request settles, and cancels that on a new request", async () => {
    const first = Promise.withResolvers<EngineResult>();
    const second = Promise.withResolvers<EngineResult>();
    const run = vi
      .fn<EngineRun>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValue(new Promise(() => {}));
    const { handle, deps, cancelClose } = serve(run);
    deps.closeWhenIdle.mockClear();

    const one = handle(tagged("1"));
    handle(tagged("2"));
    cancelClose.mockClear();
    first.resolve(RESULT);
    await vi.waitFor(() => expect(one.respond).toHaveBeenCalled());
    expect(deps.closeWhenIdle).not.toHaveBeenCalled();
    second.resolve(RESULT);
    await vi.waitFor(() => expect(deps.closeWhenIdle).toHaveBeenCalledOnce());
    deps.closeWhenIdle.mock.calls[0]?.[0]();
    handle(tagged("3"));

    expect(deps.close).toHaveBeenCalledOnce();
    expect(cancelClose).toHaveBeenCalledOnce();
  });
});
