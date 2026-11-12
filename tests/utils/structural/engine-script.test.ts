import { afterEach, describe, expect, it, vi } from "vitest";
import { yieldToMessages } from "../../../utils/structural/engine-script";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
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
