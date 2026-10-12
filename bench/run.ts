import { join } from "node:path";
import { parseArgs } from "node:util";
import { type CDPSession, chromium, type Page } from "@playwright/test";

interface BunPlugin {
  name: string;
  setup(build: {
    onResolve(
      options: { filter: RegExp },
      resolve: (args: { path: string; resolveDir: string }) => { path: string },
    ): void;
  }): void;
}

// The one slice of Bun's API this runner uses: `@types/bun` would be a new dependency.
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: "browser";
    format: "iife";
    loader: Record<string, "text">;
    plugins: BunPlugin[];
  }): Promise<{ success: boolean; logs: unknown[]; outputs: { text(): Promise<string> }[] }>;
  resolveSync(specifier: string, from: string): string;
};

const SIZES = [100, 300, 1000];

const { values } = parseArgs({ options: { "entry-size": { type: "string", default: "95" } } });
const entrySize = Number(values["entry-size"]);
if (!/^\d+$/.test(values["entry-size"]) || entrySize < 2) {
  console.error(`--entry-size must be a whole number of at least 2, not ${values["entry-size"]}`);
  process.exit(1);
}

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
  if (!built.success || !output) throw new AggregateError(built.logs, "the bench didn't build");
  return output.text();
}

async function styleMs(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return (metrics.find(({ name }) => name === "RecalcStyleDuration")?.value ?? 0) * 1000;
}

const round = (ms: number) => Math.round(ms * 10) / 10;

async function diffOrder(page: Page, files: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const elements = await page.evaluate(
    ([files, entrySize]) => window.bench.diffOrder.setUp(files, entrySize),
    [files, entrySize] as const,
  );
  const before = await styleMs(cdp);
  const apply = await page.evaluate(() => window.bench.diffOrder.apply());
  const applied = await styleMs(cdp);
  const rewrite = await page.evaluate(() => window.bench.diffOrder.rewrite());
  const rewritten = await styleMs(cdp);
  return {
    files,
    "elements/entry": elements,
    "apply ms": apply,
    "apply style ms": round(applied - before),
    "rewrite ms": rewrite,
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
