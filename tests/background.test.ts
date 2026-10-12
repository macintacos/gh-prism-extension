import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import background from "../entrypoints/background";
import { PR_DATA_PORT } from "../utils/pr-port";

type Serve = Parameters<typeof fakeBrowser.runtime.onConnect.addListener>[0];

const fakePort = (name: string) => ({
  name,
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() },
});

describe("background", () => {
  let serve: Serve;

  beforeEach(() => {
    fakeBrowser.reset();
    // fakeBrowser leaves runtime.onConnect unimplemented: its addListener throws.
    vi.spyOn(fakeBrowser.runtime.onConnect, "addListener").mockImplementation((listener) => {
      serve = listener;
    });
    background.main();
  });
  afterEach(() => vi.restoreAllMocks());

  // Chrome refires onInstalled with reason "update" on a dev reload.
  it.each([{ reason: "install" }, { reason: "update", previousVersion: "0.0.0" }] as const)(
    "forgets cached sections on $reason",
    async (details) => {
      await fakeBrowser.storage.local.set({ "intent.v1": ["k"], "intent.v1:k": {}, unrelated: 1 });
      await fakeBrowser.runtime.onInstalled.trigger(details);
      // The listener floats forgetIntents' promise, so trigger cannot await it.
      await vi.waitFor(async () =>
        expect(await fakeBrowser.storage.local.get()).toEqual({ unrelated: 1 }),
      );
    },
  );

  it("serves the PR data port", () => {
    const port = fakePort(PR_DATA_PORT);
    serve(port as never);
    expect(port.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("ignores any other port", () => {
    const port = fakePort("other");
    serve(port as never);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
    expect(port.onDisconnect.addListener).not.toHaveBeenCalled();
  });
});
