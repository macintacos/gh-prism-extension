import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import { FETCHED_WASM, WASM_SOURCES } from "../utils/structural/packaged";

const lines = readFileSync(
  new URL("../public/third-party-notices.txt", import.meta.url),
  "utf8",
).split("\n");
const pinned: Record<string, string> = { ...packageJson.dependencies };
const BUNDLED: readonly (readonly [name: string, version: string | undefined])[] = [
  ...[...new Set(WASM_SOURCES.map(([pkg]) => pkg)), "diff"].map(
    (name) => [name, pinned[name]] as const,
  ),
  ...FETCHED_WASM.map(({ pkg, version }) => [pkg, version] as const),
];

describe("third-party notices", () => {
  it.each(BUNDLED)("heads a section for %s at the version gh-prism pins", (name, version) => {
    expect(lines).toContain(`${name} ${version}`);
  });

  it("gives every section but diff's BSD one the MIT grant, which lets gh-prism redistribute it", () => {
    const sections = lines
      .join("\n")
      .split(/^={80}$/m)
      .slice(1);
    const mit = sections.filter((section) => !section.startsWith("\ndiff "));

    expect(sections).toHaveLength(BUNDLED.length);
    for (const section of mit)
      expect(section).toContain("Permission is hereby granted, free of charge");
  });
});
