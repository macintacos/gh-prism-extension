import { describe, expect, it } from "vitest";
import type { GrammarId } from "../../../utils/structural/grammar";
import {
  DEPTH_SEPARATOR,
  keyedByIndentation,
  leafTokens,
  type Token,
} from "../../../utils/structural/tokens";
import { parserFor } from "../../fixtures/structural";

async function tokensOf(id: GrammarId, text: string, maxTokens = Infinity) {
  const tree = (await parserFor(id)).parse(text);
  if (!tree) throw new Error("no tree");
  try {
    return leafTokens(tree, text, maxTokens);
  } finally {
    tree.delete();
  }
}

async function pythonKeys(text: string): Promise<string[]> {
  const tokens = (await tokensOf("python", text)) as Token[];
  return keyedByIndentation(tokens, text).map((token) => token.key);
}

describe("leafTokens", () => {
  it("keys each leaf by its text", async () => {
    const tokens = await tokensOf("typescript", "const a = f(b);");

    expect(tokens?.map((token) => token.key)).toEqual(["const", "a", "=", "f", "(", "b", ")", ";"]);
  });

  it("measures offsets in UTF-16 code units", async () => {
    const text = 'x = "😀é" + y';

    const tokens = await tokensOf("python", text);

    expect(tokens?.find((token) => token.key === "+")?.start).toBe(text.indexOf("+"));
  });

  it("keeps a template literal's text spanning two lines as one token", async () => {
    const text = "const s = `a\nb`;";

    const tokens = await tokensOf("javascript", text);

    expect(tokens?.map((token) => token.key)).toContain("a\nb");
  });

  it("records each leaf's node type", async () => {
    const tokens = await tokensOf("python", 'x.split("(")');

    const brackets = tokens?.filter((token) => token.key === "(");
    expect(brackets?.map((token) => token.type)).toEqual(["(", "string_content"]);
  });

  it("keeps a template literal's whitespace in its key", async () => {
    const tokens = await tokensOf("javascript", "const s = `a\n  b`;");

    expect(tokens?.map((token) => token.key)).toContain("a\n  b");
  });

  it.each([
    [
      "typescript",
      "class A {\n  /**\n   * a\n   */\n  x = 1;\n}",
      "class A {\n    /**\n     * a\n     */\n    x = 1;\n}",
    ],
    [
      "tsx",
      "x = <div>\n    hello world\n    <b>x</b>\n  </div>;",
      "x = <div>\n      hello world\n      <b>x</b>\n    </div>;",
    ],
  ] as const)(
    "keys %s comments and JSX text without their lines' indentation",
    async (id, two, four) => {
      const keys = async (text: string) => (await tokensOf(id, text))?.map((token) => token.key);

      expect(await keys(four)).toEqual(await keys(two));
    },
  );

  it("gives up past maxTokens", async () => {
    expect(await tokensOf("javascript", "let a = [b, c, d];", 3)).toBeUndefined();
  });

  it("walks deeply nested brackets without recursion", async () => {
    const depth = 100_000;
    const text = `${"[".repeat(depth)}${"]".repeat(depth)};`;

    expect(Array.isArray(await tokensOf("javascript", text))).toBe(true);
  });
});

describe("keyedByIndentation", () => {
  it("folds a dedent into the first token's key", async () => {
    const nested = await pythonKeys("def f(x):\n    if x:\n        a()\n        b()\n");
    const dedented = await pythonKeys("def f(x):\n    if x:\n        a()\n    b()\n");

    const b = nested.findIndex((key) => key.endsWith("b"));
    expect(nested[b]).toBe(`2${DEPTH_SEPARATOR}b`);
    expect(dedented[b]).toBe(`1${DEPTH_SEPARATOR}b`);
    expect(dedented.toSpliced(b, 1)).toEqual(nested.toSpliced(b, 1));
  });

  it("reads a consistent reindent as the same depths", async () => {
    const two = await pythonKeys("def f(x):\n  if x:\n    a()\n  b()\n");
    const four = await pythonKeys("def f(x):\n    if x:\n        a()\n    b()\n");

    expect(two).toEqual(four);
  });

  it("gives continuation lines inside brackets no depth", async () => {
    const wrapped = await pythonKeys("f(\n    a,\n    b,\n)\n");
    const oneLine = await pythonKeys("f(a, b,)\n");

    expect(wrapped).toEqual(oneLine);
  });

  it("counts no bracket inside a string", async () => {
    const keys = await pythonKeys('s = "("\nb()\n');

    expect(keys).toContain(`0${DEPTH_SEPARATOR}b`);
  });

  it("leaves the depths alone at a comment-only line", async () => {
    const keys = await pythonKeys("if x:\n    a()\n# note\n    b()\n");

    expect(keys).toContain("# note");
    expect(keys).toContain(`1${DEPTH_SEPARATOR}b`);
  });

  it("keys a very long line in linear time", async () => {
    const text = `x = [${"1, ".repeat(83_000)}1]\n`;

    const keys = await pythonKeys(text);

    expect(keys[0]).toBe(`0${DEPTH_SEPARATOR}x`);
    expect(keys.slice(1).every((key) => !key.includes(DEPTH_SEPARATOR))).toBe(true);
  }, 1_000);
});
