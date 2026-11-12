import { describe, expect, it } from "vitest";
import { structuralChanges } from "../../../utils/structural/engine";
import { grammarOf } from "../../../utils/structural/grammar";
import { PLAIN_TEXT } from "../../../utils/structural/plain-text";
import { inputFor, parserFor, regionsOf, spanTexts } from "../../fixtures/structural";
import { LARGE_FILES, type LargeFile, largePair, RENAME } from "../../fixtures/structural-large";

/** The engine's answer for `file` written out to `length` units with its middle block renamed. */
async function renamedIn(file: LargeFile, length: number, overrides = {}) {
  const { oldText, newText } = largePair(file, length);
  const grammar = grammarOf(file.path);
  const language = grammar ? { grammar, parser: await parserFor(grammar.id) } : PLAIN_TEXT;
  const result = await structuralChanges(
    inputFor({ oldText, newText, language, regions: regionsOf(oldText, newText), ...overrides }),
  );

  if (!result.ok) return result.reason;
  return {
    old: spanTexts(oldText, result.changes.old),
    new: spanTexts(newText, result.changes.new),
  };
}

describe("a small change in a large file", () => {
  it.each(LARGE_FILES)("marks one renamed name in 250,000 units of $path", async (file) => {
    expect(await renamedIn(file, 250_000)).toEqual({ old: [RENAME.from], new: [RENAME.to] });
  });
});

describe("a file or a change too large to compare", () => {
  const javascript = async () => {
    const grammar = grammarOf("a.js");
    if (!grammar) throw new Error("no JavaScript grammar");
    return { grammar, parser: await parserFor(grammar.id) };
  };
  /** The engine's answer on a real clock, and the milliseconds it took. */
  const timed = async (oldText: string, newText: string) => {
    const lines = (text: string) => text.split("\n").length;
    const whole = { oldStart: 1, oldEnd: lines(oldText), newStart: 1, newEnd: lines(newText) };
    const from = performance.now();
    const result = await structuralChanges(
      inputFor({
        oldText,
        newText,
        language: await javascript(),
        regions: [whole],
        now: () => performance.now(),
      }),
    );
    return { result, ms: performance.now() - from };
  };

  it("refuses one 5 MB line at once", async () => {
    const line = (last: number) => `x = [${"1, ".repeat(1_700_000)}${last}];\n`;

    const { result, ms } = await timed(line(1), line(2));

    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(ms).toBeLessThan(100);
  });

  it("refuses a 20,000-line rewrite within 3 seconds", async () => {
    const lines = (name: string) =>
      Array.from({ length: 20_000 }, (_, i) => `${name}${i}(${i});\n`).join("");

    const { result, ms } = await timed(lines("before"), lines("after"));

    expect(result.ok).toBe(false);
    expect(ms).toBeLessThan(3_000);
  });
});
