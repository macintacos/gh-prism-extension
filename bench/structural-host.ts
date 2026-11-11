/**
 * Benches the structural host in the built extension: whether the engine loads lazily, a cold and a
 * warm run on a long TypeScript file, a second grammar, a dropped job, and how long a PR data
 * port message waits while a run is in flight. Kept out of CI, Vitest and Playwright like the rest
 * of `bench/`.
 *
 *   bun bench/structural-host.ts <chromium|firefox>
 *
 * Builds a scratch copy of the working tree whose background also serves `bench/structural-host/serve.ts`
 * and whose bench-only content script relays a routed page's messages to it. Prints one JSON object
 * and exits 1 when a pass criterion fails.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { DEFAULT_LIMITS } from "../utils/structural/engine";
import { grammarOf } from "../utils/structural/grammar";
import { OFFSCREEN_IDLE_MS } from "../utils/structural/offscreen";
import type { StructuralRequest } from "../utils/structural/request";
import { buildCopy } from "./scratch-build";
import {
  benchCopy,
  edited,
  FIREFOX_IDLE_MS,
  launch,
  median,
  probePage,
  resultOf,
  send,
  sendAll,
} from "./structural-host/harness";
import type { RunResult } from "./structural-host/serve";

const browserName = process.argv[2];
if (browserName !== "chromium" && browserName !== "firefox") {
  console.error("usage: bun bench/structural-host.ts <chromium|firefox>");
  process.exit(1);
}

const ROOT = join(import.meta.dirname, "..");
const MAX_PING_MS = 25;
// Longer than the idle close, so the document has closed by the time the wait ends.
const IDLE_WAIT_MS = OFFSCREEN_IDLE_MS + 5_000;

function editedRequest(path: string, lines: readonly number[]): StructuralRequest {
  const oldText = readFileSync(join(ROOT, path), "utf8");
  return { oldText, ...edited(oldText, lines), grammar: grammarOf(path), limits: DEFAULT_LIMITS };
}

function pythonRequest(): StructuralRequest {
  const read = (side: string) =>
    readFileSync(
      join(ROOT, `tests/fixtures/structural/python/added-argument.${side}.py.txt`),
      "utf8",
    );
  const oldText = read("old");
  const newText = read("new");
  const region = {
    oldStart: 1,
    oldEnd: oldText.split("\n").length + 1,
    newStart: 1,
    newEnd: newText.split("\n").length + 1,
  };
  return {
    oldText,
    newText,
    grammar: grammarOf("x.py"),
    regions: [region],
    limits: DEFAULT_LIMITS,
  };
}

const runMs = (run: RunResult) => run.end - run.start;

/** Ends the background's life, so the next message starts a fresh one. */
async function stopBackground(page: Page): Promise<void> {
  if (browserName === "firefox") {
    await page.waitForTimeout(FIREFOX_IDLE_MS * 2);
    return;
  }
  const session = await page.context().newCDPSession(page);
  await session.send("ServiceWorker.enable");
  await session.send("ServiceWorker.stopAllWorkers");
  await session.detach();
}

/** One run with a ping sent `delayMs` into it, and whether the background handled the ping first. */
async function runWithPing(page: Page, request: StructuralRequest, delayMs: number) {
  const [run, ping] = await sendAll(page, [
    { message: { op: "run", request } },
    { message: "ping", delayMs },
  ]);
  const result = resultOf(run) as RunResult;
  const { handled } = await send<{ handled: number[] }>(page, { op: "pings" });
  return {
    ok: result.ok,
    reason: result.reason,
    runMs: runMs(result),
    pingDelayMs: delayMs,
    pingMs: ping?.ms ?? Number.NaN,
    pingDuringRun: (handled[0] ?? Number.POSITIVE_INFINITY) < result.end,
  };
}

/**
 * Runs the phases in order: a stopped background's load state, a cold run, a second grammar, idle
 * pings, warm-up then 20 warm runs with a ping each, a dropped job, and 12 large-file runs. Returns
 * the pass criteria with the samples behind them.
 */
async function measure(page: Page) {
  const reference = editedRequest(
    "entrypoints/content/files-page.ts",
    [101, 301, 501, 701, 901, 1101],
  );
  const smokeLines = readFileSync(join(ROOT, "e2e/smoke.e2e.ts"), "utf8").split("\n").length;
  const large = editedRequest(
    "e2e/smoke.e2e.ts",
    Array.from({ length: 10 }, (_, i) => Math.floor((smokeLines * (i + 0.5)) / 10)),
  );

  await stopBackground(page);
  const lazy = await send<{ loaded: boolean }>(page, { op: "state" });
  const cold = await runWithPing(page, reference, 5);
  const secondGrammar = await send<RunResult>(page, { op: "run", request: pythonRequest() });

  const idle: number[] = [];
  for (let i = 0; i < 10; i++) idle.push((await sendAll(page, [{ message: "ping" }]))[0]?.ms ?? 0);
  await send(page, { op: "pings" });

  const warmUp: RunResult[] = [];
  for (let i = 0; i < 3; i++)
    warmUp.push(await send<RunResult>(page, { op: "run", request: reference }));
  const warmRunMs = median(warmUp.map(runMs));
  const warm = [];
  for (let i = 0; i < 20; i++) {
    const lastRunMs: number = warm.at(-1)?.runMs ?? warmRunMs;
    warm.push(await runWithPing(page, reference, Math.random() * lastRunMs));
  }

  const dropped = await send<{ firstOk: boolean; secondRejected: boolean }>(page, {
    op: "dropped",
    request: reference,
  });

  const largeRuns = [];
  for (let i = 0; i < 12; i++) {
    const lastRunMs: number = largeRuns.at(-1)?.runMs ?? 200;
    largeRuns.push(await runWithPing(page, large, Math.random() * lastRunMs));
  }

  await stopBackground(page);
  const restart = await send<RunResult>(page, { op: "run", request: reference });

  await page.waitForTimeout(IDLE_WAIT_MS);
  const afterIdle = await send<{ loaded: boolean }>(page, { op: "state" });

  const warnings =
    browserName === "chromium"
      ? await send<{ loaded: string[]; withoutOffscreen: string[] } | null>(page, {
          op: "warnings",
        })
      : null;

  const maxWarmPingMs = Math.max(...warm.map((w) => w.pingMs));
  const maxLargePingMs = Math.max(...largeRuns.map((r) => r.pingMs));
  const warmPingsDuringRun = warm.filter((w) => w.pingDuringRun).length;
  const criteria = {
    lazy: !lazy.loaded,
    cold: cold.ok,
    secondGrammar: secondGrammar.ok,
    dropped: dropped.firstOk && dropped.secondRejected,
    warmOk: warm.every((w) => w.ok),
    pingWithinBound: Math.max(maxWarmPingMs, maxLargePingMs) <= MAX_PING_MS,
    warmPingsDuringRun: warmPingsDuringRun >= warm.length / 2,
    restartOk: restart.ok,
    idleDiscards: !afterIdle.loaded,
    ...(warnings && {
      noNewWarning: JSON.stringify(warnings.loaded) === JSON.stringify(warnings.withoutOffscreen),
    }),
  };
  return {
    browser: browserName,
    userAgent: await page.evaluate(() => navigator.userAgent),
    criteria,
    lazy,
    cold,
    secondGrammar: {
      ok: secondGrammar.ok,
      reason: secondGrammar.reason,
      runMs: runMs(secondGrammar),
    },
    idlePingMedianMs: median(idle),
    idlePingsMs: idle,
    warm: {
      medianWarmUpRunMs: warmRunMs,
      maxPingMs: maxWarmPingMs,
      pingsDuringRun: warmPingsDuringRun,
      runs: warm,
    },
    dropped,
    large: {
      lines: smokeLines,
      results: [...new Set(largeRuns.map((r) => (r.ok ? "ok" : r.reason)))],
      maxPingMs: maxLargePingMs,
      runs: largeRuns,
    },
    restart: { ok: restart.ok, reason: restart.reason, runMs: runMs(restart) },
    afterIdle,
    warnings,
  };
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-host-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-host-profile-"));
let context: BrowserContext | undefined;
try {
  benchCopy(copy);
  context = await launch(browserName, buildCopy(copy, browserName), profile);
  const page = await probePage(context);

  const results = await measure(page);
  console.log(JSON.stringify(results, null, 2));
  if (!Object.values(results.criteria).every(Boolean)) process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
