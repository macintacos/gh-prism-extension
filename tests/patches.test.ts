import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const treesEntry = fileURLToPath(import.meta.resolve("@pierre/trees"));
const treesDist = dirname(treesEntry);
// bun doesn't hoist preact, so resolve it from @pierre/trees, its only importer. require
// resolution lands on dist/preact.js; the bundler imports its ESM sibling.
const bundledPreact = join(dirname(createRequire(treesEntry).resolve("preact")), "preact.mjs");

describe("patches", () => {
  it("bundles a Preact whose diff never assigns innerHTML", () => {
    expect(readFileSync(bundledPreact, "utf8")).not.toContain("innerHTML");
  });

  it("bundles a @pierre/trees that never passes dangerouslySetInnerHTML, which patched Preact ignores", () => {
    // gh-prism never imports the React entry, the one file that passes it.
    const passing = readdirSync(treesDist, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".js") && !path.startsWith(`react${sep}`))
      .filter((path) =>
        readFileSync(join(treesDist, path), "utf8").includes("dangerouslySetInnerHTML"),
      );

    expect(passing).toEqual([]);
  });
});
