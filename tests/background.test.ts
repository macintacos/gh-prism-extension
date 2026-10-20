import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import background from "../entrypoints/background";
import { PR_DATA_PORT, type PrDataPort } from "../utils/github/pr-port";
import { whatsNewSeen } from "../utils/prefs";

type Serve = (port: PrDataPort & { readonly name: string }) => void;

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
    // fakeBrowser leaves runtime.getManifest unmocked.
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "gh-prism",
      version: "0.4.0",
    });
    // fakeBrowser leaves runtime.onConnect unimplemented: its addListener throws.
    vi.spyOn(fakeBrowser.runtime.onConnect, "addListener").mockImplementation((listener) => {
      serve = listener as Serve;
    });
    background.main();
  });

  afterEach(() => vi.restoreAllMocks());

  // Chrome refires onInstalled with reason "update" on a dev reload.
  it.each([{ reason: "install" }, { reason: "update", previousVersion: "0.0.0" }] as const)(
    "forgets cached sections on $reason",
    async (details) => {
      // Raw keys on purpose, so the test outlives a move to typed storage items.
      const stored = {
        "intent.v1": ["k"],
        "intent.v1:k": {},
        "intent.v2": ["k"],
        "intent.v2:k": {},
        unrelated: 1,
      };
      await fakeBrowser.storage.local.set(stored);
      await fakeBrowser.runtime.onInstalled.trigger(details);

      // The listener floats forgetIntents' promise, so trigger cannot await it.
      await vi.waitFor(async () =>
        expect(await fakeBrowser.storage.local.get(Object.keys(stored))).toEqual({ unrelated: 1 }),
      );
    },
  );

  it("marks a fresh install's notes dismissed", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });

    await vi.waitFor(async () =>
      expect(await whatsNewSeen.getValue()).toEqual({ dismissed: "0.4.0" }),
    );
  });

  it("leaves the notes to show after an update", async () => {
    const setValue = vi.spyOn(whatsNewSeen, "setValue");

    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "0.3.2" });

    expect(setValue).not.toHaveBeenCalled();
  });

  it("serves the PR data port", () => {
    const port = fakePort(PR_DATA_PORT);
    serve(port);
    expect(port.onMessage.addListener).toHaveBeenCalledOnce();
  });

  it("ignores any other port", () => {
    const port = fakePort("other");
    serve(port);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
    expect(port.onDisconnect.addListener).not.toHaveBeenCalled();
  });
});
