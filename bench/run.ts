/**
 * The large-diff benchmark, run by `mise run bench`: times the real diff order, section trees and
 * intent read in headless Chromium on synthetic diffs of 100, 300 and 1,000 files. Kept out of CI,
 * Vitest and Playwright on purpose, so no file here may match `*.{test,spec}.*` or `*.e2e.ts`.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type CDPSession, chromium, type Page } from "@playwright/test";
import type { Bench } from "./page";

// The one slice of Bun's API this runner uses: `@types/bun` would be a new dependency.
interface BunPlugin {
  name: string;
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      resolve: (args: { path: string; resolveDir: string }) => { path: string },
    ): void;
  }): void;
}

declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser";
    format: "iife";
    loader: Record<string, "text">;
    plugins: BunPlugin[];
  }): Promise<{ outputs: { text(): Promise<string> }[] }>;
  resolveSync(specifier: string, from: string): string;
};

declare const window: Window & { readonly bench: Bench };

const SIZES = [100, 300, 1000];

const { values } = parseArgs({
  // 95 = 2 + 31 lines × 3: the entries EXC-1969's numbers were measured on.
  options: { "entry-size": { type: "string", default: "95" } },
});
const entrySize = Number(values["entry-size"]);
if (!/^\d+$/.test(values["entry-size"]) || entrySize < 2) {
  console.error(`--entry-size must be a whole number of at least 2, not ${values["entry-size"]}`);
  process.exit(1);
}

// WXT imports CSS with Vite's `?raw` suffix, which Bun can't resolve; `loader` reads it as text.
const raw: BunPlugin = {
  name: "raw",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => ({
      path: Bun.resolveSync(path.slice(0, -"?raw".length), resolveDir),
    }));
  },
};

async function bundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dirname, "page.ts")],
    target: "browser",
    format: "iife",
    loader: { ".css": "text" },
    plugins: [raw],
  });
  const [output] = built.outputs;
  if (!output) throw new Error("the bench built no output");
  return output.text();
}

/** Chromium's style recalculation time so far, in ms: CDP reports a running total in seconds. */
async function styleMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const recalc = metrics.find(({ name }) => name === "RecalcStyleDuration");
  if (!recalc) throw new Error("Chromium reported no RecalcStyleDuration");
  return recalc.value * 1000;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

async function diffOrder(page: Page, files: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const order = await page.evaluateHandle(
    ([files, entrySize]) => window.bench.diffOrder(files, entrySize),
    [files, entrySize] as const,
  );
  const elements = await order.evaluate(({ elements }) => elements);
  const before = await styleMs(cdp);
  const applyMs = await order.evaluate((o) => o.apply());
  const applied = await styleMs(cdp);
  const rewriteMs = await order.evaluate((o) => o.rewrite());
  const rewritten = await styleMs(cdp);
  return {
    files,
    "elements/entry": elements,
    "apply ms": applyMs,
    "apply style ms": round(applied - before),
    "rewrite ms": rewriteMs,
    "rewrite style ms": round(rewritten - applied),
  };
}

const TABLES: [string, (page: Page, files: number) => Promise<object>][] = [
  ["Diff order", diffOrder],
  [
    "Section trees",
    (page, files) => page.evaluate((files) => window.bench.sectionTrees(files), files),
  ],
  ["Intent", (page, files) => page.evaluate((files) => window.bench.intent(files), files)],
];

const script = await bundle();
// The task installs no headless shell, so headless runs full Chromium.
const browser = await chromium.launch({ channel: "chromium" });
try {
  for (const [title, measure] of TABLES) {
    const rows = [];
    // ponytail: one cold run per size; take a median of repeats if the numbers prove noisy.
    for (const files of SIZES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
      await page.addScriptTag({ content: script });
      rows.push(await measure(page, files));
      await page.close();
    }
    console.log(title);
    console.table(rows);
  }
} finally {
  await browser.close();
}
