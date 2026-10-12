import { describe, expect, it } from "vitest";
import { SECTION_CATALOG } from "../entrypoints/content/section-catalog";
import { SECTIONS } from "../utils/sections";

describe("SECTION_CATALOG", () => {
  it("gives every section an icon, a description, and a collapse default", () => {
    for (const { key } of SECTIONS) {
      expect(SECTION_CATALOG[key]).toEqual({
        icon: expect.stringMatching(/\S/),
        description: expect.stringMatching(/\S/),
        startsCollapsed: expect.any(Boolean),
      });
    }
  });
});
