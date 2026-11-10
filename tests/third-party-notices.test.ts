import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { WASM_SOURCES } from "../utils/structural/packaged";

const BUNDLED = [
  "web-tree-sitter",
  "tree-sitter-typescript",
  "tree-sitter-javascript",
  "tree-sitter-python",
  "diff",
] as const;

const lines = readFileSync(
  new URL("../public/third-party-notices.txt", import.meta.url),
  "utf8",
).split("\n");
const versions: Record<string, string> = { ...packageJson.dependencies };

describe("third-party notices", () => {
  it.each(BUNDLED)("heads a section for %s at the version package.json pins", (name) => {
    expect(lines).toContain(`${name} ${versions[name]}`);
  });

  it("covers every package the engine's WebAssembly comes from", () => {
    const headed = new Set(lines.map((line) => line.split(" ")[0]));
    for (const [pkg] of WASM_SOURCES) expect(headed).toContain(pkg);
  });
});
