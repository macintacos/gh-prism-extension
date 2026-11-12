import { describe, expect, it, vi } from "vitest";
import type { Parser } from "web-tree-sitter";
import type { StructuralChanges, TokenSpan } from "../../../utils/structural/changes";
import {
  type ChangedRegion,
  DEFAULT_LIMITS,
  type EngineInput,
  type EngineResult,
  structuralChanges,
} from "../../../utils/structural/engine";
import type { GrammarId } from "../../../utils/structural/grammar";
import { PLAIN_TEXT } from "../../../utils/structural/plain-text";
import {
  inputFor,
  parserFor,
  readPair,
  readRegions,
  regionsOf,
  spanTexts,
  swapped,
} from "../../fixtures/structural";

const GRAMMARS: readonly GrammarId[] = ["typescript", "tsx", "javascript", "python"];
const PARSERS = new Map<GrammarId, Parser>();
for (const id of [...GRAMMARS, "yaml"] as const) PARSERS.set(id, await parserFor(id));

const languageOf = (id: GrammarId) => ({
  grammar: { id, indentationSensitive: id === "python" || id === "yaml" },
  parser: PARSERS.get(id) as Parser,
});

type Overrides = Partial<Omit<EngineInput, "limits">> & {
  readonly limits?: Partial<EngineInput["limits"]>;
};

/** The engine's result for `oldText` against `newText`, with `regionsOf` them unless overridden. */
async function run(
  id: GrammarId | typeof PLAIN_TEXT,
  oldText: string,
  newText: string,
  { limits, ...overrides }: Overrides = {},
): Promise<EngineResult> {
  const result = await structuralChanges(
    inputFor({
      oldText,
      newText,
      language: id === PLAIN_TEXT ? PLAIN_TEXT : languageOf(id),
      regions: regionsOf(oldText, newText),
      limits: { ...DEFAULT_LIMITS, ...limits },
      ...overrides,
    }),
  );
  if (result.ok) expectPaintable(result.changes);
  return result;
}

/** Spans on one line are non-empty and non-overlapping. */
function expectPaintable(changes: StructuralChanges) {
  for (const spans of [changes.old, changes.new]) {
    const sorted = spans.toSorted((a, b) => a.line - b.line || a.startCol - b.startCol);
    sorted.forEach((span, i) => {
      expect(span.endCol).toBeGreaterThan(span.startCol);
      const next = sorted[i + 1];
      if (next?.line === span.line) expect(next.startCol).toBeGreaterThanOrEqual(span.endCol);
    });
  }
}

function changesOf(result: EngineResult): StructuralChanges {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.changes;
}

async function changedTexts(
  id: GrammarId | typeof PLAIN_TEXT,
  oldText: string,
  newText: string,
  overrides?: Overrides,
) {
  const changes = changesOf(await run(id, oldText, newText, overrides));
  return { old: spanTexts(oldText, changes.old), new: spanTexts(newText, changes.new) };
}

/** `changes` with its old side as its new and its new as its old. */
const sidesSwapped = ({ old, new: added, inside }: StructuralChanges): StructuralChanges => ({
  old: added,
  new: old,
  ...(inside && { inside: { old: inside.new, new: inside.old } }),
});

/** What `spans` leave unmarked on each of `text`'s 1-based lines `from` to `to`, without whitespace. */
function unmarked(text: string, spans: readonly TokenSpan[], from: number, to: number): string[] {
  return text
    .split("\n")
    .slice(from - 1, to)
    .map((line, i) => {
      const kept = [...line];
      for (const span of spans)
        if (span.line === from + i) kept.fill(" ", span.startCol, span.endCol);
      return kept.join("").replaceAll(/\s/g, "");
    });
}

const wholeFile = (text: string): ChangedRegion[] => {
  const end = text.split("\n").length + 1;
  return [{ oldStart: 1, oldEnd: end, newStart: 1, newEnd: end }];
};

const PAIRS = GRAMMARS.flatMap((id) =>
  ["reindent", "rewrap", "rename", "added-argument"].map((name) => [id, name] as const),
).concat([["python", "moved-out-of-block"]]);

/** `lines` as one comment per grammar and style, above a statement every grammar parses. */
type CommentOf = (lines: readonly string[]) => string;
const COMMENTS = GRAMMARS.flatMap((id): (readonly [GrammarId, string, CommentOf])[] => {
  const line =
    (marker: string): CommentOf =>
    (lines) =>
      `${lines.map((text) => `${marker} ${text}\n`).join("")}f()\n`;
  const block: CommentOf = (lines) =>
    `/**\n${lines.map((text) => ` * ${text}\n`).join("")} */\nf()\n`;
  return id === "python"
    ? [[id, "#", line("#")]]
    : [
        [id, "//", line("//")],
        [id, "/**", block],
      ];
});

/** A clock that adds 1 per call, and how often it was read. */
function countingClock() {
  const clock = { calls: 0, now: () => ++clock.calls };
  return clock;
}

describe("structuralChanges", () => {
  it.each(GRAMMARS.flatMap((id) => [[id, "reindent"] as const, [id, "rewrap"] as const]))(
    "finds no change in a %s %s",
    async (id, name) => {
      const { oldText, newText } = readPair(id, name);

      expect(await changedTexts(id, oldText, newText)).toEqual({ old: [], new: [] });
    },
  );

  it.each(GRAMMARS)("marks both uses of a renamed %s variable", async (id) => {
    const { oldText, newText } = readPair(id, "rename");
    const renamed = id === "python" ? "sum_" : "sum";

    expect(await changedTexts(id, oldText, newText)).toEqual({
      old: ["total", "total"],
      new: [renamed, renamed],
    });
  });

  it.each(GRAMMARS)("marks only the added %s argument and its comma", async (id) => {
    const { oldText, newText } = readPair(id, "added-argument");

    expect(await changedTexts(id, oldText, newText)).toEqual({ old: [], new: [",", "third"] });
  });

  it.each(COMMENTS)(
    "marks only the reworded words of a %s %s comment",
    async (id, _style, comment) => {
      const oldText = comment(["Copies the menu's group and", "its divider."]);
      const newText = comment(["Copies the menu's group, its", "divider and item."]);

      expect(await changedTexts(id, oldText, newText)).toEqual({
        old: ["and"],
        new: [",", "and", "item"],
      });
    },
  );

  it.each(COMMENTS)(
    "finds no change in a re-wrapped %s %s comment",
    async (id, _style, comment) => {
      const oldText = comment(["Copies the menu's group and", "its divider."]);
      const newText = comment(["Copies the menu's", "group and its", "divider."]);

      expect(await changedTexts(id, oldText, newText)).toEqual({ old: [], new: [] });
    },
  );

  it.each([
    ["alone", "// f();\n", "f();\n", ["//", "f", "(", ")", ";"]],
    ["after another comment", "// a\n// f();\n", "// a\nf();\n", ["//", "f", "(", ")", ";"]],
  ])("marks code uncommented %s", async (_name, oldText, newText, old) => {
    expect(await changedTexts("typescript", oldText, newText)).toEqual({
      old,
      new: ["f", "(", ")", ";"],
    });
  });

  it.each([
    ["typescript", 'const s = "the quick fox";\n', 'const s = "the slow fox";\n'],
    ["javascript", "const s = `the quick\n  fox`;\n", "const s = `the slow\n  fox`;\n"],
    [
      "python",
      'def f():\n    """The quick\n    fox."""\n',
      'def f():\n    """The slow\n    fox."""\n',
    ],
    ["tsx", "x = <p>the quick fox</p>;\n", "x = <p>the slow fox</p>;\n"],
  ] as const)(
    "marks only the reworded word of a %s string or text",
    async (id, oldText, newText) => {
      expect(await changedTexts(id, oldText, newText)).toEqual({ old: ["quick"], new: ["slow"] });
    },
  );

  it("marks the word after a spacing change inside a string", async () => {
    const oldText = 'const s = "a b";\n';
    const newText = 'const s = "a  b";\n';

    expect(await changedTexts("typescript", oldText, newText)).toEqual({ old: ["b"], new: ["b"] });
  });

  describe("plain text", () => {
    it("marks only the reworded words", async () => {
      const oldText = "Title\n\nCopies the menu's group and\nits divider.\n";
      const newText = "Title\n\nCopies the menu's group, its\ndivider and item.\n";

      expect(await changedTexts(PLAIN_TEXT, oldText, newText)).toEqual({
        old: ["and"],
        new: [",", "and", "item"],
      });
    });

    it("finds no change in a re-wrapped paragraph", async () => {
      const oldText = "Copies the menu's group and\nits divider.\n";
      const newText = "Copies the menu's\n  group and its\ndivider.\n";

      expect(await changedTexts(PLAIN_TEXT, oldText, newText)).toEqual({ old: [], new: [] });
    });

    it("refuses a text of more words than maxTokens", async () => {
      const text = "w ".repeat(DEFAULT_LIMITS.maxTokens + 1);

      expect(await run(PLAIN_TEXT, text, `${text}more\n`)).toEqual({
        ok: false,
        reason: "too-large",
      });
    });

    it("marks every word of two unrelated long texts", async () => {
      const words = (prefix: string) =>
        Array.from({ length: 5_000 }, (_, i) => `${prefix}${i}`).join(" ");

      const result = await changedTexts(PLAIN_TEXT, `${words("a")}\n`, `${words("b")}\n`);

      expect([result.old.length, result.new.length]).toEqual([5_000, 5_000]);
    });
  });

  it("refuses a comment of more words than maxTokens", async () => {
    const comment = (last: string) => `/* ${"w ".repeat(DEFAULT_LIMITS.maxTokens)}${last} */\n`;

    expect(await run("typescript", comment("old"), comment("new"))).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("marks a Python statement moved out of its block", async () => {
    const { oldText, newText } = readPair("python", "moved-out-of-block");

    expect(await changedTexts("python", oldText, newText)).toEqual({ old: ["b"], new: ["b"] });
  });

  it.each([
    {
      name: "after a bracket in a string",
      oldText: 's = "("\ndef f(x):\n    if x:\n        a()\n        b()\n',
      newText: 's = "("\ndef f(x):\n    if x:\n        a()\n    b()\n',
      moved: "b",
    },
    {
      name: "past a comment-only line",
      oldText: "if x:\n    a()\n# note\n    b()\n    c()\n",
      newText: "if x:\n    a()\n# note\n    b()\nc()\n",
      moved: "c",
    },
  ])(
    "marks a Python statement moved out of its block $name",
    async ({ oldText, newText, moved }) => {
      expect(await changedTexts("python", oldText, newText)).toEqual({
        old: [moved],
        new: [moved],
      });
    },
  );

  it.each([
    [
      "typescript",
      "class A {\n  /**\n   * a\n   */\n  x = 1;\n}\n",
      "class A {\n    /**\n     * a\n     */\n    x = 1;\n}\n",
    ],
    [
      "tsx",
      "const x = (\n  <div>\n    hello world\n    <b>x</b>\n  </div>\n);\n",
      "const x = (\n    <div>\n        hello world\n        <b>x</b>\n    </div>\n);\n",
    ],
  ] as const)(
    "finds no change in a %s reindent of a comment or JSX text",
    async (id, two, four) => {
      expect(await changedTexts(id, two, four)).toEqual({ old: [], new: [] });
    },
  );

  it("marks a block and the unrelated line that replaced it in full", async () => {
    const { oldText, newText } = readPair("typescript", "replaced-block");

    const changes = changesOf(
      await run("typescript", oldText, newText, {
        regions: readRegions("replaced-block"),
      }),
    );

    expect(unmarked(oldText, changes.old, 5, 21).join("")).toBe("");
    expect(unmarked(newText, changes.new, 5, 5)).toEqual([""]);
  });

  it.each([
    ["only punctuation", "const total = 1;\n", "let sum = 2;\n"],
    ["a closing line's punctuation", "const a = {\n  b: 1,\n};\n", 'import { a } from "./a";\n'],
  ])("marks lines in full that share %s", async (_name, oldText, newText) => {
    const changes = changesOf(await run("typescript", oldText, newText));

    expect(unmarked(oldText, changes.old, 1, 3).join("")).toBe("");
    expect(unmarked(newText, changes.new, 1, 1)).toEqual([""]);
  });

  it("marks a YAML list item in full when it shares only punctuation", async () => {
    const oldText = "items:\n  - foo: bar\n";
    const newText = "items:\n  - alpha beta gamma: qux\n";
    const changes = changesOf(await run("yaml", oldText, newText));

    expect(unmarked(oldText, changes.old, 2, 2)).toEqual([""]);
    expect(unmarked(newText, changes.new, 2, 2)).toEqual([""]);
  });

  it("marks only the new tokens of a long argument wrapped around a kept one", async () => {
    const oldText = "starts.push(state);\n";
    const newText = 'starts.push({ ...state, position: 1, kind: "line", depth: 0 });\n';

    expect(await changedTexts("typescript", oldText, newText)).toEqual({
      old: [],
      new: [
        "{",
        "...",
        ",",
        "position",
        ":",
        "1",
        ",",
        "kind",
        ":",
        '"',
        "line",
        '"',
        ",",
        "depth",
        ":",
        "0",
        "}",
      ],
    });
  });

  it("marks only the changed name on a line of two tokens", async () => {
    expect(await changedTexts("typescript", "throw a\n", "throw b\n")).toEqual({
      old: ["a"],
      new: ["b"],
    });
  });

  it("marks each changed name apart on a line that keeps only its punctuation", async () => {
    const oldText = "const m = [\n  [a, b],\n];\n";
    const newText = "const m = [\n  [x, y],\n];\n";

    expect(await changedTexts("typescript", oldText, newText)).toEqual({
      old: ["a", "b"],
      new: ["x", "y"],
    });
  });

  it("leaves a closing brace unmarked when an else branch is added before it", async () => {
    const oldText = "if (x) {\n  a();\n}\n";
    const newText = "if (x) {\n  a();\n} else {\n  b();\n}\n";

    const changes = changesOf(await run("typescript", oldText, newText));

    expect(changes.old).toEqual([]);
    expect(unmarked(newText, changes.new, 3, 5)).toEqual(["", "", "}"]);
  });

  it.each([
    ["an insertion", "", "\n"],
    ["a deletion", "\n", ""],
  ])("marks %s past maxEditLength whole", async (_, oldBody, newBody) => {
    const body = "f(x);\n".repeat(300);
    const oldText = `a();\n${oldBody && body}`;
    const newText = `a();\n${newBody && body}`;

    const result = await changedTexts("typescript", oldText, newText, {
      limits: { maxEditLength: 10 },
    });

    expect(result.old.length + result.new.length).toBe(1_500);
  });

  it.each([
    {
      name: "merges two regions sharing a token",
      oldText: "const s = ` \n  \n \n  \n `;\n",
      newText: "const s = ` \n   \n \n   \n `;\n",
      regions: [
        { oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 },
        { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 5 },
      ],
      expected: { old: [" ", "  ", " ", "  ", " "], new: [" ", "   ", " ", "   ", " "] },
    },
    {
      name: "widens the first region to a mismatch before it",
      oldText: "a;\nb;\n",
      newText: "x;\nc;\n",
      regions: [{ oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 }],
      expected: { old: ["a", "b"], new: ["x", "c"] },
    },
    {
      name: "widens the last region to a mismatch after it",
      oldText: "a;\nb;\n",
      newText: "x;\nc;\n",
      regions: [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 }],
      expected: { old: ["a", "b"], new: ["x", "c"] },
    },
  ])("$name", async ({ oldText, newText, regions, expected }) => {
    expect(await changedTexts("typescript", oldText, newText, { regions })).toEqual(expected);
  });

  it("refuses a text that does not parse when its language is indentation-sensitive", async () => {
    const { oldText, newText } = readPair("python", "parse-error");

    expect(await run("python", oldText, newText)).toEqual({ ok: false, reason: "unparsed" });
  });

  it("refuses a templated YAML text as unparsed", async () => {
    const oldText = "metadata:\n  name: app\n";
    const newText = 'metadata:\n  {{- include "app.labels" . | nindent 2 }}\n  name: app\n';

    expect(await run("yaml", oldText, newText)).toEqual({ ok: false, reason: "unparsed" });
  });

  it.each(["typescript", "tsx", "javascript"] as const)(
    "compares the tokens of a %s text that does not parse",
    async (id) => {
      const { oldText, newText } = readPair(id, "parse-error");

      expect(await changedTexts(id, oldText, newText)).toEqual({ old: ["}"], new: [] });
    },
  );

  it.each(PAIRS)("finds no change in a %s %s against itself", async (id, name) => {
    const { oldText } = readPair(id, name);

    const result = await run(id, oldText, oldText, { regions: wholeFile(oldText) });

    expect(changesOf(result)).toEqual({ old: [], new: [], inside: { old: [], new: [] } });
  });

  it.each(PAIRS)("swaps the sides of a %s %s run backwards", async (id, name) => {
    const { oldText, newText } = readPair(id, name);
    const forward = changesOf(await run(id, oldText, newText));

    const backward = await run(id, newText, oldText, {
      regions: swapped(regionsOf(oldText, newText)),
    });

    expect(changesOf(backward)).toEqual(sidesSwapped(forward));
  });

  it("swaps the sides of a run whose diff has ties", async () => {
    const oldText = "a;\nb;\na;\n";
    const newText = "b;\na;\nb;\n";
    const forward = changesOf(
      await run("javascript", oldText, newText, { regions: wholeFile(oldText) }),
    );

    const backward = await run("javascript", newText, oldText, { regions: wholeFile(oldText) });

    expect(changesOf(backward)).toEqual(sidesSwapped(forward));
  });

  it("refuses a file without a grammar as unsupported", async () => {
    const result = await structuralChanges(
      inputFor({ oldText: "a", newText: "b", language: undefined, regions: [] }),
    );

    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it.each(GRAMMARS)("refuses a %s text past maxTextLength", async (id) => {
    const { oldText, newText } = readPair(id, "rename");

    const result = await run(id, oldText, newText, { limits: { maxTextLength: 10 } });

    expect(result).toEqual({ ok: false, reason: "too-large" });
  });

  it("refuses past maxTokens", async () => {
    const { oldText, newText } = readPair("typescript", "rename");

    expect(await run("typescript", oldText, newText, { limits: { maxTokens: 3 } })).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("refuses more changed tokens on a side than maxChangedTokens", async () => {
    const oldText = "f(a, b);\nkeep();\n";
    const newText = "g(a, b);\nkeep();\n";
    const rewritten = "h[c] = d;\nkeep();\n";

    const renamed = await run("typescript", oldText, newText, { limits: { maxChangedTokens: 1 } });
    const replaced = await run("typescript", oldText, rewritten, {
      limits: { maxChangedTokens: 1 },
    });

    expect(renamed.ok).toBe(true);
    expect(replaced).toEqual({ ok: false, reason: "too-large" });
  });

  it("marks a region rewritten past maxEditLength whole, and compares the others", async () => {
    const oldText = "a(1);\nkeep();\nf(x);\n";
    const newText = "a(2);\nkeep();\ng(y, z);\n";

    const result = await changedTexts("typescript", oldText, newText, {
      limits: { maxEditLength: 3 },
    });

    expect(result).toEqual({
      old: ["1", "f", "(", "x", ")", ";"],
      new: ["2", "g", "(", "y", ",", "z", ")", ";"],
    });
  });

  it("cancels a parse past maxParseMs, then parses normally again", async () => {
    const text = `${"[".repeat(40_000)}${"]".repeat(40_000)};\n`;
    const clock = countingClock();
    const { oldText, newText } = readPair("javascript", "rename");

    const result = await run("javascript", text, text, {
      limits: { maxParseMs: 5 },
      now: clock.now,
    });

    expect(result).toEqual({ ok: false, reason: "too-slow" });
    expect(clock.calls).toBeLessThan(100);
    expect(await changedTexts("javascript", oldText, newText)).toEqual({
      old: ["total", "total"],
      new: ["sum", "sum"],
    });
  });

  it("refuses one very long line", async () => {
    const line = `x = [${"1, ".repeat(100_000)}1]\n`;

    expect(await run("python", line, line)).toEqual({ ok: false, reason: "too-large" });
    expect(
      await run("python", line, line, {
        limits: { maxTextLength: Infinity, maxParseMs: 5 },
        now: countingClock().now,
      }),
    ).toEqual({ ok: false, reason: "too-slow" });
  });

  it("refuses a diff stage past maxDiffMs, checked between regions", async () => {
    const oldText = "const a = 1;\nconst keep = 0;\nconst b = 2;\n";
    const newText = "const x = 1;\nconst keep = 0;\nconst y = 2;\n";
    const clockAfterPauses = () => {
      let pauses = 0;
      let time = 0;
      return {
        pause: () => {
          pauses++;
          return Promise.resolve();
        },
        now: () => {
          if (pauses >= 2) time += 10;
          return time;
        },
      };
    };

    const slow = await run("typescript", oldText, newText, {
      ...clockAfterPauses(),
      limits: { maxDiffMs: 15 },
    });
    const fast = await changedTexts("typescript", oldText, newText, {
      ...clockAfterPauses(),
      limits: { maxDiffMs: 100 },
    });

    expect(slow).toEqual({ ok: false, reason: "too-slow" });
    expect(fast).toEqual({ old: ["a", "b"], new: ["x", "y"] });
  });

  it("splits a changed token spanning lines into one span per line", async () => {
    const oldText = "const s = ` \n  `;\n";
    const newText = "const s = `  \n  `;\n";

    const changes = changesOf(await run("typescript", oldText, newText));

    const lines = (spans: readonly TokenSpan[]) => spans.map((span) => span.line);
    expect(lines(changes.old)).toEqual([1, 2]);
    expect(lines(changes.new)).toEqual([1, 2]);
    for (const piece of [...spanTexts(oldText, changes.old), ...spanTexts(newText, changes.new)])
      expect(piece).toMatch(/^[^\n]+$/);
  });

  it("leaves a CRLF line ending out of every span", async () => {
    const { oldText, newText } = readPair("typescript", "rename");
    const crlf = (text: string) => text.replaceAll("\n", "\r\n");

    const result = await changedTexts("typescript", crlf(oldText), crlf(newText));

    expect(result).toEqual(await changedTexts("typescript", oldText, newText));
  });

  it("measures columns in UTF-16 code units", async () => {
    const oldText = 'const s = "😀é" + total;\n';
    const newText = 'const s = "😀é" + sum;\n';

    const changes = changesOf(await run("typescript", oldText, newText));

    expect(changes.new).toEqual([
      { line: 1, startCol: newText.indexOf("sum"), endCol: newText.indexOf("sum") + 3 },
    ]);
  });

  it("rejects with the reason of a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    const { oldText, newText } = readPair("typescript", "rename");

    const result = run("typescript", oldText, newText, { signal: controller.signal });

    await expect(result).rejects.toThrow("gone");
  });

  it("rejects once the signal aborts between parses", async () => {
    const controller = new AbortController();
    const parse = vi.spyOn(PARSERS.get("typescript") as Parser, "parse");
    const { oldText, newText } = readPair("typescript", "rename");

    const result = run("typescript", oldText, newText, {
      signal: controller.signal,
      pause: () => {
        controller.abort(new Error("left"));
        return Promise.resolve();
      },
    });

    await expect(result).rejects.toThrow("left");
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });
});

/** The lines the engine found changed inside a unit that remains, for `oldText` against `newText`. */
async function insideLines(id: GrammarId | typeof PLAIN_TEXT, oldText: string, newText: string) {
  return changesOf(await run(id, oldText, newText)).inside;
}

describe("structuralChanges, lines inside a unit that remains", () => {
  it("names the lines of the names removed from a wrapped import, not the statements deleted after it", async () => {
    const oldText =
      'import {\n  a,\n  b,\n  c,\n} from "./m";\n\nfunction gone() {\n  return a(b);\n}\n\nconst left = 1;\n';
    const newText = 'import { c } from "./m";\n';

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [2, 3, 4], new: [] });
  });

  it("names the line of an argument removed from a call wrapped one argument a line", async () => {
    const oldText = "run(\n  first,\n  second,\n  third,\n);\n";
    const newText = "run(\n  first,\n  third,\n);\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [3], new: [] });
  });

  it("names the line of a list's last entry, which no comma follows", async () => {
    const oldText = "const o = {\n  a: 1,\n  b: 2\n};\n";
    const newText = "const o = {\n  a: 1\n};\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [2, 3], new: [] });
  });

  it("names no line of an entry on several lines removed from a list, only its comma's", async () => {
    const oldText = "const l = [\n  1,\n  {\n    b: 2\n  }\n];\n";
    const newText = "const l = [\n  1\n];\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [2], new: [] });
  });

  it("names no line of an entry on several lines added to a list with its comma", async () => {
    const oldText = "const l = [\n  1,\n];\n";
    const newText = "const l = [\n  1,\n  {\n    b: 2,\n  },\n];\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [], new: [] });
  });

  it("names no line of an entry removed from between two entries like it", async () => {
    const entry = (id: string) => `  {\n    id: "${id}",\n    run: () => go("${id}"),\n  },\n`;
    const oldText = `const l = [\n${entry("a")}${entry("b")}${entry("c")}];\n`;
    const newText = `const l = [\n${entry("a")}${entry("c")}];\n`;
    const regions = [{ oldStart: 6, oldEnd: 10, newStart: 6, newEnd: 6 }];

    const result = await run("typescript", oldText, newText, { regions });

    expect(changesOf(result).inside).toEqual({ old: [], new: [] });
  });

  it("names no line of a method deleted from a class", async () => {
    const oldText =
      "class A {\n  one() {\n    return 1;\n  }\n\n  two() {\n    return 2;\n  }\n}\n";
    const newText = "class A {\n  one() {\n    return 1;\n  }\n}\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [], new: [] });
  });

  it("names no line of a member deleted with the semicolon that ends it", async () => {
    const oldText = "interface A {\n  one: number;\n  two(\n    a: string,\n  ): void;\n}\n";
    const newText = "interface A {\n  one: number;\n}\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [], new: [] });
  });

  it("names no line of a statement added to a function's body", async () => {
    const oldText = "function f() {\n  a();\n}\n";
    const newText = "function f() {\n  a();\n  b(\n    1,\n  );\n}\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [], new: [] });
  });

  it("names the line that opens a deleted else branch, and no line of the branch's statements", async () => {
    const oldText = "if (a) {\n  b();\n} else {\n  c();\n}\n";
    const newText = "if (a) {\n  b();\n}\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [3], new: [] });
  });

  it("names no line of a file added whole", async () => {
    const newText = "import { a } from './a';\n\nexport const b = a(\n  1,\n);\n";

    expect(await insideLines("typescript", "", newText)).toEqual({ old: [], new: [] });
  });

  it("names a Python argument's line, and no line of a deleted statement", async () => {
    const oldText = "def f():\n    g(\n        a,\n        b,\n    )\n    h()\n    return 1\n";
    const newText = "def f():\n    g(\n        a,\n    )\n    return 1\n";

    expect(await insideLines("python", oldText, newText)).toEqual({ old: [4], new: [] });
  });

  it("names a comment's reworded line when the comment's other lines remain", async () => {
    const oldText = "/**\n * Keeps this.\n * Drops every word here.\n */\nf();\n";
    const newText = "/**\n * Keeps this.\n * Says something else entirely.\n */\nf();\n";

    expect(await insideLines("typescript", oldText, newText)).toEqual({ old: [3], new: [3] });
  });

  it("names no line of a region rewritten past maxEditLength, whose function keeps its closing brace", async () => {
    const oldText = "const keep = 1;\nfunction f() {\n  a(1);\n  b(2);\n}\n";
    const newText = "const keep = 1;\nclass G {\n  m() {}\n}\n";

    const result = await run("typescript", oldText, newText, { limits: { maxEditLength: 3 } });

    const changes = changesOf(result);
    expect(unmarked(oldText, changes.old, 2, 4)).toEqual(["", "", ""]);
    expect(unmarked(newText, changes.new, 2, 3)).toEqual(["", ""]);
    expect(changes.inside).toEqual({ old: [], new: [] });
  });

  it("names no line of plain text, which has no units", async () => {
    expect(await insideLines(PLAIN_TEXT, "one\ntwo\nthree\n", "one\nthree\n")).toBeUndefined();
  });
});
