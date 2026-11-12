import { describe, expect, it, vi } from "vitest";
import { retriedOnFailure } from "../../../utils/structural/retried";

describe("retriedOnFailure", () => {
  it("loads once and shares the result", async () => {
    const load = vi.fn(async () => 1);
    const get = retriedOnFailure(load);

    await expect(get()).resolves.toBe(1);
    await expect(get()).resolves.toBe(1);
    expect(load).toHaveBeenCalledOnce();
  });

  it("loads again after a rejection", async () => {
    const load = vi.fn(async () => 1).mockRejectedValueOnce(new Error("no"));
    const get = retriedOnFailure(load);

    await expect(get()).rejects.toThrow("no");
    await expect(get()).resolves.toBe(1);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
