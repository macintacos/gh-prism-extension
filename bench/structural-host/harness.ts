/**
 * What `bench/structural-host.ts` and `bench/structural-caps.ts` share: a scratch copy whose
 * background serves `serve.ts`, the browser launch, and the page-side helper that sends bench and
 * PR data port messages through `relay.ts`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";
import type { ChangedRegion } from "../../utils/structural/engine";
import { scratchCopy } from "../scratch-build";
import type { BenchMessage, BenchReply, RunResult } from "./serve";

export type BrowserName = "chromium" | "firefox";

const ROOT = join(import.meta.dirname, "../..");
// Keep in sync with serve.ts's BENCH_PORT and pr-port.ts's PR_DATA_PORT; both modules import
// wxt/browser, which cannot load outside the extension.
const BENCH_PORT = "gh-prism:bench";
const PR_DATA_PORT = "gh-prism:pr-data";
// Short enough to wait out, long enough that the gaps between the bench's messages never stop it.
// A caller that waits for the background to stop waits longer than this.
export const FIREFOX_IDLE_MS = 5000;

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
export function benchCopy(copy: string): void {
  const shipped = readFileSync(join(ROOT, "entrypoints/background.ts"), "utf8");
  scratchCopy(copy, {
    "utils/shipped-background.ts": shipped.replaceAll('"../utils/', '"./'),
    "entrypoints/background.ts": BACKGROUND,
    "entrypoints/bench-relay.content.ts": RELAY,
  });
}

/** `text` with `comment` appended to each 1-based line in `lines`, and the one-line regions. */
export function edited(text: string, lines: readonly number[], comment = " // edited") {
  const textLines = text.split("\n");
  for (const line of lines) textLines[line - 1] += comment;
  const regions: ChangedRegion[] = lines.map((line) => ({
    oldStart: line,
    oldEnd: line + 1,
    newStart: line,
    newEnd: line + 1,
  }));
  return { newText: textLines.join("\n"), regions };
}

// Installed in the page: sends each message through the relay after its delay, and resolves with
// every reply and its page-side round trip.
export const PAGE_HELPER = () => {
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

export interface Reply {
  readonly fromBg: BenchReply | null;
  readonly ms: number;
}
export type Message = DistributiveOmit<BenchMessage, "id"> | "ping";
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Sends each message after its delay, at once, and resolves with every reply in order. Throws when
 * the background dropped the port without replying (`fromBg` null) or answered with an error.
 */
export async function sendAll(
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

/** A reply's result, or undefined when there is none. */
export const resultOf = (reply: Reply | undefined) =>
  reply?.fromBg && "result" in reply.fromBg ? reply.fromBg.result : undefined;

/** Sends one message and resolves with its result cast to `T`, unchecked. */
export const send = async <T>(page: Page, message: Message) =>
  resultOf((await sendAll(page, [{ message }]))[0]) as T;

export const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** A host run's duration in the background's clock. */
export const runMs = (run: RunResult) => run.end - run.start;

/**
 * A persistent context in `profile` with `build` loaded; in Firefox the background's idle timeout
 * is shortened to `FIREFOX_IDLE_MS`.
 */
export async function launch(
  browserName: BrowserName,
  build: string,
  profile: string,
): Promise<BrowserContext> {
  if (browserName === "firefox")
    return withExtension(firefox, build).launchPersistentContext(profile, {
      firefoxUserPrefs: { "extensions.background.idle.timeout": FIREFOX_IDLE_MS },
    });
  return chromium.launchPersistentContext(profile, {
    channel: "chromium",
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
  });
}

/** Resolves once the relay answers a message; throws after about 25 s of silence. */
export async function waitForRelay(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const answered = await Promise.race([
      sendAll(page, [{ message: { op: "pings" } }]).then(() => true),
      page.waitForTimeout(500).then(() => false),
    ]).catch(() => false);
    if (answered) return;
  }
  throw new Error("the relay never answered");
}

/** Routes the probe page, installs `PAGE_HELPER`, and opens a page whose relay answers. */
export async function probePage(context: BrowserContext): Promise<Page> {
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
  return page;
}
