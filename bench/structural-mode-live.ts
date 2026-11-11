/**
 * Live check of Structural mode in the built extension on signed-in GitHub pages: nothing
 * structural with the preference off, each on-screen file painted or skipped for a reason with it
 * on, and GitHub's Unified turning it off. Kept out of CI, Vitest and Playwright like the rest of
 * `bench/`.
 *
 *   bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]
 *
 * Builds a scratch copy of the working tree with a bench-only content script that sets and reads
 * the preference and asks the port for a file's answer. Choosing Unified changes the account's
 * saved Layout; the run chooses the original again before it ends, on failure too. Prints one line
 * per check, ends with `mismatch: <n> of <m>`, and exits 1 on a failed assertion.
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";
import { buildCopy, scratchCopy } from "./scratch-build";
import { type Layout, type LayoutChoice, withLayoutRestored } from "./structural-mode-live/layout";
import type { ProbeAnswer, ProbeRequest } from "./structural-mode-live/probe";

const [browserName, state, ...urlArgs] = process.argv.slice(2);
if ((browserName !== "chromium" && browserName !== "firefox") || !state) {
  console.error(
    "usage: bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]",
  );
  process.exit(1);
}
const statePath: string = state;

const SANDBOX = "https://github.com/macintacos/gh-prism-sandbox";
const PR4 = `${SANDBOX}/pull/4/changes`;
const URLS = urlArgs.length
  ? urlArgs
  : [
      `${PR4}?diff=split`,
      `${SANDBOX}/pull/3/changes?diff=split`,
      `${SANDBOX}/commit/8d807ee?diff=split`,
      `${SANDBOX}/commit/4630717?diff=split`,
    ];
// Keep in sync with structural.ts's attributes and highlight names.
const STRUCTURAL_ATTRS = ["data-gh-prism-structural", "data-gh-prism-quiet", "data-gh-prism-moved"];
const PROBE = `import { defineContentScript } from "wxt/utils/define-content-script";
import { probe } from "@/bench/structural-mode-live/probe";

export default defineContentScript({ matches: ["https://github.com/*"], main: probe });
`;

const log = (line: string) => console.log(line);

class Failure extends Error {}

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) throw new Failure(`${name}: FAILED ${detail}`);
  log(`${name}: ok ${detail}`.trimEnd());
}

/** GitHub's anchor for a file's diff: `diff-` and the SHA-256 of its path. */
const anchorOf = (path: string) => `diff-${createHash("sha256").update(path).digest("hex")}`;

/**
 * Asks the probe content script, retrying until it answers, and returns its result as `T`
 * unchecked: the caller names the type the probe's `op` replies with.
 */
async function ask<T>(page: Page, request: ProbeRequest, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reply = await Promise.race([
      page.evaluate(
        (request) =>
          new Promise<{ result?: unknown; error?: string }>((resolve) => {
            const n = Math.random();
            const listener = (event: MessageEvent) => {
              if (event.data?.probeReply !== n) return;
              removeEventListener("message", listener);
              resolve(event.data);
            };
            addEventListener("message", listener);
            postMessage({ probe: n, request }, "*");
          }),
        request,
      ),
      page.waitForTimeout(request.op === "answers" ? timeoutMs : 1000).then(() => undefined),
    ]);
    if (reply?.error) throw new Error(`probe ${request.op}: ${reply.error}`);
    if (reply) return reply.result as T;
    if (Date.now() > deadline) throw new Error(`probe ${request.op}: no answer`);
  }
}

/** Loads `url` and waits for gh-prism's sections, then for GitHub's re-render after load. */
async function load(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(".gh-prism-section").first().waitFor({ timeout: 30_000 });
  await page.locator("table[data-diff-anchor]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4000);
}

/** What the DOM holds of structural mode. */
const structuralTraces = (page: Page) =>
  page.evaluate(
    (attrs) => ({
      attributes: document.querySelectorAll(attrs.map((a) => `[${a}]`).join(", ")).length,
      sheets: [...document.querySelectorAll("style")].filter((style) =>
        style.textContent?.includes("::highlight(gh-prism-"),
      ).length,
    }),
    STRUCTURAL_ATTRS,
  );

async function offscreenDocuments(context: BrowserContext): Promise<number> {
  const worker = context.serviceWorkers()[0];
  if (!worker) return 0;
  return worker.evaluate(() =>
    (
      globalThis as unknown as {
        chrome: { runtime: { getContexts(f: object): Promise<unknown[]> } };
      }
    ).chrome.runtime
      .getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })
      .then((found) => found.length),
  );
}

/** Pass 1: with the preference at its default, no URL shows any trace of structural mode. */
async function modeOff(page: Page): Promise<void> {
  check("default preference off", (await ask<unknown>(page, { op: "get" })) === false);
  for (const url of URLS) {
    await load(page, url);
    const [added, removed] = await ask<number[]>(page, { op: "highlights" });
    const traces = await structuralTraces(page);
    const offscreen = browserName === "chromium" ? await offscreenDocuments(page.context()) : 0;
    check(
      `off ${url}`,
      added === 0 &&
        removed === 0 &&
        traces.attributes === 0 &&
        traces.sheets === 0 &&
        offscreen === 0,
      JSON.stringify({ added, removed, ...traces, offscreen }),
    );
  }
  log("mode off: ok");
}

type Classification =
  | { readonly kind: "unmounted" | "not-split" }
  | { readonly kind: "painted" | "unpainted" }
  | { readonly kind: "mismatch"; readonly detail: string };

/** How `anchor`'s mounted table compares with `answer`'s text, and whether it was painted. */
const classify = (page: Page, anchor: string, answer: ProbeAnswer & { ok: true }) =>
  page.evaluate(
    ({ anchor, text }): Classification => {
      const table = document.querySelector(`table[data-diff-anchor="${anchor}"]`);
      if (!table) return { kind: "unmounted" };
      if (table.querySelector(":scope > colgroup")?.childElementCount !== 4)
        return { kind: "not-split" };
      for (const code of table.querySelectorAll(
        "td.diff-text-cell > code.diff-text.addition, td.diff-text-cell > code.diff-text.deletion",
      )) {
        const [, letter, line] =
          /([LR])(\d+)$/.exec(code.closest("td")?.dataset.lineAnchor ?? "") ?? [];
        const shown = code.querySelector(":scope > .diff-text-inner")?.textContent;
        const side = letter === "R" ? "new" : "old";
        const expected = text[side][Number(line)];
        if (letter && shown !== expected)
          return {
            kind: "mismatch",
            detail: `${letter}${line} page ${JSON.stringify(shown)} port ${JSON.stringify(expected)}`,
          };
      }
      return { kind: table.hasAttribute("data-gh-prism-structural") ? "painted" : "unpainted" };
    },
    { anchor, text: answer.text },
  );

/** Split tables mounted wholly below the viewport, and how many of them are painted. */
const belowFold = (page: Page) =>
  page.evaluate(() => {
    const below = [...document.querySelectorAll("table[data-diff-anchor]")].filter(
      (table) =>
        table.querySelector(":scope > colgroup")?.childElementCount === 4 &&
        table.getBoundingClientRect().top > innerHeight,
    );
    return {
      below: below.length,
      painted: below.filter((table) => table.hasAttribute("data-gh-prism-structural")).length,
    };
  });

/** Scrolls `url` top to bottom, letting each step settle, and classifies every file it mounts. */
async function scrollAndClassify(
  page: Page,
  answers: Record<string, ProbeAnswer>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  let lastY = -1;
  for (let step = 0; step < 60; step++) {
    await page.waitForTimeout(2500);
    for (const [path, answer] of Object.entries(answers)) {
      if (!answer.ok) {
        results.set(path, `problem:${answer.problem}`);
        continue;
      }
      const found = await classify(page, anchorOf(path), answer);
      if (found.kind === "unmounted" || found.kind === "not-split") {
        if (!results.has(path)) results.set(path, found.kind);
        continue;
      }
      if (results.get(path) === "painted") continue;
      results.set(path, found.kind === "mismatch" ? `mismatch ${found.detail}` : found.kind);
    }
    const y = await page.evaluate(() => scrollY);
    if (y === lastY) break;
    lastY = y;
    await page.mouse.wheel(0, 700);
  }
  return results;
}

/** Pass 2: with the preference on, each file the port answered `ok` for paints or mismatches. */
async function modeOn(page: Page): Promise<void> {
  await ask(page, { op: "set", on: true });
  check("preference set on", (await ask<unknown>(page, { op: "get" })) === true);
  let mismatches = 0;
  let answeredOk = 0;
  let unpainted = 0;
  let mostFiles = { url: "", files: -1 };
  for (const url of URLS) {
    await load(page, url);
    const paths = await ask<string[]>(page, { op: "paths" });
    const answers = await ask<Record<string, ProbeAnswer>>(page, { op: "answers", paths });
    // A URL whose every answer is a problem paints nothing anywhere, so it proves nothing there.
    const paintable = Object.values(answers).some((answer) => answer.ok);
    if (paintable && paths.length > mostFiles.files) mostFiles = { url, files: paths.length };
    const results = await scrollAndClassify(page, answers);
    for (const [path, result] of results) {
      log(`${url} ${path}: ${result}`);
      if (answers[path]?.ok) answeredOk++;
      if (result.startsWith("mismatch")) mismatches++;
      if (result === "unpainted") unpainted++;
    }
  }

  // A short window, so a file of that URL starts below the fold.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1600, height: 300 });
  await load(page, mostFiles.url);
  const fold = await belowFold(page);
  if (viewport) await page.setViewportSize(viewport);
  check(
    `unscrolled ${mostFiles.url}`,
    fold.below > 0 && fold.painted === 0,
    `(${fold.below} split tables below the fold, never scrolled to, ${fold.painted} painted)`,
  );
  check("no unpainted file", unpainted === 0, `(${unpainted})`);
  log(`mismatch: ${mismatches} of ${answeredOk}`);
}

/** The gear menu's Layout choice on `page`, read and chosen as a person does. */
function gearLayout(page: Page): LayoutChoice {
  const gear = () =>
    page
      .getByRole("button", { name: "Diff settings" })
      .or(
        page
          .locator("#diff-content-parent")
          .getByRole("button", { name: "Open diff view settings" }),
      )
      .first();
  const item = (layout: Layout) =>
    page.getByRole("menuitemradio", { name: layout === "split" ? "Split" : "Unified" });
  return {
    async read() {
      await gear().click();
      const split = await item("split").getAttribute("aria-checked");
      await page.keyboard.press("Escape");
      return split === "true" ? "split" : "unified";
    },
    async choose(layout) {
      await gear().click();
      await item(layout).click();
      await page.waitForTimeout(2500);
      if (await item(layout).isVisible()) await page.keyboard.press("Escape");
    },
  };
}

const unifiedInSearch = (page: Page) =>
  page.evaluate(() => new URLSearchParams(location.search).get("diff") === "unified");

/**
 * Pass 3: choosing Unified from the gear on pull request #4 turns the preference off. Returns the
 * Layout saved before it.
 */
async function unifiedTurnsOff(page: Page): Promise<Layout> {
  // The menu's checked item follows the layout on screen, so the saved one reads without `?diff=`.
  await load(page, PR4);
  const layout = gearLayout(page);
  const original = await withLayoutRestored(layout, async (original) => {
    log(`layout before: ${original}`);
    // A saved Unified on that load already turned the preference off.
    await ask(page, { op: "set", on: true });
    await load(page, `${PR4}?diff=split`);
    for (let step = 0; step < 5; step++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1500);
    }
    const [addedBefore, removedBefore] = await ask<[number, number]>(page, { op: "highlights" });
    check(
      "painted before Unified",
      addedBefore + removedBefore > 0,
      `(${addedBefore}, ${removedBefore})`,
    );

    await layout.choose("unified");
    const [added, removed] = await ask<number[]>(page, { op: "highlights" });
    const traces = await structuralTraces(page);
    const stored = await ask<unknown>(page, { op: "get" });
    check(
      "unified",
      stored === false && added === 0 && removed === 0 && traces.attributes === 0,
      JSON.stringify({ stored, added, removed, ...traces }),
    );
    log("unified: preference off");
    log(
      `unified: location.search gained diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
    );

    if (original === "unified") {
      await layout.choose("split");
      log(
        `split: location.search still holds diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
      );
    }
    return original;
  });
  if ((await layout.read()) === "split")
    log(
      `split restored: location.search still holds diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
    );
  return original;
}

async function launch(build: string, profile: string): Promise<BrowserContext> {
  const viewport = { width: 1600, height: 900 };
  const context =
    browserName === "firefox"
      ? await withExtension(firefox, build).launchPersistentContext(profile, { viewport })
      : await chromium.launchPersistentContext(profile, {
          channel: "chromium",
          viewport,
          args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
        });
  const { cookies } = JSON.parse(readFileSync(statePath, "utf8")) as {
    cookies: Parameters<BrowserContext["addCookies"]>[0];
  };
  await context.addCookies(cookies);
  return context;
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-mode-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-mode-profile-"));
let context: BrowserContext | undefined;
try {
  scratchCopy(copy, { "entrypoints/bench-probe.content.ts": PROBE });
  context = await launch(buildCopy(copy, browserName), profile);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${SANDBOX}/pull/4`);
  if (await page.locator('meta[name="user-login"][content=""]').count())
    throw new Failure("signed in: FAILED the storage state does not sign GitHub in");
  log(
    `browser: ${browserName} ${context.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))}`,
  );
  await modeOff(page);
  await modeOn(page);
  const before = await unifiedTurnsOff(page);
  await load(page, PR4);
  const after = await gearLayout(page).read();
  check("layout as found", after === before, `(before: ${before}, after: ${after})`);
} catch (error) {
  log(error instanceof Failure ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
