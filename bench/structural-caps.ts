/**
 * Benches the structural engine's caps in the built extension: per sample, the outcomes at
 * `DEFAULT_LIMITS`, and with every cap lifted the run, parse, and diff stage times. Kept out of CI,
 * Vitest and Playwright like the rest of `bench/`.
 *
 *   bun bench/structural-caps.ts <chromium|firefox>
 *
 * Samples: every fixture pair under `tests/fixtures/structural/`, the changed TypeScript, JavaScript
 * and Python files of nodejs/node#66212 (read only, over HTTP, never stored), a size ladder,
 * and an unrelated-sides ladder. Prints one JSON object and exits 1 when a sample within the size
 * caps answers `too-slow`, which only a quiet machine can promise.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, CDPSession, Page } from "@playwright/test";
import { parserFor, regionsOf } from "../tests/fixtures/structural";
import { DEFAULT_LIMITS, type EngineLimits } from "../utils/structural/engine";
import { type Grammar, grammarOf } from "../utils/structural/grammar";
import type { StructuralRequest } from "../utils/structural/request";
import { leafTokens } from "../utils/structural/tokens";
import { buildCopy } from "./scratch-build";
import {
  type BrowserName,
  benchCopy,
  edited,
  launch,
  median,
  probePage,
  runMs,
  send,
} from "./structural-host/harness";
import type { RunResult } from "./structural-host/serve";

const browserName = process.argv[2];
if (browserName !== "chromium" && browserName !== "firefox") {
  console.error("usage: bun bench/structural-caps.ts <chromium|firefox>");
  process.exit(1);
}

const ROOT = join(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "tests/fixtures/structural");
const PR = "nodejs/node/pulls/66212";
const MAX_PR_FILES = 40;
const LADDER = [50_000, 100_000, 150_000, 200_000, 250_000, 300_000];
const UNRELATED_TOKENS = [1_000, 2_000, 3_000];
const DEFAULT_RUNS = 20;
const LIFTED_RUNS = 5;
const LIFTED: EngineLimits = {
  maxTextLength: Number.MAX_SAFE_INTEGER,
  maxParseMs: Number.MAX_SAFE_INTEGER,
  maxTokens: Number.MAX_SAFE_INTEGER,
  maxEditLength: Number.MAX_SAFE_INTEGER,
  maxDiffMs: Number.MAX_SAFE_INTEGER,
};

interface Sample {
  readonly name: string;
  readonly oldText: string;
  readonly newText: string;
  readonly grammar: Grammar;
  readonly regions: StructuralRequest["regions"];
}

const wholeFile = (oldText: string, newText: string) => [
  {
    oldStart: 1,
    oldEnd: oldText.split("\n").length + 1,
    newStart: 1,
    newEnd: newText.split("\n").length + 1,
  },
];

function fixtureSamples(): Sample[] {
  return readdirSync(FIXTURES).flatMap((dir) =>
    readdirSync(join(FIXTURES, dir))
      .filter((file) => file.includes(".old."))
      .map((file) => {
        const oldText = readFileSync(join(FIXTURES, dir, file), "utf8");
        const newText = readFileSync(join(FIXTURES, dir, file.replace(".old.", ".new.")), "utf8");
        const grammar = grammarOf(file.replace(/\.txt$/, ""));
        if (!grammar) throw new Error(`no grammar for ${file}`);
        return {
          name: `fixture:${dir}/${file.replace(".old.", ".")}`,
          oldText,
          newText,
          grammar,
          regions: wholeFile(oldText, newText),
        };
      }),
  );
}

/** The largest modified files of the PR the engine has a grammar for, both sides read raw. */
async function prSamples(): Promise<Sample[]> {
  const ghJson = (args: string[]) =>
    JSON.parse(execFileSync("gh", ["api", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }));
  const pull = ghJson([`repos/${PR}`]) as { base: { sha: string }; head: { sha: string } };
  const files = (
    ghJson([`repos/${PR}/files`, "--paginate", "--slurp"]) as {
      filename: string;
      status: string;
    }[][]
  )
    .flat()
    .filter((file) => file.status === "modified" && grammarOf(file.filename));

  const read = async (sha: string, path: string) => {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${sha}/${path}`);
    if (!response.ok) throw new Error(`${response.status} reading ${path} at ${sha}`);
    return response.text();
  };
  const all = await Promise.all(
    files.map(async ({ filename }) => {
      const oldText = await read(pull.base.sha, filename);
      const newText = await read(pull.head.sha, filename);
      return {
        name: `pr:${filename}`,
        oldText,
        newText,
        grammar: grammarOf(filename) as Grammar,
        regions: regionsOf(oldText, newText),
      };
    }),
  );
  return all
    .toSorted(
      (a, b) =>
        Math.max(b.oldText.length, b.newText.length) - Math.max(a.oldText.length, a.newText.length),
    )
    .slice(0, MAX_PR_FILES);
}

/** `unit` repeated to about each ladder size, edited on every 50th line. */
function ladderSamples(label: string, unit: string, grammar: Grammar, comment: string): Sample[] {
  return LADDER.map((size) => {
    const oldText = unit.repeat(Math.max(1, Math.round(size / unit.length)));
    const lineCount = oldText.split("\n").length;
    const lines = Array.from({ length: Math.floor(lineCount / 50) }, (_, i) => (i + 1) * 50);
    return {
      name: `ladder:${label}:${size}`,
      oldText,
      grammar,
      ...edited(oldText, lines, comment),
    };
  });
}

/** Two sides of about `tokens` tokens each that share no line. */
function unrelatedSamples(): Sample[] {
  const grammar = grammarOf("x.ts") as Grammar;
  return UNRELATED_TOKENS.map((tokens) => {
    // Each old line is 7 tokens, each new line 9.
    const oldText = Array.from(
      { length: Math.round(tokens / 7) },
      (_, i) => `const a${i} = f(b${i});`,
    ).join("\n");
    const newText = Array.from(
      { length: Math.round(tokens / 9) },
      (_, i) => `let x${i} = [y${i}, 1];`,
    ).join("\n");
    return {
      name: `unrelated:${tokens}`,
      oldText,
      newText,
      grammar,
      regions: wholeFile(oldText, newText),
    };
  });
}

async function tokenCount(grammar: Grammar, text: string): Promise<number | null> {
  const tree = (await parserFor(grammar.id)).parse(text);
  if (!tree) return null;
  try {
    return leafTokens(tree, text, Number.POSITIVE_INFINITY)?.length ?? null;
  } finally {
    tree.delete();
  }
}

/** Chromium: a CDP session on the offscreen document, or undefined when none can be attached. */
async function offscreenHeap(page: Page): Promise<(() => Promise<number>) | undefined> {
  if (browserName !== "chromium") return undefined;
  const session: CDPSession = await page.context().newCDPSession(page);
  const { targetInfos } = (await session.send("Target.getTargets")) as {
    targetInfos: { targetId: string; url: string }[];
  };
  const target = targetInfos.find((info) => info.url.includes("offscreen"));
  if (!target) return undefined;
  const { sessionId } = (await session.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  })) as { sessionId: string };

  let next = 1;
  const call = (method: string) =>
    new Promise<unknown>((resolve) => {
      const id = next++;
      const listener = (event: { sessionId: string; message: string }) => {
        const reply = JSON.parse(event.message) as { id: number; result: unknown };
        if (event.sessionId !== sessionId || reply.id !== id) return;
        session.off("Target.receivedMessageFromTarget", listener);
        resolve(reply.result);
      };
      session.on("Target.receivedMessageFromTarget", listener);
      void session.send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({ id, method }),
      });
    });
  await call("Performance.enable");
  return async () => {
    const { metrics } = (await call("Performance.getMetrics")) as {
      metrics: { name: string; value: number }[];
    };
    return metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
  };
}

async function measure(page: Page, samples: readonly Sample[]) {
  const run = (sample: Sample, overrides: Partial<StructuralRequest>) =>
    send<RunResult>(page, {
      op: "run",
      request: {
        oldText: sample.oldText,
        newText: sample.newText,
        grammar: sample.grammar,
        regions: sample.regions,
        limits: DEFAULT_LIMITS,
        ...overrides,
      },
    });

  // The first run starts the engine, so the heap can be read only after it.
  const first = samples[0];
  if (first) await run(first, {});
  const heap = await offscreenHeap(page).catch(() => undefined);
  const heapBefore = heap ? await heap() : undefined;
  let heapPeak = heapBefore ?? 0;

  const results = [];
  for (const sample of samples) {
    const outcomes: Record<string, number> = {};
    const atDefaults: number[] = [];
    for (let i = 0; i < DEFAULT_RUNS; i++) {
      const result = await run(sample, {});
      const key = result.ok ? "ok" : (result.reason ?? "unknown");
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      atDefaults.push(runMs(result));
    }

    const lifted: number[] = [];
    for (let i = 0; i < LIFTED_RUNS; i++) lifted.push(runMs(await run(sample, { limits: LIFTED })));
    const identical: number[] = [];
    for (let i = 0; i < LIFTED_RUNS; i++)
      identical.push(
        runMs(await run(sample, { newText: sample.oldText, regions: [], limits: LIFTED })),
      );
    if (heap) heapPeak = Math.max(heapPeak, await heap());

    const [oldTokens, newTokens] = await Promise.all([
      tokenCount(sample.grammar, sample.oldText),
      tokenCount(sample.grammar, sample.newText),
    ]);
    const withinSizeCaps =
      Math.max(sample.oldText.length, sample.newText.length) <= DEFAULT_LIMITS.maxTextLength &&
      Math.max(oldTokens ?? 0, newTokens ?? 0) <= DEFAULT_LIMITS.maxTokens;
    results.push({
      name: sample.name,
      grammar: sample.grammar.id,
      length: { old: sample.oldText.length, new: sample.newText.length },
      tokens: { old: oldTokens, new: newTokens },
      regions: sample.regions.length,
      withinSizeCaps,
      outcomes,
      defaultsMedianMs: median(atDefaults),
      // Meaningful only where the defaults reach the diff: an edit-length refusal gives up there.
      defaultsDiffMs: median(atDefaults) - median(identical),
      liftedMedianMs: median(lifted),
      liftedMaxMs: Math.max(...lifted),
      parseMsPerSide: median(identical) / 2,
      diffMs: median(lifted) - median(identical),
    });
  }
  return {
    heap: heap
      ? { beforeFirstSample: heapBefore, peak: heapPeak }
      : { peakHeap: "not measured" as const },
    results,
  };
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-caps-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-caps-profile-"));
let context: BrowserContext | undefined;
try {
  const typescriptUnit = readFileSync(join(ROOT, "utils/github/pr-ref.ts"), "utf8");
  const pythonUnit = readFileSync(join(FIXTURES, "python/added-argument.old.py.txt"), "utf8");
  const samples = [
    ...fixtureSamples(),
    ...(await prSamples()),
    ...ladderSamples("typescript", typescriptUnit, grammarOf("x.ts") as Grammar, " // edited"),
    ...ladderSamples("python", pythonUnit, grammarOf("x.py") as Grammar, "  # edited"),
    ...unrelatedSamples(),
  ];

  benchCopy(copy);
  context = await launch(browserName as BrowserName, buildCopy(copy, browserName), profile);
  const page = await probePage(context);

  const { heap, results } = await measure(page, samples);
  const tooSlowWithinCaps = results
    .filter((r) => r.withinSizeCaps && (r.outcomes["too-slow"] ?? 0) > 0)
    .map((r) => r.name);
  console.log(
    JSON.stringify(
      {
        browser: browserName,
        userAgent: await page.evaluate(() => navigator.userAgent),
        limits: DEFAULT_LIMITS,
        tooSlowWithinCaps,
        heap,
        samples: results,
        uptime: execFileSync("uptime", { encoding: "utf8" }).trim(),
      },
      null,
      2,
    ),
  );
  if (tooSlowWithinCaps.length > 0) process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
