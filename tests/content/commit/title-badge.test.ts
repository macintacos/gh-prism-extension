import { describe, expect, it } from "vitest";
import { parseConventionalTitle } from "../../../entrypoints/content/commit/title-badge";

describe("parseConventionalTitle", () => {
  it.each([
    ["feat", "Feature"],
    ["fix", "Fix"],
    ["chore", "Chore"],
    ["revert", "Revert"],
    ["style", "Style"],
    ["docs", "Docs"],
    ["build", "Build"],
    ["refactor", "Refactor"],
    ["test", "Test"],
    ["ci", "CI"],
    ["perf", "Performance"],
  ])("labels a %s title %s", (type, label) => {
    expect(parseConventionalTitle(`${type}: tidy the parser`)).toEqual({
      type,
      label,
      scope: undefined,
      rest: "tidy the parser",
    });
  });

  it("reads the scope from its parentheses", () => {
    expect(parseConventionalTitle("fix(cli): skip the cleanup")).toEqual({
      type: "fix",
      label: "Fix",
      scope: "cli",
      rest: "skip the cleanup",
    });
  });

  it.each([
    ["feat!: drop Node 18", undefined],
    ["feat(api)!: drop Node 18", "api"],
  ])("marks the breaking change in %s on the label", (title, scope) => {
    expect(parseConventionalTitle(title)).toEqual({
      type: "feat",
      label: "Feature!",
      scope,
      rest: "drop Node 18",
    });
  });

  it("reads a type in any case", () => {
    expect(parseConventionalTitle("Fix: skip the cleanup")).toMatchObject({
      type: "fix",
      label: "Fix",
    });
  });

  it("takes a description that follows the colon with no space", () => {
    expect(parseConventionalTitle("fix:skip the cleanup")?.rest).toBe("skip the cleanup");
  });

  it.each([
    ["an unknown type", "wip: try the new parser"],
    ["no colon", "fix the parser"],
    ["a type after other words", "Merge fix: the parser"],
    ["a prefix with no description", "chore: "],
    ["a bare prefix", "chore(deps):"],
    ["an empty scope", "fix(): the parser"],
  ])("reads no conventional title from %s", (_, title) => {
    expect(parseConventionalTitle(title)).toBeUndefined();
  });
});
