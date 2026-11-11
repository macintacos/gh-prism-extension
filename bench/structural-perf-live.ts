/**
 * Live performance bench for Structural mode: loads a signed-in pull request once per variant per
 * run, interleaved, each in a fresh profile, and compares median load and scroll-frame timings
 * against the EXC-2222 spike's no-slowdown bar. Kept out of CI, Vitest and Playwright like the
 * rest of `bench/`.
 *
 *   bun bench/structural-perf-live.ts <chromium|firefox> <storage-state path> [--runs <n>] [--url <url>] [--trunk <built extension directory>]
 *
 * Variants: `trunk` (the `--trunk` build, skipped without it), `mode-off` and `mode-on` (both the
 * plain `.output/<browser>-mv3`, so run `mise run build` first). Every variant first opens
 * sandbox PR #4, already Split, so all start from a warmed cache; there `mode-on` presses the
 * Structural segment, so the profile saves the mode. Paint is read
 * from the page itself, with no probe. Headless frame timing differs from a real device's, equally
 * for every variant. Exits 1 when a bar fails. On the measured page it only reads and scrolls.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Page } from "@playwright/test";
import { STRUCTURAL_ATTRS, TABLE_ATTR } from "../entrypoints/content/diffs/structural-attrs";
import {
  type BrowserName,
  launch,
  NOTICE_SELECTOR,
  segmentOf,
} from "./structural-mode-live/harness";

const USAGE =
  "usage: bun bench/structural-perf-live.ts <chromium|firefox> <storage-state path> [--runs <n>] [--url <url>] [--trunk <built extension directory>]";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "5" },
    url: {
      type: "string",
      default: "https://github.com/nodejs/node/pull/66212/changes?diff=split",
    },
    trunk: { type: "string" },
  },
});
const [browserArg, stateArg] = positionals;
if ((browserArg !== "chromium" && browserArg !== "firefox") || !stateArg) {
  console.error(USAGE);
  process.exit(1);
}
const browserName: BrowserName = browserArg;
const statePath: string = stateArg;
const runs = Number(values.runs);
const url = values.url;
const QUIET_MS = 2000;
const PR4 = "https://github.com/macintacos/gh-prism-sandbox/pull/4/changes?diff=split";
const shipped = resolve(`.output/${browserName === "firefox" ? "firefox" : "chrome"}-mv3`);

type Variant = "trunk" | "mode-off" | "mode-on";
const variants: Variant[] = values.trunk
  ? ["trunk", "mode-off", "mode-on"]
  : ["mode-off", "mode-on"];
const buildOf = (variant: Variant) => (variant === "trunk" ? resolve(values.trunk ?? "") : shipped);

interface Seen {
  painted: number;
  notices: Record<string, number>;
  /** Scroll fraction, 0 to 1, where the scroll last found a newly painted or noticed file. */
  lastNewAt: number;
}

interface Run {
  firstDiffMs: number;
  loadMs: number;
  frames: number[];
  errors: string[];
  seen: Seen;
}

/** Page-side: stamps the first diff table and the diff list's last childList change. */
function watchLoad() {
  const bench = { first: 0, last: performance.now() };
  Object.assign(window, { __bench: bench });
  let list: Element | null = null;
  const watch = new MutationObserver(() => {
    if (!bench.first && document.querySelector('table[role="grid"]'))
      bench.first = performance.now();
    const found = document.querySelector('[data-testid="progressive-diffs-list"]');
    if (found && found !== list) {
      list = found;
      bench.last = performance.now();
      new MutationObserver(() => {
        bench.last = performance.now();
      }).observe(found, { childList: true, subtree: true });
    }
    if (bench.first && list) watch.disconnect();
  });
  watch.observe(document, { childList: true, subtree: true });
}

/**
 * Page-side: rAF-stepped scroll at 3,000 px/s for at most 20 s, returning frame deltas, and every
 * 500 ms noting which files carry structural paint or a notice, by anchor, as the list virtualizes.
 */
async function scrollFrames({ attr, notices }: { attr: string; notices: string }) {
  scrollTo(0, 0);
  const painted = new Set<string>();
  const noticed = new Map<string, string>();
  let lastNewAt = 0;
  const note = () => {
    const before = painted.size + noticed.size;
    for (const t of document.querySelectorAll(`table[${attr}]`))
      painted.add(t.getAttribute("data-diff-anchor") ?? "");
    for (const n of document.querySelectorAll(notices)) {
      const anchor = n.nextElementSibling?.getAttribute("data-diff-anchor");
      if (anchor) noticed.set(anchor, n.textContent ?? "");
    }
    if (painted.size + noticed.size > before)
      lastNewAt = (scrollY + innerHeight) / document.documentElement.scrollHeight;
  };
  const frame = () => new Promise<number>((done) => requestAnimationFrame(done));
  let previous = await frame();
  const start = previous;
  let noted = start;
  const deltas: number[] = [];
  while (previous - start < 20_000) {
    const now = await frame();
    deltas.push(now - previous);
    scrollBy(0, (3000 * (now - previous)) / 1000);
    previous = now;
    if (now - noted >= 500) {
      note();
      noted = now;
    }
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 1) break;
  }
  note();
  const counts: Record<string, number> = {};
  for (const text of noticed.values()) counts[text] = (counts[text] ?? 0) + 1;
  return { frames: deltas, seen: { painted: painted.size, notices: counts, lastNewAt } };
}

/**
 * Opens PR4 so every variant's timed load starts from the same warmed cache; for `mode-on`, also
 * saves Structural in the profile by pressing its segment and waiting for paint.
 */
async function prime(page: Page, variant: Variant): Promise<void> {
  await page.goto(PR4);
  await page.locator(".gh-prism-section").first().waitFor({ timeout: 30_000 });
  await page.locator("table[data-diff-anchor]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  if (variant !== "mode-on") return;
  await segmentOf(page, "Structural").click();
  await page
    .locator(STRUCTURAL_ATTRS.map((a) => `[${a}]`).join(", "))
    .first()
    .waitFor({
      timeout: 60_000,
    });
}

async function measure(variant: Variant): Promise<Run> {
  const profile = mkdtempSync(join(tmpdir(), "perf-live-"));
  const context = await launch(browserName, buildOf(variant), profile, statePath);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await prime(page, variant);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(watchLoad);
    await page.goto(url, { waitUntil: "commit" });

    let state = { first: 0, last: 0, now: 0 };
    for (let tries = 0; tries < 480; tries++) {
      await page.waitForTimeout(250);
      state = await page.evaluate(() => {
        const { first, last } = (window as unknown as { __bench: { first: number; last: number } })
          .__bench;
        return { first, last, now: performance.now() };
      });
      if (state.first && state.now - state.last >= QUIET_MS) break;
    }
    const { frames, seen } = await page.evaluate(scrollFrames, {
      attr: TABLE_ATTR,
      notices: NOTICE_SELECTOR,
    });
    return { firstDiffMs: state.first, loadMs: state.last, frames, errors, seen };
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

const percentile = (values: readonly number[], p: number) => {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? Number.NaN;
};
const median = (values: readonly number[]) => percentile(values, 50);
const fixed = (value: number, digits = 1) => (Number.isNaN(value) ? "-" : value.toFixed(digits));
const over = (frames: readonly number[], ms: number) => frames.filter((f) => f > ms).length;

interface Medians {
  firstDiffMs: number;
  loadMs: number;
  p50: number;
  p95: number;
  slowPct: number;
  over50: number;
  errors: number;
}

function mediansOf(set: readonly Run[]): Medians {
  const pick = (f: (run: Run) => number) => median(set.map(f));
  return {
    firstDiffMs: pick((r) => r.firstDiffMs),
    loadMs: pick((r) => r.loadMs),
    p50: pick((r) => percentile(r.frames, 50)),
    p95: pick((r) => percentile(r.frames, 95)),
    slowPct: pick((r) => (100 * over(r.frames, 16.7)) / r.frames.length),
    over50: pick((r) => over(r.frames, 50)),
    errors: set.reduce((sum, r) => sum + r.errors.length, 0),
  };
}

/** The spike's no-slowdown bar, `candidate` against `baseline`; one printed line per bar. */
function bars(candidate: Variant, baseline: Variant, m: Record<Variant, Medians>): boolean {
  const c = m[candidate];
  const b = m[baseline];
  const lines: [string, boolean, string][] = [
    [
      "loadMs",
      c.loadMs <= b.loadMs + Math.max(100, 0.05 * b.loadMs),
      `${fixed(c.loadMs, 0)} vs ${fixed(b.loadMs, 0)}`,
    ],
    ["p95", c.p95 <= b.p95 + 2, `${fixed(c.p95)} vs ${fixed(b.p95)}`],
    ["%>16.7ms", c.slowPct <= b.slowPct + 2, `${fixed(c.slowPct)} vs ${fixed(b.slowPct)}`],
  ];
  let ok = true;
  for (const [name, passed, numbers] of lines) {
    ok &&= passed;
    console.log(`bar ${candidate} vs ${baseline} ${name}: ${passed ? "ok" : `FAILED ${numbers}`}`);
  }
  return ok;
}

console.log(`${browserName} before: ${execFileSync("uptime", { encoding: "utf8" }).trim()}`);
console.log(`url: ${url}`);
const results = Object.fromEntries(variants.map((v) => [v, [] as Run[]])) as Record<Variant, Run[]>;
for (let index = 0; index < runs; index++)
  for (const variant of variants) {
    const run = await measure(variant);
    results[variant].push(run);
    console.error(
      `run ${index + 1} ${variant}: loadMs=${Math.round(run.loadMs)} p95=${fixed(percentile(run.frames, 95))} frames=${run.frames.length} errors=${run.errors.length}`,
    );
  }
console.log(`${browserName} after: ${execFileSync("uptime", { encoding: "utf8" }).trim()}`);

const medians = Object.fromEntries(variants.map((v) => [v, mediansOf(results[v])])) as Record<
  Variant,
  Medians
>;
console.log(`\n${browserName}, ${runs} runs, medians (headless frame timing)\n`);
console.log("| variant | firstDiffMs | loadMs | p50 | p95 | %>16.7ms | >50ms | page errors |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const v of variants) {
  const m = medians[v];
  console.log(
    `| ${v} | ${fixed(m.firstDiffMs, 0)} | ${fixed(m.loadMs, 0)} | ${fixed(m.p50)} | ${fixed(m.p95)} | ${fixed(m.slowPct)} | ${fixed(m.over50, 0)} | ${m.errors} |`,
  );
}
for (const v of variants) {
  const messages = new Set(results[v].flatMap((r) => r.errors));
  for (const message of messages) console.log(`${v} page error: ${message}`);
}
for (const [index, run] of results["mode-on"].entries())
  console.log(
    `mode-on run ${index + 1}: ${run.seen.painted} painted files, last new file at ${fixed(100 * run.seen.lastNewAt)}% of the page, notices ${JSON.stringify(run.seen.notices)}`,
  );

let ok = bars("mode-on", "mode-off", medians);
if (values.trunk) ok = bars("mode-off", "trunk", medians) && ok;
for (const v of ["mode-off", "mode-on"] as const) {
  const passed = medians[v].errors === 0;
  ok &&= passed;
  console.log(`bar ${v} page errors: ${passed ? "ok" : `FAILED ${medians[v].errors}`}`);
}
process.exit(ok ? 0 : 1);
