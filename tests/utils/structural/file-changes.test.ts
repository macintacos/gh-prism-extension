import { createTwoFilesPatch } from "diff";
import { describe, expect, it, vi } from "vitest";
import type { CommitHead, DiffHead, PrHead } from "../../../utils/github/pr-ref";
import { createPrDataSource } from "../../../utils/github/pr-source";
import type { StructuralChanges } from "../../../utils/structural/changes";
import { structuralChanges } from "../../../utils/structural/engine";
import {
  CACHED_SPANS,
  fileChanges,
  STRUCTURAL_READS_AT_ONCE,
} from "../../../utils/structural/file-changes";
import { grammarOf } from "../../../utils/structural/grammar";
import { DEFAULT_LIMITS } from "../../../utils/structural/limits";
import { PLAIN_TEXT } from "../../../utils/structural/plain-text";
import type { EngineRun } from "../../../utils/structural/request";
import { heldResponses, routedFetch } from "../../fixtures/fetch";
import { parserFor, readPair } from "../../fixtures/structural";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const pr: PrHead = { kind: "pr", owner: "o", repo: "r", number: 1, headSha: sha };
const commit: CommitHead = { kind: "commit", owner: "o", repo: "r", headSha: sha };

const diffUrlOf = (head: DiffHead) =>
  head.kind === "pr"
    ? `https://github.com/o/r/pull/${head.number}.diff`
    : `https://github.com/o/r/commit/${head.headSha}.diff`;
const rawUrlOf = (head: DiffHead, path: string) =>
  `https://github.com/o/r/raw/${head.headSha}/${path}`;

const lines = (...parts: string[]) => parts.join("\n");
const BOM = String.fromCharCode(0xfeff);

/** A `.diff` block modifying `path` from `oldText` to `newText`. */
function modified(path: string, oldText: string, newText: string): string {
  const patch = createTwoFilesPatch("a", "b", oldText, newText, "", "", { context: 3 });
  return lines(
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    patch.slice(patch.indexOf("@@")),
  );
}

const OLD = "const a = 1;\nconst b = 2;\n";
const NEW = "const a = 1;\nconst b = 3;\n";
const MAIN = modified("src/main.ts", OLD, NEW);

const NOT_APPLICABLE = lines(
  "diff --git a/web/src/data/catalog.ts b/web/src/data/catalog.ts",
  "new file mode 100644",
  "index 0000000..3af7dbf",
  "--- /dev/null",
  "+++ b/web/src/data/catalog.ts",
  "@@ -0,0 +1 @@",
  "+export const catalog = [];",
  "diff --git a/old.ts b/old.ts",
  "deleted file mode 100644",
  "index 1234567..0000000",
  "--- a/old.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-gone",
  "diff --git a/a.ts b/b.ts",
  "similarity index 100%",
  "rename from a.ts",
  "rename to b.ts",
  "diff --git a/web/public/logo.png b/web/public/logo.png",
  "new file mode 100644",
  "index 0000000..613754c",
  "Binary files /dev/null and b/web/public/logo.png differ",
  "",
);

const CHANGES: StructuralChanges = {
  old: [{ line: 2, startCol: 10, endCol: 11 }],
  new: [{ line: 2, startCol: 10, endCol: 11 }],
};

interface Setup {
  diff?: string;
  head?: DiffHead;
  routes?: Record<string, () => Promise<Response>>;
  run?: EngineRun;
  cachedSpans?: number;
}

function setup({
  diff = `${MAIN}\n${NOT_APPLICABLE}`,
  head = pr,
  routes = {},
  ...rest
}: Setup = {}) {
  const fetchFn = routedFetch({
    [diffUrlOf(head)]: async () => new Response(diff),
    [rawUrlOf(head, "src/main.ts")]: async () => new Response(NEW),
    ...routes,
  });
  const run = vi.fn<EngineRun>(rest.run ?? (async () => ({ ok: true, changes: CHANGES })));
  const changes = fileChanges({
    source: createPrDataSource(fetchFn),
    run,
    cachedSpans: rest.cachedSpans ?? CACHED_SPANS,
  });
  return { fetchFn, run, changes };
}

const signal = () => new AbortController().signal;
const rawCalls = (fetchFn: ReturnType<typeof routedFetch>) =>
  fetchFn.mock.calls.filter(([url]) => String(url).includes("/raw/")).length;

describe("fileChanges", () => {
  describe("membership", () => {
    it("answers failed for a path the primed diff does not list, fetching nothing", async () => {
      const { fetchFn, run, changes } = setup();
      await changes(pr, "src/main.ts", signal());
      const calls = fetchFn.mock.calls.length;

      const result = await changes(pr, "src/other.ts", signal());

      expect(result).toEqual({ ok: false, problem: "failed" });
      expect(fetchFn.mock.calls.length).toBe(calls);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it.each(["src/other.ts", "%2e%2e/x"])(
      "fetches only the diff for unlisted %s on a cold source",
      async (path) => {
        const { fetchFn, run, changes } = setup();

        const result = await changes(pr, path, signal());

        expect(result).toEqual({ ok: false, problem: "failed" });
        expect(fetchFn.mock.calls.map(([url]) => String(url))).toEqual([diffUrlOf(pr)]);
        expect(run).not.toHaveBeenCalled();
      },
    );
  });

  it.each([
    ["an added file", "web/src/data/catalog.ts"],
    ["a deleted file", "old.ts"],
    ["a pure rename", "b.ts"],
    ["a binary", "web/public/logo.png"],
  ])("answers not-applicable for %s without reading it", async (_name, path) => {
    const { fetchFn, run, changes } = setup();

    const result = await changes(pr, path, signal());

    expect(result).toEqual({ ok: false, problem: "not-applicable" });
    expect(rawCalls(fetchFn)).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  describe("unsupported", () => {
    it("answers it for a path with no grammar without reading it", async () => {
      const { fetchFn, run, changes } = setup({ diff: modified("src/lib.zig", OLD, NEW) });

      const result = await changes(pr, "src/lib.zig", signal());

      expect(result).toEqual({ ok: false, problem: "unsupported" });
      expect(rawCalls(fetchFn)).toBe(0);
      expect(run).not.toHaveBeenCalled();
    });

    it("maps the engine's unsupported", async () => {
      const { changes } = setup({ run: async () => ({ ok: false, reason: "unsupported" }) });

      expect(await changes(pr, "src/main.ts", signal())).toEqual({
        ok: false,
        problem: "unsupported",
      });
    });
  });

  it("runs the engine on the rebuilt texts and answers its changes", async () => {
    const { run, changes } = setup();

    const result = await changes(pr, "src/main.ts", signal());

    expect(result).toEqual({ ok: true, changes: CHANGES });
    expect(run.mock.calls[0]?.[0]).toEqual({
      oldText: OLD,
      newText: NEW,
      grammar: grammarOf("src/main.ts"),
      regions: [{ oldStart: 2, oldEnd: 3, newStart: 2, newEnd: 3 }],
      limits: DEFAULT_LIMITS,
    });
  });

  it("runs the engine on a .txt file as plain text", async () => {
    const { run, changes } = setup({
      diff: modified("docs/notes.txt", "one\ntwo\n", "one\nthree\n"),
      routes: { [rawUrlOf(pr, "docs/notes.txt")]: async () => new Response("one\nthree\n") },
    });

    const result = await changes(pr, "docs/notes.txt", signal());

    expect(result).toEqual({ ok: true, changes: CHANGES });
    expect(run.mock.calls[0]?.[0]).toMatchObject({ newText: "one\nthree\n", grammar: PLAIN_TEXT });
  });

  describe("refusals", () => {
    it.each(["too-large", "failed"] as const)("maps the engine's %s", async (reason) => {
      const { changes } = setup({ run: async () => ({ ok: false, reason }) });

      expect(await changes(pr, "src/main.ts", signal())).toEqual({ ok: false, problem: reason });
    });

    it("answers failed when the engine rejects without an abort", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { changes } = setup({ run: () => Promise.reject(new Error("crashed")) });

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: false, problem: "failed" });
      warn.mockRestore();
    });

    it("answers failed without running when the patch does not apply to the head", async () => {
      const { run, changes } = setup({
        routes: { [rawUrlOf(pr, "src/main.ts")]: async () => new Response("unrelated\n") },
      });

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: false, problem: "failed" });
      expect(run).not.toHaveBeenCalled();
    });
  });

  it("restores a byte order mark the head read dropped", async () => {
    const { run, changes } = setup({
      diff: modified("src/main.ts", `${BOM}${OLD}`, `${BOM}${NEW}`),
    });

    const result = await changes(pr, "src/main.ts", signal());

    expect(result.ok).toBe(true);
    expect(run.mock.calls[0]?.[0].newText).toBe(`${BOM}${NEW}`);
    expect(run.mock.calls[0]?.[0].oldText).toBe(`${BOM}${OLD}`);
  });

  describe("fetch failures", () => {
    it("passes a rate-limited diff through", async () => {
      const { changes } = setup({
        routes: { [diffUrlOf(pr)]: async () => new Response("", { status: 429 }) },
      });

      expect(await changes(pr, "src/main.ts", signal())).toEqual({
        ok: false,
        problem: "rate-limited",
      });
    });

    it.each([
      [404, "no-access"],
      [429, "rate-limited"],
    ])("passes a %i head read through as %s", async (status, problem) => {
      const { changes } = setup({
        routes: { [rawUrlOf(pr, "src/main.ts")]: async () => new Response("", { status }) },
      });

      expect(await changes(pr, "src/main.ts", signal())).toEqual({ ok: false, problem });
    });

    it("reads the head again after a rate-limited read", async () => {
      const raw = vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(new Response("", { status: 429 }))
        .mockResolvedValueOnce(new Response(NEW));
      const { changes } = setup({ routes: { [rawUrlOf(pr, "src/main.ts")]: raw } });
      await changes(pr, "src/main.ts", signal());

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: true, changes: CHANGES });
      expect(raw).toHaveBeenCalledTimes(2);
    });
  });

  describe("cache", () => {
    it("answers a second request for a file from the cache", async () => {
      const { fetchFn, run, changes } = setup();
      await changes(pr, "src/main.ts", signal());
      const calls = fetchFn.mock.calls.length;

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: true, changes: CHANGES });
      expect(fetchFn.mock.calls.length).toBe(calls);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it.each(["unsupported", "too-large"] as const)(
      "answers the engine's %s from the cache",
      async (reason) => {
        const { run, changes } = setup({ run: async () => ({ ok: false, reason }) });
        await changes(pr, "src/main.ts", signal());

        const result = await changes(pr, "src/main.ts", signal());

        expect(result).toEqual({ ok: false, problem: reason });
        expect(run).toHaveBeenCalledTimes(1);
      },
    );

    it("refuses a head past the text limit without running, and caches it", async () => {
      const big = "x".repeat(DEFAULT_LIMITS.maxTextLength + 1);
      const { fetchFn, run, changes } = setup({
        routes: { [rawUrlOf(pr, "src/main.ts")]: async () => new Response(big) },
      });
      await changes(pr, "src/main.ts", signal());

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: false, problem: "too-large" });
      expect(run).not.toHaveBeenCalled();
      expect(rawCalls(fetchFn)).toBe(1);
    });

    it("fetches the diff once for concurrent requests on a cold source", async () => {
      const { fetchFn, changes } = setup();

      await Promise.all([
        changes(pr, "src/main.ts", signal()),
        changes(pr, "web/src/data/catalog.ts", signal()),
        changes(pr, "old.ts", signal()),
      ]);

      expect(fetchFn.mock.calls.filter(([url]) => String(url) === diffUrlOf(pr))).toHaveLength(1);
    });

    it("answers a stage past its deadline as too large, and runs again on the next request", async () => {
      const { run, changes } = setup({ run: async () => ({ ok: false, reason: "too-slow" }) });
      await changes(pr, "src/main.ts", signal());

      const result = await changes(pr, "src/main.ts", signal());

      expect(result).toEqual({ ok: false, problem: "too-large" });
      expect(run).toHaveBeenCalledTimes(2);
    });

    it("runs again after the engine failed", async () => {
      const { run, changes } = setup({ run: async () => ({ ok: false, reason: "failed" }) });
      await changes(pr, "src/main.ts", signal());

      await changes(pr, "src/main.ts", signal());

      expect(run).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["a different head", { ...pr, headSha: otherSha }],
      ["a commit at the same SHA", commit],
    ])("runs again for %s", async (_name, other: DiffHead) => {
      const { run, changes } = setup({
        routes: {
          [diffUrlOf(other)]: async () => new Response(`${MAIN}\n`),
          [rawUrlOf(other, "src/main.ts")]: async () => new Response(NEW),
        },
      });
      await changes(pr, "src/main.ts", signal());

      await changes(other, "src/main.ts", signal());

      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  describe("bound", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const diff = `${paths.map((path) => modified(path, OLD, NEW)).join("\n")}\n`;
    const routes = Object.fromEntries(
      paths.map((path) => [rawUrlOf(pr, path), async () => new Response(NEW)]),
    );

    it("evicts the oldest entry past the bound and keeps the newest", async () => {
      // Each entry weighs 3: two spans and one.
      const { run, changes } = setup({ diff, routes, cachedSpans: 6 });
      for (const path of paths) await changes(pr, path, signal());

      await changes(pr, "src/c.ts", signal());
      await changes(pr, "src/a.ts", signal());

      expect(run).toHaveBeenCalledTimes(4);
    });

    it("keeps no entry heavier than the bound", async () => {
      const { run, changes } = setup({ diff, routes, cachedSpans: 2 });
      await changes(pr, "src/a.ts", signal());

      await changes(pr, "src/a.ts", signal());

      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  describe("cancellation", () => {
    it("rejects without running when aborted during the head read", async () => {
      const { release, held } = heldResponses();
      const { run, changes } = setup({ routes: { [rawUrlOf(pr, "src/main.ts")]: held(NEW) } });
      const controller = new AbortController();

      const answer = changes(pr, "src/main.ts", controller.signal);
      await vi.waitFor(() => expect(release).toHaveLength(1));
      controller.abort();
      release[0]?.();

      await expect(answer).rejects.toThrow();
      expect(run).not.toHaveBeenCalled();
    });

    it("aborts the engine's signal, rejects, and caches nothing", async () => {
      let received: AbortSignal | undefined;
      const { run, changes } = setup({
        run: (_request, runSignal) => {
          received = runSignal;
          return new Promise((_resolve, reject) =>
            runSignal.addEventListener("abort", () => reject(runSignal.reason)),
          );
        },
      });
      const controller = new AbortController();

      const answer = changes(pr, "src/main.ts", controller.signal);
      await vi.waitFor(() => expect(run).toHaveBeenCalled());
      controller.abort();

      await expect(answer).rejects.toThrow();
      expect(received?.aborted).toBe(true);
      run.mockImplementation(async () => ({ ok: true, changes: CHANGES }));
      await changes(pr, "src/main.ts", signal());
      expect(run).toHaveBeenCalledTimes(2);
    });
  });

  describe("gate", () => {
    const count = STRUCTURAL_READS_AT_ONCE + 2;
    const paths = Array.from({ length: count }, (_, i) => `src/f${i}.ts`);
    const diff = `${paths.map((path) => modified(path, OLD, NEW)).join("\n")}\n`;

    function heldSetup() {
      const { release, held } = heldResponses();
      let pending = 0;
      let peak = 0;
      const routes = Object.fromEntries(
        paths.map((path) => [
          rawUrlOf(pr, path),
          async () => {
            pending++;
            peak = Math.max(peak, pending);
            const response = await held(NEW)();
            pending--;
            return response;
          },
        ]),
      );
      return { release, peak: () => peak, ...setup({ diff, routes }) };
    }

    const drain = async (release: (() => void)[]) => {
      for (let i = 0; i < count; i++) {
        await vi.waitFor(() => expect(release.length).toBeGreaterThan(i));
        release[i]?.();
      }
    };

    it("holds head reads to the limit at once", async () => {
      const { release, peak, changes } = heldSetup();

      const answers = paths.map((path) => changes(pr, path, signal()));
      await vi.waitFor(() => expect(release).toHaveLength(STRUCTURAL_READS_AT_ONCE));
      await drain(release);
      await Promise.all(answers);

      expect(peak()).toBe(STRUCTURAL_READS_AT_ONCE);
    });

    it("never reads for a request aborted while it waits", async () => {
      const { release, fetchFn, changes } = heldSetup();
      const controller = new AbortController();
      const first = paths
        .slice(0, STRUCTURAL_READS_AT_ONCE)
        .map((path) => changes(pr, path, signal()));
      const waiting = changes(pr, paths[count - 1] ?? "", controller.signal);
      await vi.waitFor(() => expect(release).toHaveLength(STRUCTURAL_READS_AT_ONCE));

      controller.abort();
      for (const go of release) go();
      await Promise.all(first);

      await expect(waiting).rejects.toThrow();
      expect(fetchFn.mock.calls.some(([url]) => String(url).endsWith(`f${count - 1}.ts`))).toBe(
        false,
      );
    });
  });

  it("answers a commit's file through the real engine", async () => {
    const { oldText, newText } = readPair("typescript", "rename");
    const parser = await parserFor("typescript");
    const path = "src/rename.ts";
    const { changes } = setup({
      head: commit,
      diff: `${modified(path, oldText, newText)}\n`,
      routes: { [rawUrlOf(commit, path)]: async () => new Response(newText) },
      run: (request, runSignal) =>
        structuralChanges({
          ...request,
          language:
            typeof request.grammar === "object"
              ? { grammar: request.grammar, parser }
              : request.grammar,
          signal: runSignal,
          now: () => 0,
          pause: () => Promise.resolve(),
        }),
    });

    const result = await changes(commit, path, signal());

    expect(result.ok && result.changes.new.length).toBeGreaterThan(0);
  });
});
