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

/** Each token's own text. */
async function texts(id: GrammarId, text: string) {
  return (await tokensOf(id, text))?.map((token) => text.slice(token.start, token.end));
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

  it("records each leaf's node type", async () => {
    const tokens = await tokensOf("python", 'x.split("(")');

    const brackets = tokens?.filter((token) => token.key === "(");
    expect(brackets?.map((token) => token.type)).toEqual(["(", "string_content"]);
  });

  it("gives a string's text one token per word, keyed with the exact spacing before it", async () => {
    const tokens = await tokensOf("javascript", "const s = `a\n  b c`;");

    expect(tokens?.map((token) => token.key)).toEqual([
      "const",
      "s",
      "=",
      "`",
      "a",
      "\n  b",
      " c",
      "`",
      ";",
    ]);
  });

  it("splits a Python string's text around an escape into words too", async () => {
    const tokens = await tokensOf("python", 's = "a b\\n c"');

    expect(tokens?.map((token) => token.key)).toEqual(["s", "=", '"', "a", " b", "\\n", " c", '"']);
  });

  it("keys a JSX text's word with one space for any spacing around it", async () => {
    const tokens = await tokensOf("tsx", "x = <p>Hello big\n   world {y}</p>;");

    expect(tokens?.filter((token) => token.type === "jsx_text").map((token) => token.key)).toEqual([
      "Hello",
      " big",
      " world ",
    ]);
  });

  it("gives a comment one token for its marker and one per word", async () => {
    expect(await texts("typescript", "x; // copies the group,")).toEqual([
      "x",
      ";",
      "//",
      "copies",
      "the",
      "group",
      ",",
    ]);
  });

  it("gives the * that leads a block comment's later lines no token", async () => {
    expect(await texts("typescript", "/**\n * a b\n * c\n */")).toEqual([
      "/**",
      "a",
      "b",
      "c",
      "*",
      "/",
    ]);
  });

  it.each([
    ["typescript", "// a\n// b\nx;\n// c", ["//", "a", "b", "x", ";", "//", "c"]],
    ["python", "# a\n# b\nx\n# c", ["#", "a", "b", "x", "#", "c"]],
  ] as const)(
    "gives the marker of a %s line comment that continues another no token",
    async (id, text, expected) => {
      expect(await texts(id, text)).toEqual(expected);
    },
  );

  it("keys a comment's word apart from the same word in code", async () => {
    const tokens = await tokensOf("javascript", "// a\na;");

    const [inComment, inCode] = tokens?.filter((token) => token.end - token.start === 1) ?? [];
    expect(inComment?.key).not.toBe(inCode?.key);
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

    expect(keys).toContain(`1${DEPTH_SEPARATOR}b`);
  });

  it("keys a very long line in linear time", async () => {
    const text = `x = [${"1, ".repeat(83_000)}1]\n`;

    const keys = await pythonKeys(text);

    expect(keys[0]).toBe(`0${DEPTH_SEPARATOR}x`);
    expect(keys.slice(1).every((key) => !key.includes(DEPTH_SEPARATOR))).toBe(true);
  }, 1_000);
});
