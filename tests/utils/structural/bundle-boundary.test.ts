import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ENGINE_FROM_CONTENT_SIDE = [
  "../structural/outline",
  "../structural/engine",
  "../structural/runner",
  "../structural/tokens",
  "web-tree-sitter",
];

/**
 * The modules each file may import only as types, lest the engine land in the background or
 * content bundle.
 */
const TYPE_ONLY: readonly (readonly [file: string, modules: readonly string[]])[] = [
  ["utils/hunk-rules/head-scan.ts", ENGINE_FROM_CONTENT_SIDE],
  ["utils/hunk-rules/inline-tests.ts", ENGINE_FROM_CONTENT_SIDE],
  ["utils/intent/read.ts", ENGINE_FROM_CONTENT_SIDE],
  ["utils/structural/host.ts", ["./engine", "./runner", "./tokens", "web-tree-sitter"]],
  ["utils/structural/engine-script.ts", ["./engine", "./runner", "./tokens", "web-tree-sitter"]],
  [
    "entrypoints/background.ts",
    [
      "../utils/structural/engine",
      "../utils/structural/runner",
      "../utils/structural/tokens",
      "../utils/structural/host",
      "web-tree-sitter",
    ],
  ],
];

/** The specifiers of `source`'s value imports, skipping `import type`. */
function valueImports(source: string): string[] {
  return [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gms)].map(
    ([, specifier]) => specifier ?? "",
  );
}

describe("the background and content bundles", () => {
  it.each(TYPE_ONLY)("%s imports the engine side only as types", (file, modules) => {
    const imported = valueImports(readFileSync(file, "utf8"));

    expect(imported.filter((specifier) => modules.includes(specifier))).toEqual([]);
  });
});
