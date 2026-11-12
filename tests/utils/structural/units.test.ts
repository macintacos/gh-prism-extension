import { describe, expect, it } from "vitest";
import { lineStarts } from "../../../utils/structural/tokens";
import { wholeLineUnits } from "../../../utils/structural/units";
import { parserFor } from "../../fixtures/structural";

const parser = await parserFor("typescript");

/** The text of each of `text`'s units. */
function unitTexts(text: string): string[] {
  const tree = parser.parse(text);
  if (!tree) throw new Error("no tree");
  try {
    return wholeLineUnits(tree, text, lineStarts(text)).map(({ start, end }) =>
      text.slice(start, end),
    );
  } finally {
    tree.delete();
  }
}

describe("wholeLineUnits", () => {
  it("takes a statement alone on its line with its terminator", () => {
    expect(unitTexts("f();\ng();\n")).toContain("g();");
  });

  it("takes no node that shares its line with another", () => {
    expect(unitTexts("f(); g();\n")).not.toContain("g();");
  });

  it("takes no list entry on one line", () => {
    expect(unitTexts("f(\n  a,\n  b,\n);\n")).not.toContain("a,");
  });

  it("takes a list entry on several lines", () => {
    expect(unitTexts("f(\n  {\n    a: 1,\n  },\n  b,\n);\n")).toContain("{\n    a: 1,\n  },");
  });
});
