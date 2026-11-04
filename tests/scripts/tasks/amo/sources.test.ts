import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sourcesZipProblems } from "../../../../scripts/tasks/amo/sources";

const REQUIRED = ["bun.lock", "package.json", "README.md", "LICENSE", "mise.lock"];
const PATCH = "patches/wxt@0.21.4.patch";
const tracked = [...REQUIRED, PATCH, "src/a.ts"];

describe("sourcesZipProblems", () => {
  it("finds nothing when the zip holds every tracked file", () => {
    expect(sourcesZipProblems(tracked, tracked)).toEqual([]);
  });

  it("names an entry git doesn't track", () => {
    const problems = sourcesZipProblems([...tracked, "notes.txt"], tracked);

    expect(problems).toEqual(["sources zip holds files git doesn't track: notes.txt"]);
  });

  it("names a missing lockfile and a missing patch", () => {
    const entries = tracked.filter((path) => path !== "bun.lock" && path !== PATCH);

    expect(sourcesZipProblems(entries, tracked)).toEqual([`sources zip lacks: bun.lock, ${PATCH}`]);
  });

  it("ignores directory entries", () => {
    expect(sourcesZipProblems([...tracked, "src/", "patches/"], tracked)).toEqual([]);
  });
});

it("README names mise.lock's Bun and Node", () => {
  const lock = readFileSync("mise.lock", "utf8");
  const pinned = (tool: string) =>
    new RegExp(`\\[\\[tools\\.${tool}\\]\\]\\nversion = "([^"]+)"`).exec(lock)?.[1];

  const readme = readFileSync("README.md", "utf8");

  expect(readme).toContain(`Bun ${pinned("bun")}`);
  expect(readme).toContain(`Node ${pinned("node")}`);
});
