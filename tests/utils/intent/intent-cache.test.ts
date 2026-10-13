import { describe, expect, it, vi } from "vitest";
import type { FileLines, IntentResult } from "../../../utils/intent/intent";
import {
  forgetIntents,
  type IntentStorage,
  storedIntents,
} from "../../../utils/intent/intent-cache";

/** Storage that, like chrome.storage, keeps a JSON copy of each value. */
function jsonStorage(): IntentStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key) => {
      const value = values.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    setItem: async (key, value) => {
      values.set(key, JSON.stringify(value));
    },
    removeItems: async (keys) => {
      for (const key of keys) values.delete(key);
    },
  };
}

const landed: Extract<IntentResult, { ok: true }> = {
  ok: true,
  placements: new Map([
    ["README.md", { kind: "whole", section: "docs" }],
    [
      "src/render.rs",
      {
        kind: "split",
        shares: [
          {
            section: "implementation",
            hunks: [{ first: 4, last: 9 }],
            lines: { added: 3, removed: 1 },
          },
          { section: "docs", hunks: [undefined], lines: { added: 0, removed: 2 } },
        ],
      },
    ],
  ]),
  lines: new Map<string, FileLines>([
    ["README.md", { added: 1, removed: 1 }],
    ["src/render.rs", { added: 3, removed: 3 }],
    ["logo.png", "binary"],
  ]),
};

describe("storedIntents", () => {
  it("gives back a stored result, with its maps and hunks that have no head lines", async () => {
    const cache = storedIntents(jsonStorage(), 10);
    await cache.set("a", landed);
    expect(await cache.get("a")).toEqual(landed);
  });

  it("misses a key it hasn't stored", async () => {
    const cache = storedIntents(jsonStorage(), 10);
    await cache.set("a", landed);
    expect(await cache.get("b")).toBeUndefined();
  });

  it("keeps only the most recently stored results, up to its limit", async () => {
    const cache = storedIntents(jsonStorage(), 2);
    for (const key of ["a", "b", "c", "b"]) await cache.set(key, landed);
    const kept = [];
    for (const key of ["a", "b", "c"]) if (await cache.get(key)) kept.push(key);
    expect(kept).toEqual(["b", "c"]);
  });

  it("misses a stored entry whose placements it can't read", async () => {
    const storage = jsonStorage();
    const cache = storedIntents(storage, 10);
    await cache.set("a", landed);
    for (const [key, value] of storage.values)
      storage.values.set(key, value.replace('"whole"', '"sideways"'));
    expect(await cache.get("a")).toBeUndefined();
  });

  it("misses, and logs, when storage fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = storedIntents(
      { ...jsonStorage(), getItem: () => Promise.reject(new Error("quota")) },
      10,
    );
    expect(await cache.get("a")).toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("forgetIntents", () => {
  it("leaves nothing of what storedIntents kept", async () => {
    const storage = jsonStorage();
    const cache = storedIntents(storage, 10);
    await cache.set("a", landed);
    await cache.set("b", landed);
    await forgetIntents(storage);
    expect(await cache.get("a")).toBeUndefined();
    expect(storage.values.size).toBe(0);
  });
});
