import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Parser } from "web-tree-sitter";
import type { PrFileDiff } from "../../../utils/github/pr-diff";
import {
  headFromOutline,
  type ScannedHead,
  scanHeadText,
} from "../../../utils/hunk-rules/head-scan";
import { inlineTestHunkVerdicts } from "../../../utils/hunk-rules/inline-tests";
import { DEFAULT_LIMITS } from "../../../utils/structural/engine";
import { type GrammarId, grammarOf } from "../../../utils/structural/grammar";
import { type HeadOutline, headOutline } from "../../../utils/structural/outline";
import { headOf, lines } from "../../fixtures/head-scan";
import { pythonCases, typescriptCases } from "../../fixtures/inline-test-cases";
import { parserFor } from "../../fixtures/structural";

const GRAMMARS: readonly GrammarId[] = ["typescript", "tsx", "javascript", "python"];
const PARSERS = new Map<GrammarId, Parser>();
for (const id of GRAMMARS) PARSERS.set(id, await parserFor(id));

/** `text`'s outline as `path`'s grammar parses it; `undefined` when it does not parse. */
function outlineOf(path: string, text: string): HeadOutline | undefined {
  const grammar = grammarOf(path);
  const parser = grammar && PARSERS.get(grammar.id);
  if (grammar === undefined || parser === undefined) return undefined;

  const result = headOutline({
    text,
    language: { grammar, parser },
    limits: DEFAULT_LIMITS,
    now: () => 0,
  });
  return result.ok ? result.outline : undefined;
}

function parsedHead(path: string, text: string): ScannedHead | undefined {
  const outline = outlineOf(path, text);
  return outline && headFromOutline(path, text, outline);
}

/** The 1-based lines whose start state or kind differ; the end of file is the line after the last. */
function differingLines(scanned: ScannedHead, parsed: ScannedHead): number[] {
  return scanned.starts.flatMap((start, index) => {
    const same =
      JSON.stringify(start) === JSON.stringify(parsed.starts[index]) &&
      scanned.kinds[index] === parsed.kinds[index];
    return same ? [] : [index + 1];
  });
}

const modified = (path: string, patch: string): PrFileDiff => ({
  kind: "text",
  path,
  status: "modified",
  patch,
});

const isTests = (verdicts: readonly boolean[]) => verdicts.length > 0 && verdicts.every(Boolean);

const FIXTURES = new URL("../../fixtures/structural/", import.meta.url);

/** Every structural fixture text, by `<grammar>/<file>`, with the path its extension implies. */
const fixtureTexts = GRAMMARS.flatMap((grammar) =>
  readdirSync(new URL(`${grammar}/`, FIXTURES)).map((file) => ({
    name: `${grammar}/${file}`,
    path: file.replace(/\.txt$/, ""),
    text: readFileSync(new URL(`${grammar}/${file}`, FIXTURES), "utf8"),
  })),
);

const inlineCases = [...pythonCases, ...typescriptCases];
const heads = [
  ...fixtureTexts,
  ...inlineCases.map(({ name, path, head }) => ({ name, path, text: head })),
];

/** Where the head a parse builds differs from the line scan's, and why the parse is right. */
const KNOWN_DIFFERENCES: Readonly<Record<string, { lines: number[]; reason: string }>> = {};

/** Moved cases whose verdict from a parsed head differs from `expected`, and why. */
const KNOWN_VERDICTS: Readonly<Record<string, { parsed: boolean; reason: string }>> = {};

describe("a head built from a parse", () => {
  it("parses every head but the known syntax errors", () => {
    const unparsed = heads.filter(({ path, text }) => outlineOf(path, text) === undefined);

    expect(unparsed.map(({ name }) => name)).toEqual([
      "typescript/parse-error.new.ts.txt",
      "tsx/parse-error.new.tsx.txt",
      "javascript/parse-error.new.js.txt",
      "python/parse-error.new.py.txt",
    ]);
  });

  it.each(heads)("reads $name as the line scan does, but for known differences", (entry) => {
    const parsed = parsedHead(entry.path, entry.text);
    if (parsed === undefined) return;

    const scanned = headOf(entry.path, entry.text);

    expect(parsed.lines).toEqual(scanned.lines);
    expect(differingLines(scanned, parsed)).toEqual(KNOWN_DIFFERENCES[entry.name]?.lines ?? []);
  });

  it.each(inlineCases)("judges $name as the line scan does, but for known differences", (entry) => {
    const parsed = parsedHead(entry.path, entry.head);
    if (parsed === undefined) return;

    const verdicts = inlineTestHunkVerdicts(modified(entry.path, entry.patch), parsed);

    expect(isTests(verdicts)).toBe(KNOWN_VERDICTS[entry.name]?.parsed ?? entry.expected);
  });
});

describe("where the line scan misreads a head and a parse does not", () => {
  /** The inline-test verdict for `patch` from the line scan's head and from the parsed one. */
  function verdictsOf(path: string, head: string, patch: string) {
    const parsed = parsedHead(path, head);
    if (parsed === undefined) throw new Error(`${path} does not parse`);

    const file = modified(path, patch);
    return {
      scanned: isTests(inlineTestHunkVerdicts(file, headOf(path, head))),
      parsed: isTests(inlineTestHunkVerdicts(file, parsed)),
    };
  }

  it("keeps a describe whose body holds a multi-line template literal with an unbalanced {", () => {
    const head = lines(
      'describe("x", () => {',
      "  const t = `",
      "{",
      "`;",
      "  expect(1).toBe(1);",
      "});",
    );
    const patch = lines("@@ -5 +5 @@", "-  expect(1).toBe(2);", "+  expect(1).toBe(1);");

    const verdicts = verdictsOf("src/app.ts", head, patch);

    expect(verdicts).toEqual({ scanned: false, parsed: true });
  });

  it("reads a // line inside a multi-line template literal as string", () => {
    const text = lines("const sql = `", "// not a comment", "`;", "const after = 1;");

    const scanned = scanHeadText("src/app.ts", text);
    const parsed = parsedHead("src/app.ts", text);

    expect(scanned?.kinds[1]).toBe("comment");
    expect(parsed?.kinds[1]).toBe("string");
  });

  it("keeps a Python test's decorator call spread over several lines in its block", () => {
    const head = lines(
      "@pytest.mark.parametrize(",
      '    "x",',
      "    [1, 2],",
      ")",
      "def test_x(x):",
      "    assert x",
    );
    const patch = lines("@@ -3 +3 @@", "-    [1],", "+    [1, 2],");

    const verdicts = verdictsOf("src/app.py", head, patch);

    expect(verdicts).toEqual({ scanned: false, parsed: true });
  });

  it("reads the lines after a mid-line /* as comment until it closes", () => {
    const text = lines("const a = 1; /* opens", "still inside", "*/", "const b = 2;");

    const scanned = scanHeadText("src/app.ts", text);
    const parsed = parsedHead("src/app.ts", text);

    expect(scanned?.kinds).toEqual(["code", "code", "code", "code"]);
    expect(parsed?.kinds).toEqual(["code", "comment", "comment", "code"]);
  });
});
