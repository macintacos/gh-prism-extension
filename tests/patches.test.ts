import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// bun doesn't hoist preact, so resolve it from the package that imports it.
const preactEntry = createRequire(fileURLToPath(import.meta.resolve("@pierre/trees"))).resolve(
  "preact",
);

describe("patches", () => {
  it("bundles a Preact whose diff never assigns innerHTML", () => {
    // require resolution picks dist/preact.js; the bundle imports its ESM sibling.
    const bundled = join(dirname(preactEntry), "preact.mjs");

    expect(readFileSync(bundled, "utf8")).not.toContain("innerHTML");
  });
});
