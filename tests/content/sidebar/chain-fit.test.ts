// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { chainRule, fitChain } from "../../../entrypoints/content/sidebar/chain-fit";

// managed, / dot_config, / opencode, / skills, / sentry-cli
const SENTRY = [60, 80, 70, 50, 80];
const ELLIPSIS = 20;

describe("fitChain", () => {
  it.each([
    ["a chain that fits shows everything", SENTRY, 340, { first: true, from: 1 }],
    ["room for the first, …, and two trailing folders", SENTRY, 250, { first: true, from: 3 }],
    ["room for the first, …, and the deepest", SENTRY, 170, { first: true, from: 4 }],
    ["less room keeps the deepest alone", SENTRY, 100, { first: false, from: 4 }],
    ["a two-folder chain that doesn't fit", [60, 80], 100, { first: false, from: 1 }],
  ])("%s", (_, units, room, fit) => {
    expect(fitChain(units, ELLIPSIS, room)).toEqual(fit);
  });
});

describe("chainRule", () => {
  const row = "a/b/c/d/";
  const units = ["a/", "a/b/", "a/b/c/", "a/b/c/d/"];
  const at = `[data-type="item"][data-item-path="${CSS.escape(row)}"]`;
  const unit = (path: string) => `${at} [data-item-flattened-subitem="${CSS.escape(path)}"]`;

  it("hides the middle folders and shows the …", () => {
    expect(chainRule(row, units, { first: true, from: 3 })).toBe(
      `${unit("a/b/")},${unit("a/b/c/")}{position:absolute;visibility:hidden}` +
        `${at} [data-item-flattened-ellipsis]{position:static;visibility:visible}`,
    );
  });

  it("hides the first folder and the …'s separator", () => {
    expect(chainRule(row, units, { first: false, from: 3 })).toBe(
      `${unit("a/")},${unit("a/b/")},${unit("a/b/c/")}{position:absolute;visibility:hidden}` +
        `${at} [data-item-flattened-ellipsis]{position:static;visibility:visible}` +
        `${at} [data-item-flattened-ellipsis]>[data-item-flattened-separator]{position:absolute;visibility:hidden}`,
    );
  });

  it("writes nothing for a chain that fits", () => {
    expect(chainRule(row, units, { first: true, from: 1 })).toBe("");
  });
});
