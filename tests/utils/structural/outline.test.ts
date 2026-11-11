import { describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import { DEFAULT_LIMITS } from "../../../utils/structural/engine";
import type { GrammarId } from "../../../utils/structural/grammar";
import {
  headOutline,
  type LineBlock,
  type OutlineInput,
  type OutlineSpan,
} from "../../../utils/structural/outline";
import { lines } from "../../fixtures/head-scan";
import { parserFor } from "../../fixtures/structural";

const GRAMMARS: readonly GrammarId[] = ["typescript", "tsx", "javascript", "python"];
const PARSERS = new Map<GrammarId, Parser>();
for (const id of GRAMMARS) PARSERS.set(id, await parserFor(id));

const languageOf = (id: GrammarId) => ({
  grammar: { id, indentationSensitive: id === "python" },
  parser: PARSERS.get(id) as Parser,
});

const inputOf = (id: GrammarId, text: string, overrides: Partial<OutlineInput> = {}) => ({
  text,
  language: languageOf(id),
  limits: DEFAULT_LIMITS,
  now: () => 0,
  ...overrides,
});

const comment = (startLine: number, endLine: number, closer = "*/"): OutlineSpan => ({
  kind: "comment",
  startLine,
  endLine,
  closer,
});
const string = (startLine: number, endLine: number, closer = "`"): OutlineSpan => ({
  kind: "string",
  startLine,
  endLine,
  closer,
});
const block = (start: number, end: number): LineBlock => ({ start, end });

interface Case {
  readonly name: string;
  readonly id: GrammarId;
  readonly text: string;
  readonly spans: readonly OutlineSpan[];
  readonly testBlocks: readonly LineBlock[];
}

const CASES: readonly Case[] = [
  {
    name: "a block comment over several lines",
    id: "typescript",
    text: lines("/*", " * a", " */", "x;"),
    spans: [comment(1, 3)],
    testBlocks: [],
  },
  {
    name: "a multi-line template literal holding a // line",
    id: "typescript",
    text: lines("const s = `a", "// b", "`;"),
    spans: [string(1, 3)],
    testBlocks: [],
  },
  {
    name: "describe, it, and test calls with arrow and function callbacks",
    id: "typescript",
    text: lines(
      'describe("a", () => {',
      "  x;",
      "});",
      'it("b", function () {',
      "});",
      'test("c", () => {});',
    ),
    spans: [],
    testBlocks: [block(1, 3), block(4, 5), block(6, 6)],
  },
  {
    name: "it.each with a function callback",
    id: "typescript",
    text: lines('it.each([1])("b {", function () {', "});"),
    spans: [],
    testBlocks: [block(1, 2)],
  },
  {
    name: "test.each with an async callback",
    id: "typescript",
    text: lines('test.each(table)("c", async () => {', "});"),
    spans: [],
    testBlocks: [block(1, 2)],
  },
  {
    name: "test namespaces and modules",
    id: "typescript",
    text: lines("export namespace tests {", "  x;", "}", "declare module tests {", "}"),
    spans: [],
    testBlocks: [block(1, 3), block(4, 5)],
  },
  {
    name: "an it nested in a describe",
    id: "typescript",
    text: lines('describe("a", () => {', '  it("b", () => {', "  });", "});"),
    spans: [],
    testBlocks: [block(1, 4)],
  },
  {
    name: "an it inside an in-source test guard",
    id: "typescript",
    text: lines("if (import.meta.vitest) {", '  it("a", () => {', "  });", "}"),
    spans: [],
    testBlocks: [block(2, 3)],
  },
  {
    name: "calls and members that only look like tests",
    id: "typescript",
    text: lines(
      "test(value);",
      'foo.it("x", () => {});',
      "class A {",
      "  test() {}",
      "}",
      'await describe("a", () => {});',
    ),
    spans: [],
    testBlocks: [],
  },
  {
    name: "a describe whose JSX holds a closing brace string",
    id: "tsx",
    text: lines('describe("a", () => {', '  const x = <div title="}">y</div>;', "});"),
    spans: [],
    testBlocks: [block(1, 3)],
  },
  {
    name: "a template literal nested in another's substitution",
    id: "typescript",
    text: lines("const s = `a${", "`b", "c`", "}d`;"),
    spans: [string(1, 4), string(2, 3)],
    testBlocks: [],
  },
  {
    name: "a JavaScript it with a function callback and a template literal",
    id: "javascript",
    text: lines('it("a", function () {', "  const s = `x", "y`;", "});"),
    spans: [string(2, 3)],
    testBlocks: [block(1, 4)],
  },
  {
    name: "module, class, and function docstrings",
    id: "python",
    text: lines(
      '"""Mod',
      'doc."""',
      "class A:",
      '    """Cls',
      '    doc."""',
      "    def f(self):",
      "        '''Fn",
      "        doc.'''",
    ),
    spans: [comment(1, 2, '"""'), comment(4, 5, '"""'), comment(7, 8, "'''")],
    testBlocks: [],
  },
  {
    name: "triple-quoted strings that are not docstrings",
    id: "python",
    text: lines('x = """a', 'b"""', "if x:", '    """c', '    d"""'),
    spans: [string(1, 2, '"""'), string(4, 5, '"""')],
    testBlocks: [],
  },
  {
    name: "a decorated test class",
    id: "python",
    text: lines(
      "@pytest.mark.parametrize(",
      '    "a", [1]',
      ")",
      "@other",
      "class TestThing:",
      "    def test_a(self):",
      "        pass",
    ),
    spans: [],
    testBlocks: [block(1, 7)],
  },
  {
    name: "a free async test function",
    id: "python",
    text: lines("async def test_free():", "    pass"),
    spans: [],
    testBlocks: [block(1, 2)],
  },
  {
    name: "a test-named method of a plain class",
    id: "python",
    text: lines("class Helper:", "    def test_x(self):", "        pass"),
    spans: [],
    testBlocks: [],
  },
  {
    name: "a test function nested in a plain function",
    id: "python",
    text: lines("def helper():", "    def test_nested():", "        pass"),
    spans: [],
    testBlocks: [block(2, 3)],
  },
  {
    name: "an it with a generator callback",
    id: "typescript",
    text: lines('it("x", function* () {', "});"),
    spans: [],
    testBlocks: [block(1, 2)],
  },
  {
    name: "a JavaScript string continued with a backslash",
    id: "javascript",
    text: lines('const s = "a\\', 'b";'),
    spans: [string(1, 2, '"')],
    testBlocks: [],
  },
  {
    name: "a docstring after a comment line",
    id: "python",
    text: lines("# lead", '"""Mod', 'doc."""'),
    spans: [comment(2, 3, '"""')],
    testBlocks: [],
  },
];

describe("headOutline", () => {
  it.each(CASES)("outlines $name", ({ id, text, spans, testBlocks }) => {
    const input = inputOf(id, text);

    const result = headOutline(input);

    expect(result).toEqual({ ok: true, outline: { spans, testBlocks } });
  });

  it("refuses a file without a grammar as unsupported", () => {
    const input = inputOf("typescript", "x;", { language: undefined });

    const result = headOutline(input);

    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("refuses a text past maxTextLength as too large", () => {
    const input = inputOf("typescript", "x;", { limits: { ...DEFAULT_LIMITS, maxTextLength: 1 } });

    const result = headOutline(input);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses a parse that runs past maxParseMs as too large", () => {
    let clock = 0;
    const input = inputOf("typescript", "x;\n".repeat(20_000), { now: () => (clock += 1_000) });

    const result = headOutline(input);

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses a text with a syntax error as failed", () => {
    const input = inputOf("typescript", "const = ;");

    const result = headOutline(input);

    expect(result).toEqual({ ok: false, reason: "failed" });
  });
});
