/**
 * Live performance bench for Structural mode: loads a signed-in pull request once per variant per
 * run, each in a fresh profile, and compares median load and scroll-frame timings against the
 * no-slowdown bars: `loadMs` within max(100 ms, 5%), p95 within 2 ms, and frames over 16.7 ms
 * within 2 points. Kept out of CI, Vitest and Playwright like the rest of `bench/`.
 *
 *   bun bench/structural-perf-live.ts <chromium|firefox> <storage-state path> [--runs <n>] [--url <url>] [--start <file path>] [--trunk <built extension directory>] [--label <text>]
 *
 * Variants: `trunk` (the `--trunk` build, skipped without it), `mode-off` and `mode-on` (both the
 * plain `.output/<browser>-mv3`, so run `mise run build` first). Each run rotates the variants'
 * order. Every variant first opens sandbox PR #4, already Split, so all start from a warmed cache;
 * there `mode-on` presses the Structural segment, so the profile saves the mode.
 *
 * Once the load settles, every variant scrolls untimed until the file at path `--start` mounts,
 * then times a scroll from it at 3,000 px/s for at most 20 s. The default URL's first stretch
 * holds only files with no grammar, so its default start opens its longest run of modified
 * JavaScript, where a smoke run painted 12 files in Chromium and 11 in Firefox, about as many as
 * the engine keeps pace with at that speed; another URL starts at the top. GitHub mounts a file only by scrolling to it. A load that
 * never settles fails the run. `loadMs` stamps the pull request's diff list going quiet, so it
 * prints `n/a` on any other page.
 *
 * Runs: 5; a failed timing bar is rerun once with `--runs 9`, which decides. The paired-difference
 * line beside each `loadMs` bar is informational. `--label` prints first, naming a rerun. Paint is
 * read from the page itself, with no probe. Headless frame timing differs from a real device's,
 * equally for every variant. Exits 1 when a bar fails. On the measured page it only reads and
 * scrolls. EXC-2222
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Page } from "@playwright/test";
import { STRUCTURAL_ATTRS, TABLE_ATTR } from "../entrypoints/content/diffs/structural-attrs";
import { median } from "./structural-host/harness";
import {
  type BrowserName,
  launch,
  load,
  NOTICE_SELECTOR,
  segmentOf,
} from "./structural-mode-live/harness";

const USAGE =
  "usage: bun bench/structural-perf-live.ts <chromium|firefox> <storage-state path> [--runs <n>] [--url <url>] [--start <file path>] [--trunk <built extension directory>] [--label <text>]";
const DEFAULT_URL = "https://github.com/nodejs/node/pull/66212/changes?diff=split";
// Opens the default URL's longest run of modified JavaScript, its npm tap snapshots and tests.
const DEFAULT_URL_START = "deps/npm/tap-snapshots/test/lib/cli/exit-handler.js.test.cjs";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "5" },
    url: { type: "string", default: DEFAULT_URL },
    start: { type: "string" },
    trunk: { type: "string" },
    label: { type: "string" },
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
const start = values.start ?? (url === DEFAULT_URL ? DEFAULT_URL_START : undefined);
const onPull = new URL(url).pathname.includes("/pull/");
const QUIET_MS = 2000;
const LOAD_TIMEOUT_MS = 120_000;
const PR4 = "https://github.com/macintacos/gh-prism-sandbox/pull/4/changes?diff=split";
const shipped = join(
  import.meta.dirname,
  "..",
  ".output",
  `${browserName === "firefox" ? "firefox" : "chrome"}-mv3`,
);

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
 * Page-side: steps down untimed until the file at path `from` mounts and puts it at the top, then
 * a rAF-stepped scroll at 3,000 px/s for at most 20 s, returning frame deltas, and every 500 ms
 * noting which files carry structural paint or a notice, by anchor, as the list virtualizes.
 * Throws when the page ends before `from` mounts.
 */
async function scrollFrames({
  attr,
  notices,
  from,
}: {
  attr: string;
  notices: string;
  from: string | undefined;
}) {
  scrollTo(0, 0);
  if (from) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(from));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const selector = `[data-diff-anchor="diff-${hex}"], #diff-${hex}`;
    // The list grows as it mounts, so the page's end counts only after 5 s without growth.
    let stuck = 0;
    for (;;) {
      const file = document.querySelector(selector);
      if (file) {
        scrollBy(0, file.getBoundingClientRect().top);
        break;
      }
      const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 1;
      stuck = atEnd ? stuck + 1 : 0;
      if (stuck > 50) throw new Error(`${from} never mounted`);
      scrollBy(0, 2000);
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  await new Promise((done) => setTimeout(done, 2000));
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
  const begin = previous;
  let noted = begin;
  const deltas: number[] = [];
  while (previous - begin < 20_000) {
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
  await load(page, PR4);
  if (variant !== "mode-on") return;
  await segmentOf(page, "Structural").click();
  await page
    .locator(STRUCTURAL_ATTRS.map((a) => `[${a}]`).join(", "))
    .first()
    .waitFor({
      timeout: 60_000,
    });
}

/**
 * Polls `watchLoad`'s stamps until a diff has mounted and the diff list has been quiet for
 * `QUIET_MS`; throws after `LOAD_TIMEOUT_MS` without that.
 */
async function settled(page: Page) {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => {
      const { first, last } = (window as unknown as { __bench: { first: number; last: number } })
        .__bench;
      return { first, last, now: performance.now() };
    });
    if (state.first && state.now - state.last >= QUIET_MS) return state;
  }
  throw new Error(`the load did not settle within ${LOAD_TIMEOUT_MS / 1000} s`);
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

    const state = await settled(page);
    const { frames, seen } = await page.evaluate(scrollFrames, {
      attr: TABLE_ATTR,
      notices: NOTICE_SELECTOR,
      from: start,
    });
    return {
      firstDiffMs: state.first,
      loadMs: onPull ? state.last : Number.NaN,
      frames,
      errors,
      seen,
    };
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
    ["p95", c.p95 <= b.p95 + 2, `${fixed(c.p95)} vs ${fixed(b.p95)}`],
    ["%>16.7ms", c.slowPct <= b.slowPct + 2, `${fixed(c.slowPct)} vs ${fixed(b.slowPct)}`],
  ];
  if (onPull)
    lines.unshift([
      "loadMs",
      c.loadMs <= b.loadMs + Math.max(100, 0.05 * b.loadMs),
      `${fixed(c.loadMs, 0)} vs ${fixed(b.loadMs, 0)}`,
    ]);
  let ok = true;
  for (const [name, passed, numbers] of lines) {
    ok &&= passed;
    console.log(`bar ${candidate} vs ${baseline} ${name}: ${passed ? "ok" : `FAILED ${numbers}`}`);
  }
  if (onPull) {
    const paired = median(
      results[candidate].map((run, i) => run.loadMs - (results[baseline][i]?.loadMs ?? 0)),
    );
    console.log(
      `paired ${candidate} minus ${baseline} loadMs: median ${fixed(paired, 0)} ms (informational, decides nothing)`,
    );
  }
  return ok;
}

/** `variants` rotated left by `index`, so each run starts with a different variant. */
const rotated = (index: number) => {
  const by = index % variants.length;
  return [...variants.slice(by), ...variants.slice(0, by)];
};

if (values.label) console.log(values.label);
console.log(`${browserName} before: ${execFileSync("uptime", { encoding: "utf8" }).trim()}`);
console.log(`url: ${url}, timed scroll from ${start ?? "the top"}`);
const results = Object.fromEntries(variants.map((v) => [v, [] as Run[]])) as Record<Variant, Run[]>;
for (let index = 0; index < runs; index++)
  for (const variant of rotated(index)) {
    const run = await measure(variant);
    results[variant].push(run);
    console.error(
      `run ${index + 1} ${variant}: loadMs=${onPull ? Math.round(run.loadMs) : "n/a"} p95=${fixed(percentile(run.frames, 95))} frames=${run.frames.length} errors=${run.errors.length}`,
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
    `| ${v} | ${fixed(m.firstDiffMs, 0)} | ${onPull ? fixed(m.loadMs, 0) : "n/a"} | ${fixed(m.p50)} | ${fixed(m.p95)} | ${fixed(m.slowPct)} | ${fixed(m.over50, 0)} | ${m.errors} |`,
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

const painted = median(results["mode-on"].map((run) => run.seen.painted));
let ok = painted > 0;
console.log(`bar mode-on painted: ${ok ? `ok (${painted} files)` : "FAILED 0"}`);
ok = bars("mode-on", "mode-off", medians) && ok;
if (values.trunk) ok = bars("mode-off", "trunk", medians) && ok;
for (const v of ["mode-off", "mode-on"] as const) {
  const passed = medians[v].errors === 0;
  ok &&= passed;
  console.log(`bar ${v} page errors: ${passed ? "ok" : `FAILED ${medians[v].errors}`}`);
}
process.exit(ok ? 0 : 1);
