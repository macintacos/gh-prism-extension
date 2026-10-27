/**
 * The large-diff benchmark, run by `mise run bench`: times the real diff order, section trees,
 * sidebar resize and intent read in headless Chromium on synthetic diffs of 100, 300 and 1,000
 * files. Kept out of CI, Vitest and Playwright on purpose, so no file here may match
 * `*.{test,spec}.*` or `*.e2e.ts`.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
    onLoad(
      options: { filter: RegExp },
      load: (args: { path: string }) => Promise<{ contents: string; loader: "text" }>,
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

// WXT imports CSS with Vite's `?inline` suffix, which Bun can't resolve; `loader` reads it as
// text, so the sheets reach the page without Tailwind's utilities.
const inline: BunPlugin = {
  name: "inline",
  setup(build) {
    build.onResolve({ filter: /\?inline$/ }, ({ path, resolveDir }) => ({
      path: Bun.resolveSync(path.slice(0, -"?inline".length), resolveDir),
    }));
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => ({
      contents: await withImports(path),
      loader: "text",
    }));
  },
};

/**
 * `path`'s sheet with each plain `@import` replaced by the imported sheet, as Vite inlines it. A
 * shadow root can't fetch the import, and without `ui/reveal.css` a row's full-name copy lays out
 * inline, taking room from its folder units. Imports with a modifier, such as Tailwind's
 * `prefix(tw)`, stay.
 */
async function withImports(path: string): Promise<string> {
  const sheet = await readFile(path, "utf8");
  const imports = [...sheet.matchAll(/@import "([^"]+)";/g)];
  const inlined = await Promise.all(
    imports.map(([, url = ""]) => withImports(join(dirname(path), url))),
  );
  return imports.reduce((text, [statement], i) => text.replace(statement, inlined[i] ?? ""), sheet);
}

async function bundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: [join(import.meta.dirname, "page.ts")],
    target: "browser",
    format: "iife",
    loader: { ".css": "text" },
    plugins: [inline],
  });
  const [output] = built.outputs;
  if (!output) throw new Error("the bench built no output");
  return output.text();
}

/** Chromium's running total of `metric`, in ms: CDP reports it in seconds. */
async function metricMs(cdp: CDPSession, metric: string): Promise<number> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const total = metrics.find(({ name }) => name === metric);
  if (!total) throw new Error(`Chromium reported no ${metric}`);
  return total.value * 1000;
}

const styleMs = (cdp: CDPSession) => metricMs(cdp, "RecalcStyleDuration");

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

/** Mounts the section trees; times the mount as main-thread work, so waits for a frame don't count. */
async function sectionTrees(page: Page, files: number, hosts: "sidebar" | "fixed") {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const trees = await page.evaluateHandle(
    ([files, hosts]) => window.bench.sectionTrees(files, hosts),
    [files, hosts] as const,
  );
  const before = await metricMs(cdp, "TaskDuration");
  await trees.evaluate((t) => t.mount());
  const mountMs = round((await metricMs(cdp, "TaskDuration")) - before);
  return { files, hosts, "mount ms": mountMs, ...(await trees.evaluate((t) => t.rerenders())) };
}

const TABLES: [string, (page: Page, files: number) => Promise<object>][] = [
  ["Diff order", diffOrder],
  ["Section trees", (page, files) => sectionTrees(page, files, "sidebar")],
  ["Section trees, fixed-height hosts", (page, files) => sectionTrees(page, files, "fixed")],
  ["Resize", (page, files) => page.evaluate((files) => window.bench.resize(files), files)],
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
