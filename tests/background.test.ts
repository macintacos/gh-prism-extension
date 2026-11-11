import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import background from "../entrypoints/background";
import { CONVERSATION_FRAME_PORT } from "../utils/github/conversation-frame";
import { PR_DATA_PORT, type PrDataPort } from "../utils/github/pr-port";
import { whatsNewSeen } from "../utils/prefs";

type Serve = (
  port: PrDataPort & { readonly name: string; readonly sender?: { tab?: { id?: number } } },
) => void;

const fakePort = (name: string) => ({
  name,
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() },
});

describe("background", () => {
  let serve: Serve;
  let updateSessionRules: MockInstance;
  let onConnect: MockInstance;
  const addEventListener = vi.fn();

  beforeEach(() => {
    fakeBrowser.reset();
    addEventListener.mockClear();
    vi.stubGlobal("addEventListener", addEventListener);
    // fakeBrowser leaves runtime.getManifest unmocked.
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "gh-prism",
      version: "0.4.0",
    });
    // fakeBrowser leaves runtime.onConnect unimplemented: its addListener throws.
    onConnect = vi
      .spyOn(fakeBrowser.runtime.onConnect, "addListener")
      .mockImplementation((listener) => {
        serve = listener as Serve;
      });
    // fakeBrowser leaves declarativeNetRequest unmocked.
    updateSessionRules = vi
      .spyOn(fakeBrowser.declarativeNetRequest, "updateSessionRules")
      .mockResolvedValue(undefined);
    background.main();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(["chrome", "firefox"])("registers no install listener in %s", (browser) => {
    vi.stubEnv("BROWSER", browser);
    addEventListener.mockClear();

    background.main();

    expect(addEventListener).not.toHaveBeenCalledWith("install", expect.anything());
  });

  describe("over the PR data port", () => {
    const sha = "a".repeat(40);
    const pr = { kind: "commit", owner: "o", repo: "r", headSha: sha };
    const diff =
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1;\n+const a = 2;\n";
    const constructed = vi.fn();
    const createDocument = vi.fn();
    const getContexts = vi.fn(async () => []);

    beforeEach(() => {
      constructed.mockClear();
      createDocument.mockClear();
      getContexts.mockClear();
      vi.stubGlobal(
        "Worker",
        class {
          constructor() {
            constructed();
          }
        },
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          String(url).endsWith(".diff")
            ? new Response(diff)
            : new Response(String(url).includes("/raw/") ? "const a = 2;\n" : ""),
        ),
      );
      vi.stubGlobal("scheduler", { postTask: async (task: () => void) => task() });
      // fakeBrowser has no offscreen namespace and leaves getContexts unimplemented.
      Object.assign(fakeBrowser, { offscreen: { createDocument } });
      Object.assign(fakeBrowser.runtime, { getContexts });
    });

    /** Sends each request over a fresh PR data port and waits for every reply. */
    async function send(...requests: unknown[]) {
      const port = fakePort(PR_DATA_PORT);
      serve(port);
      const [listen] = port.onMessage.addListener.mock.calls[0] ?? [];
      for (const [id, request] of requests.entries()) listen({ id, request });
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(requests.length));
    }

    it("starts no structural engine for its other requests", async () => {
      await send(
        { kind: "files", pr },
        { kind: "content", pr, path: "src/a.ts" },
        { kind: "prefix", pr, path: "src/a.ts" },
      );

      expect(constructed).not.toHaveBeenCalled();
      expect(createDocument).not.toHaveBeenCalled();
      expect(getContexts).not.toHaveBeenCalled();
      expect(onConnect).toHaveBeenCalledOnce();
    });

    it("starts the engine for a structural request", async () => {
      const port = fakePort(PR_DATA_PORT);
      serve(port);
      const [listen] = port.onMessage.addListener.mock.calls[0] ?? [];

      listen({ id: 0, request: { kind: "structural", pr, path: "src/a.ts" } });

      await vi.waitFor(() => expect(getContexts).toHaveBeenCalled());
    });
  });

  // Chrome refires onInstalled with reason "update" on a dev reload.
  it.each([{ reason: "install" }, { reason: "update", previousVersion: "0.0.0" }] as const)(
    "forgets cached sections and retired keys on $reason",
    async (details) => {
      // Raw keys on purpose, so the test outlives a move to typed storage items.
      const stored = {
        "intent.v1": ["k"],
        "intent.v1:k": {},
        "intent.v2": ["k"],
        "intent.v2:k": {},
        hiddenCommitMessages: { "o/r@abc": true },
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

  it("lets the Conversation panel's port frame its pull request", async () => {
    const port = { ...fakePort(CONVERSATION_FRAME_PORT), sender: { tab: { id: 4 } } };
    serve(port);
    const [send] = port.onMessage.addListener.mock.calls[0] ?? [];

    await send({
      pr: { kind: "pr", owner: "o", repo: "r", number: 1 },
      policy: "default-src 'none'",
    });

    expect(updateSessionRules).toHaveBeenCalledWith(
      expect.objectContaining({ removeRuleIds: [4], addRules: [expect.anything()] }),
    );
  });

  it("revokes a closed tab's framing rule", async () => {
    await fakeBrowser.tabs.onRemoved.trigger(4, { windowId: 1, isWindowClosing: false });

    expect(updateSessionRules).toHaveBeenCalledWith({ removeRuleIds: [4] });
  });

  it("ignores any other port", () => {
    const port = fakePort("other");
    serve(port);
    expect(port.onMessage.addListener).not.toHaveBeenCalled();
    expect(port.onDisconnect.addListener).not.toHaveBeenCalled();
  });
});
