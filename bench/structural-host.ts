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

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type BrowserContext, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";
import { type ChangedRegion, DEFAULT_LIMITS } from "../utils/structural/engine";
import { grammarOf } from "../utils/structural/grammar";
import type { StructuralRequest } from "../utils/structural/request";
import type { BenchMessage, BenchReply, RunResult } from "./structural-host/serve";

const browserName = process.argv[2];
if (browserName !== "chromium" && browserName !== "firefox") {
  console.error("usage: bun bench/structural-host.ts <chromium|firefox>");
  process.exit(1);
}

const ROOT = join(import.meta.dirname, "..");
// Keep in sync with serve.ts's BENCH_PORT and pr-port.ts's PR_DATA_PORT; both modules import
// wxt/browser, which cannot load outside the extension.
const BENCH_PORT = "gh-prism:bench";
const PR_DATA_PORT = "gh-prism:pr-data";
const MAX_PING_MS = 25;
// Short enough to wait out, long enough that the gaps between the bench's messages never stop it.
const FIREFOX_IDLE_MS = 5000;

const BACKGROUND = `import { defineBackground } from "wxt/utils/define-background";
import { serveBench } from "@/bench/structural-host/serve";
import shipped from "@/utils/shipped-background";

export default defineBackground(() => {
  shipped.main();
  serveBench();
});
`;
const RELAY = `import { defineContentScript } from "wxt/utils/define-content-script";
import { relay } from "@/bench/structural-host/relay";

export default defineContentScript({ matches: ["https://github.com/probe*"], main: relay });
`;

/** Copies the working tree to `copy` with the bench's background and relay overlaid. */
function scratchCopy(copy: string): void {
  const paths = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    mkdirSync(dirname(join(copy, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(copy, path));
  }
  symlinkSync(join(ROOT, "node_modules"), join(copy, "node_modules"));

  const shipped = readFileSync(join(copy, "entrypoints/background.ts"), "utf8");
  writeFileSync(join(copy, "utils/shipped-background.ts"), shipped.replaceAll('"../utils/', '"./'));
  writeFileSync(join(copy, "entrypoints/background.ts"), BACKGROUND);
  writeFileSync(join(copy, "entrypoints/bench-relay.content.ts"), RELAY);
}

/** `text` with `" // edited"` appended to each 1-based line in `lines`, and the one-line regions. */
function edited(text: string, lines: readonly number[]) {
  const textLines = text.split("\n");
  for (const line of lines) textLines[line - 1] += " // edited";
  const regions: ChangedRegion[] = lines.map((line) => ({
    oldStart: line,
    oldEnd: line + 1,
    newStart: line,
    newEnd: line + 1,
  }));
  return { newText: textLines.join("\n"), regions };
}

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

// Installed in the page: sends each message through the relay after its delay, and resolves with
// every reply and its page-side round trip.
const PAGE_HELPER = () => {
  let next = 0;
  const send = (portName: string, toBg: unknown) =>
    new Promise((resolve) => {
      const n = next++;
      const start = performance.now();
      const listener = (event: MessageEvent) => {
        if (event.data?.n !== n || !("fromBg" in event.data)) return;
        removeEventListener("message", listener);
        resolve({ fromBg: event.data.fromBg, ms: performance.now() - start });
      };
      addEventListener("message", listener);
      postMessage({ toBg, portName, n }, "*");
    });
  const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  Object.assign(window, {
    benchAll: (list: { portName: string; toBg: unknown; delayMs: number }[]) =>
      Promise.all(list.map((r) => after(r.delayMs).then(() => send(r.portName, r.toBg)))),
  });
};

interface Reply {
  readonly fromBg: BenchReply | null;
  readonly ms: number;
}
type Message = DistributiveOmit<BenchMessage, "id"> | "ping";
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Sends each message after its delay, at once, and resolves with every reply in order. Throws when
 * the background dropped the port without replying (`fromBg` null) or answered with an error.
 */
async function sendAll(
  page: Page,
  list: { message: Message; delayMs?: number }[],
): Promise<Reply[]> {
  const replies = (await page.evaluate(
    (all) => (window as unknown as { benchAll: (l: unknown) => Promise<Reply[]> }).benchAll(all),
    list.map(({ message, delayMs = 0 }) =>
      message === "ping"
        ? { portName: PR_DATA_PORT, toBg: { id: 1 }, delayMs }
        : { portName: BENCH_PORT, toBg: { id: 1, ...message }, delayMs },
    ),
  )) as Reply[];
  for (const { fromBg } of replies) {
    if (!fromBg) throw new Error("the background sent no reply");
    if ("error" in fromBg) throw new Error(`the background failed: ${fromBg.error}`);
  }
  return replies;
}

const resultOf = (reply: Reply | undefined) =>
  reply?.fromBg && "result" in reply.fromBg ? reply.fromBg.result : undefined;

const send = async <T>(page: Page, message: Message) =>
  resultOf((await sendAll(page, [{ message }]))[0]) as T;

const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};
const runMs = (run: RunResult) => run.end - run.start;

async function launch(build: string, profile: string): Promise<BrowserContext> {
  if (browserName === "firefox")
    return withExtension(firefox, build).launchPersistentContext(profile, {
      firefoxUserPrefs: { "extensions.background.idle.timeout": FIREFOX_IDLE_MS },
    });
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
  });
}

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

async function waitForRelay(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const answered = await Promise.race([
      sendAll(page, [{ message: { op: "pings" } }]).then(() => true),
      page.waitForTimeout(500).then(() => false),
    ]).catch(() => false);
    if (answered) return;
  }
  throw new Error("the relay never answered");
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
  };
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-host-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-host-profile-"));
let context: BrowserContext | undefined;
try {
  scratchCopy(copy);
  execFileSync(
    "bunx",
    ["--no-install", "wxt", "build", "-b", browserName === "firefox" ? "firefox" : "chrome"],
    {
      cwd: copy,
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  context = await launch(
    join(copy, ".output", browserName === "firefox" ? "firefox-mv3" : "chrome-mv3"),
    profile,
  );
  await context.route("https://github.com/probe*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>probe</title>",
    }),
  );
  await context.addInitScript(PAGE_HELPER);
  const page = await context.newPage();
  await page.goto("https://github.com/probe");
  await waitForRelay(page);

  const results = await measure(page);
  console.log(JSON.stringify(results, null, 2));
  if (!Object.values(results.criteria).every(Boolean)) process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
