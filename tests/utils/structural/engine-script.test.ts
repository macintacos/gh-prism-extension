// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENGINE_GLOBAL,
  ENGINE_SCRIPT,
  loadEngineScript,
  precacheEngineScript,
  yieldToMessages,
} from "../../../utils/structural/engine-script";

const entry = vi.fn();
const global = globalThis as Record<string, unknown>;

afterEach(() => {
  delete global[ENGINE_GLOBAL];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("precacheEngineScript", () => {
  it("imports the engine script while a Chrome worker installs", () => {
    const addEventListener = vi.fn();
    const importScripts = vi.fn();
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal("importScripts", importScripts);

    precacheEngineScript();

    expect(addEventListener).toHaveBeenCalledOnce();
    const [type, listener] = addEventListener.mock.calls[0] ?? [];
    expect(type).toBe("install");
    listener();
    expect(importScripts).toHaveBeenCalledWith(expect.stringMatching(`${ENGINE_SCRIPT}$`));
  });

  it("warns instead of throwing when the install-time import fails", () => {
    const addEventListener = vi.fn();
    const error = new Error("blocked");
    vi.stubGlobal("addEventListener", addEventListener);
    vi.stubGlobal(
      "importScripts",
      vi.fn(() => {
        throw error;
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    precacheEngineScript();
    const [, listener] = addEventListener.mock.calls[0] ?? [];

    expect(() => listener()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gh-prism:"), error);
  });

  it("registers nothing in Firefox", () => {
    vi.stubEnv("BROWSER", "firefox");
    const addEventListener = vi.fn();
    vi.stubGlobal("addEventListener", addEventListener);

    precacheEngineScript();

    expect(addEventListener).not.toHaveBeenCalled();
  });
});

describe("loadEngineScript", () => {
  it("imports the script in Chrome and returns the entry it sets", async () => {
    const importScripts = vi.fn(() => {
      global[ENGINE_GLOBAL] = entry;
    });
    vi.stubGlobal("importScripts", importScripts);

    await expect(loadEngineScript()).resolves.toBe(entry);
    expect(importScripts).toHaveBeenCalledWith(expect.stringMatching(`${ENGINE_SCRIPT}$`));
  });

  it("returns an entry already set without importing again", async () => {
    const importScripts = vi.fn();
    vi.stubGlobal("importScripts", importScripts);
    global[ENGINE_GLOBAL] = entry;

    await expect(loadEngineScript()).resolves.toBe(entry);
    expect(importScripts).not.toHaveBeenCalled();
  });

  it("rejects when the script sets no entry", async () => {
    vi.stubGlobal("importScripts", vi.fn());

    await expect(loadEngineScript()).rejects.toThrow("set no entry");
  });

  it("appends the script in Firefox and returns the entry once it loads", async () => {
    vi.stubEnv("BROWSER", "firefox");
    // Kept off the real head: happy-dom fails every script it is asked to fetch.
    const append = vi.spyOn(document.head, "append").mockImplementation(() => {});

    const loaded = loadEngineScript();
    expect(append).toHaveBeenCalledOnce();
    const [script] = append.mock.calls[0] ?? [];
    expect(script).toBeInstanceOf(HTMLScriptElement);
    expect((script as HTMLScriptElement).src.endsWith(ENGINE_SCRIPT)).toBe(true);
    global[ENGINE_GLOBAL] = entry;
    (script as HTMLScriptElement).dispatchEvent(new Event("load"));

    await expect(loaded).resolves.toBe(entry);
  });

  it("removes a Firefox script that fails to load", async () => {
    vi.stubEnv("BROWSER", "firefox");
    const append = vi.spyOn(document.head, "append").mockImplementation(() => {});

    const loaded = loadEngineScript();
    const [script] = append.mock.calls[0] ?? [];
    const remove = vi.spyOn(script as HTMLScriptElement, "remove");
    (script as HTMLScriptElement).dispatchEvent(new Event("error"));

    await expect(loaded).rejects.toThrow("failed to load");
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe("yieldToMessages", () => {
  it("posts a background-priority task in Chrome", async () => {
    const postTask = vi.fn(async () => {});
    vi.stubGlobal("scheduler", { postTask });

    await yieldToMessages();

    expect(postTask).toHaveBeenCalledWith(expect.any(Function), { priority: "background" });
  });

  it("waits a 4 ms timer in Firefox", async () => {
    vi.stubEnv("BROWSER", "firefox");
    vi.useFakeTimers();
    let done = false;

    const yielded = yieldToMessages().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(3);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await yielded;

    expect(done).toBe(true);
  });
});
