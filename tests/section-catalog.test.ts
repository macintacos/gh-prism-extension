import { describe, expect, it } from "vitest";
import { SECTION_CATALOG } from "../entrypoints/content/section-catalog";
import { SECTIONS } from "../utils/sections";

describe("SECTION_CATALOG", () => {
  it("gives every section a label, an icon, a description, a hue, and a collapse default", () => {
    for (const key of SECTIONS) {
      expect(SECTION_CATALOG[key], key).toEqual({
        label: expect.stringMatching(/\S/),
        icon: expect.stringMatching(/\S/),
        description: expect.stringMatching(/\S/),
        hue: expect.stringMatching(/^--fgColor-[a-z]+$/),
        startsCollapsed: expect.any(Boolean),
      });
    }
  });
});
