import { describe, expect, it } from "vitest";
import { nextVersion } from "../../../../scripts/tasks/release/version";

describe("nextVersion", () => {
  it.each([
    ["patch", "0.0.2"],
    ["minor", "0.1.0"],
    ["major", "1.0.0"],
  ] as const)("applies a %s bump", (bump, expected) => {
    expect(nextVersion("0.0.1", bump)).toBe(expected);
  });

  it("throws on an invalid current version", () => {
    expect(() => nextVersion("not-a-version", "patch")).toThrow();
  });
});
