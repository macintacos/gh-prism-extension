import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ENGINE_SCRIPT } from "../../../utils/structural/engine-script";
import { loadEngineThread } from "../../../utils/structural/engine-thread";
import { REQUEST } from "../../fixtures/structural-request";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("loadEngineThread in Firefox", () => {
  it("constructs one Worker on the engine script at the first request", async () => {
    vi.stubEnv("BROWSER", "firefox");
    const urls: string[] = [];
    const postMessage = vi.fn();
    vi.stubGlobal(
      "Worker",
      class {
        onmessage = null;
        onerror = null;
        postMessage = postMessage;
        terminate = vi.fn();
        constructor(url: string) {
          urls.push(url);
        }
      },
    );

    const run = await loadEngineThread();
    const urlsBeforeRequests = [...urls];

    void run(REQUEST, new AbortController().signal);
    void run(REQUEST, new AbortController().signal);

    expect(urlsBeforeRequests).toEqual([]);
    expect(urls).toHaveLength(1);
    expect(urls[0]?.endsWith(ENGINE_SCRIPT)).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
});

describe("loadEngineThread in Chrome", () => {
  function stubOffscreen() {
    const createDocument = vi.fn(async () => {});
    const getContexts = vi.fn(async () => []);
    const sendMessage = vi.fn(async () => ({ ok: false, reason: "unsupported" }));
    // fakeBrowser has no offscreen namespace, leaves getContexts unimplemented, and types
    // sendMessage's response as void.
    Object.assign(fakeBrowser, { offscreen: { createDocument } });
    Object.assign(fakeBrowser.runtime, { getContexts, sendMessage });
    return { createDocument, getContexts, sendMessage };
  }

  it("creates the offscreen document at the first request", async () => {
    const { createDocument } = stubOffscreen();

    const run = await loadEngineThread();
    await run(REQUEST, new AbortController().signal);

    expect(createDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        url: expect.stringMatching(/\/structural-offscreen\.html$/),
        reasons: ["WORKERS"],
      }),
    );
  });

  it("calls nothing until a request arrives", async () => {
    const { createDocument, getContexts, sendMessage } = stubOffscreen();

    await loadEngineThread();

    expect(createDocument).not.toHaveBeenCalled();
    expect(getContexts).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
