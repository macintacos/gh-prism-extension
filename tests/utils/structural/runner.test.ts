import { describe, expect, it, vi } from "vitest";
import { packagedWasmPaths } from "../../../scripts/tasks/grammars";
import { DEFAULT_LIMITS } from "../../../utils/structural/engine";
import { type GrammarId, grammarOf } from "../../../utils/structural/grammar";
import { GRAMMAR_WASM, RUNTIME_WASM } from "../../../utils/structural/packaged";
import { PLAIN_TEXT } from "../../../utils/structural/plain-text";
import type { StructuralRequest } from "../../../utils/structural/request";
import { engineRunner } from "../../../utils/structural/runner";

const PATHS = new Map(packagedWasmPaths());

const runnerWith = (urlOf: (file: string) => string) =>
  engineRunner({ urlOf, now: () => performance.now(), pause: () => Promise.resolve() });

const packagedUrl = () => vi.fn((file: string) => PATHS.get(file) ?? "");

const REGIONS = [{ oldStart: 1, oldEnd: 2, newStart: 1, newEnd: 2 }];
const TYPESCRIPT: StructuralRequest = {
  oldText: "const total = add(1, 2);\n",
  newText: "const total = sum(1, 2);\n",
  grammar: grammarOf("a.ts"),
  regions: REGIONS,
  limits: DEFAULT_LIMITS,
};
const PYTHON: StructuralRequest = {
  oldText: "x = 1\n",
  newText: "x = 2\n",
  grammar: grammarOf("a.py"),
  regions: REGIONS,
  limits: DEFAULT_LIMITS,
};
const live = () => new AbortController().signal;

describe("engineRunner", () => {
  // First: web-tree-sitter binds its runtime once per realm, so only the file's first init locates it.
  it("loads the runtime and each grammar once, on first use", async () => {
    const urlOf = packagedUrl();
    const run = runnerWith(urlOf);

    const result = await run(TYPESCRIPT, live());
    expect(result).toMatchObject({
      ok: true,
      changes: {
        old: [{ line: 1, startCol: 14, endCol: 17 }],
        new: [{ line: 1, startCol: 14, endCol: 17 }],
      },
    });
    expect(urlOf.mock.calls.map(([file]) => file).sort()).toEqual(
      [RUNTIME_WASM, GRAMMAR_WASM.typescript].sort(),
    );

    await run(TYPESCRIPT, live());
    expect(urlOf).toHaveBeenCalledTimes(2);

    const python = await run(PYTHON, live());
    expect(python.ok).toBe(true);
    expect(urlOf).toHaveBeenCalledTimes(3);
    expect(urlOf).toHaveBeenLastCalledWith(GRAMMAR_WASM.python);
  });

  it("diffs plain text by word and loads nothing", async () => {
    const urlOf = packagedUrl();
    const run = runnerWith(urlOf);

    const result = await run(
      { ...TYPESCRIPT, oldText: "one two\n", newText: "one three\n", grammar: PLAIN_TEXT },
      live(),
    );

    expect(result).toEqual({
      ok: true,
      changes: {
        old: [{ line: 1, startCol: 4, endCol: 7 }],
        new: [{ line: 1, startCol: 4, endCol: 9 }],
        matches: [{ old: 1, new: 1, count: 1 }],
      },
    });
    expect(urlOf).not.toHaveBeenCalled();
  });

  it.each(Object.keys(GRAMMAR_WASM) as GrammarId[])(
    "loads no grammar but %s's own for a request in it",
    async (id) => {
      const urlOf = packagedUrl();
      const run = runnerWith(urlOf);
      const request = { ...TYPESCRIPT, oldText: "", newText: "", regions: [] };

      const result = await run(
        { ...request, grammar: { id, indentationSensitive: false } },
        live(),
      );

      expect(result.ok).toBe(true);
      expect(
        urlOf.mock.calls.map(([file]) => file).filter((file) => file !== RUNTIME_WASM),
      ).toEqual([GRAMMAR_WASM[id]]);
    },
  );

  it("refuses a request without a grammar and loads nothing", async () => {
    const urlOf = packagedUrl();
    const run = runnerWith(urlOf);

    const result = await run({ ...TYPESCRIPT, grammar: undefined }, live());

    expect(result).toEqual({ ok: false, reason: "unsupported" });
    expect(urlOf).not.toHaveBeenCalled();
  });

  it("fails a request whose WebAssembly does not load, and retries it on the next", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const urlOf = vi.fn(() => "/nonexistent/gh-prism.wasm");
    const run = runnerWith(urlOf);

    const first = await run(TYPESCRIPT, live());
    const callsAfterFirst = urlOf.mock.calls.length;
    const second = await run(TYPESCRIPT, live());

    expect(first).toEqual({ ok: false, reason: "failed" });
    expect(second).toEqual({ ok: false, reason: "failed" });
    expect(urlOf.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("typescript"), expect.anything());
    warn.mockRestore();
  });

  it("rejects with the reason of an aborted signal", async () => {
    const run = runnerWith(packagedUrl());
    const controller = new AbortController();
    const reason = new Error("left the page");
    controller.abort(reason);

    await expect(run(TYPESCRIPT, controller.signal)).rejects.toBe(reason);
  });
});
