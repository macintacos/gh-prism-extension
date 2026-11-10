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
import {
  inputFor,
  parserFor,
  readPair,
  regionsOf,
  spanTexts,
  swapped,
} from "../../fixtures/structural";

const GRAMMARS: readonly GrammarId[] = ["typescript", "tsx", "javascript", "python"];
const PARSERS = new Map<GrammarId, Parser>();
for (const id of GRAMMARS) PARSERS.set(id, await parserFor(id));

const languageOf = (id: GrammarId) => ({
  grammar: { id, indentationSensitive: id === "python" },
  parser: PARSERS.get(id) as Parser,
});

type Overrides = Partial<Omit<EngineInput, "limits">> & {
  readonly limits?: Partial<EngineInput["limits"]>;
};

/** The engine's result for `oldText` against `newText`, with `regionsOf` them unless overridden. */
async function run(
  id: GrammarId,
  oldText: string,
  newText: string,
  { limits, ...overrides }: Overrides = {},
): Promise<EngineResult> {
  const result = await structuralChanges(
    inputFor({
      oldText,
      newText,
      language: languageOf(id),
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

async function texts(id: GrammarId, oldText: string, newText: string, overrides?: Overrides) {
  const changes = changesOf(await run(id, oldText, newText, overrides));
  return { old: spanTexts(oldText, changes.old), new: spanTexts(newText, changes.new) };
}

const wholeFile = (text: string): ChangedRegion[] => {
  const end = text.split("\n").length + 1;
  return [{ oldStart: 1, oldEnd: end, newStart: 1, newEnd: end }];
};

const PAIRS = GRAMMARS.flatMap((id) =>
  ["reindent", "rewrap", "rename", "added-argument"].map((name) => [id, name] as const),
).concat([["python", "moved-out-of-block"]]);

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

      expect(await texts(id, oldText, newText)).toEqual({ old: [], new: [] });
    },
  );

  it.each(GRAMMARS)("marks both uses of a renamed %s variable", async (id) => {
    const { oldText, newText } = readPair(id, "rename");
    const renamed = id === "python" ? "sum_" : "sum";

    expect(await texts(id, oldText, newText)).toEqual({
      old: ["total", "total"],
      new: [renamed, renamed],
    });
  });

  it.each(GRAMMARS)("marks only the added %s argument and its comma", async (id) => {
    const { oldText, newText } = readPair(id, "added-argument");

    expect(await texts(id, oldText, newText)).toEqual({ old: [], new: [",", "third"] });
  });

  it("marks a Python statement moved out of its block", async () => {
    const { oldText, newText } = readPair("python", "moved-out-of-block");

    expect(await texts("python", oldText, newText)).toEqual({ old: ["b"], new: ["b"] });
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
      expect(await texts("python", oldText, newText)).toEqual({ old: [moved], new: [moved] });
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
      expect(await texts(id, two, four)).toEqual({ old: [], new: [] });
    },
  );

  it.each([
    ["an insertion", "", "\n"],
    ["a deletion", "\n", ""],
  ])("marks %s past maxEditLength whole", async (_, oldBody, newBody) => {
    const body = "f(x);\n".repeat(300);
    const oldText = `a();\n${oldBody && body}`;
    const newText = `a();\n${newBody && body}`;

    const result = await texts("typescript", oldText, newText, { limits: { maxEditLength: 10 } });

    expect(result.old.length + result.new.length).toBe(1_500);
  });

  it.each([
    {
      name: "merges two regions sharing a token",
      oldText: "const s = `a\nb\nc\nd`;\n",
      newText: "const s = `a\nB\nc\nD`;\n",
      regions: [
        { oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 },
        { oldStart: 4, oldEnd: 5, newStart: 4, newEnd: 5 },
      ],
      expected: { old: ["a", "b", "c", "d"], new: ["a", "B", "c", "D"] },
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
    expect(await texts("typescript", oldText, newText, { regions })).toEqual(expected);
  });

  it.each(GRAMMARS)("fails a %s text that does not parse", async (id) => {
    const { oldText, newText } = readPair(id, "parse-error");

    expect(await run(id, oldText, newText)).toEqual({ ok: false, reason: "failed" });
  });

  it.each(PAIRS)("finds no change in a %s %s against itself", async (id, name) => {
    const { oldText } = readPair(id, name);

    const result = await run(id, oldText, oldText, { regions: wholeFile(oldText) });

    expect(changesOf(result)).toEqual({ old: [], new: [] });
  });

  it.each(PAIRS)("swaps the sides of a %s %s run backwards", async (id, name) => {
    const { oldText, newText } = readPair(id, name);
    const forward = changesOf(await run(id, oldText, newText));

    const backward = await run(id, newText, oldText, {
      regions: swapped(regionsOf(oldText, newText)),
    });

    expect(changesOf(backward)).toEqual({ old: forward.new, new: forward.old });
  });

  it("swaps the sides of a run whose diff has ties", async () => {
    const oldText = "a;\nb;\na;\n";
    const newText = "b;\na;\nb;\n";
    const forward = changesOf(
      await run("javascript", oldText, newText, { regions: wholeFile(oldText) }),
    );

    const backward = await run("javascript", newText, oldText, { regions: wholeFile(oldText) });

    expect(changesOf(backward)).toEqual({ old: forward.new, new: forward.old });
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

  it.each([{ maxTokens: 3 }, { maxEditLength: 1 }])("refuses past %o", async (limits) => {
    const { oldText, newText } = readPair("typescript", "rename");

    expect(await run("typescript", oldText, newText, { limits })).toEqual({
      ok: false,
      reason: "too-large",
    });
  });

  it("cancels a parse past maxParseMs, then parses normally again", async () => {
    const text = `${"[".repeat(100_000)}${"]".repeat(100_000)};\n`;
    const clock = countingClock();
    const { oldText, newText } = readPair("javascript", "rename");

    const result = await run("javascript", text, text, {
      limits: { maxParseMs: 5 },
      now: clock.now,
    });

    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(clock.calls).toBeLessThan(100);
    expect(await texts("javascript", oldText, newText)).toEqual({
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
    ).toEqual({ ok: false, reason: "too-large" });
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
    const fast = await texts("typescript", oldText, newText, {
      ...clockAfterPauses(),
      limits: { maxDiffMs: 100 },
    });

    expect(slow).toEqual({ ok: false, reason: "too-large" });
    expect(fast).toEqual({ old: ["a", "b"], new: ["x", "y"] });
  });

  it("splits a changed token spanning lines into one span per line", async () => {
    const oldText = "const s = `a\nb`;\n";
    const newText = "const s = `a\nc`;\n";

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

    const result = await texts("typescript", crlf(oldText), crlf(newText));

    expect(result).toEqual(await texts("typescript", oldText, newText));
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
