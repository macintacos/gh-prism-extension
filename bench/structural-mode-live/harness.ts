/**
 * What `bench/structural-mode-live.ts` and `bench/structural-parity-live.ts` share: the probe
 * content script, the signed-in launch, page loads, and the reads of structural mode's traces, the
 * diff view control, and the gear's Layout.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { type BrowserContext, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";
import { STRUCTURAL_ATTRS } from "../../entrypoints/content/diffs/structural-attrs";
import type { Layout, LayoutChoice } from "./layout";
import type { ProbeRequest } from "./probe";

export type BrowserName = "chromium" | "firefox";

// Keep in sync with structural-notices.ts's classes.
export const NOTICE_SELECTOR = ".gh-prism-structural-notice, .gh-prism-structural-loading";

/** The bench-only content script that `scratchCopy` overlays at `entrypoints/bench-probe.content.ts`. */
export const PROBE = `import { defineContentScript } from "wxt/utils/define-content-script";
import { probe } from "@/bench/structural-mode-live/probe";

export default defineContentScript({ matches: ["https://github.com/*"], main: probe });
`;

export class Failure extends Error {}

/** GitHub's anchor for a file's diff: `diff-` and the SHA-256 of its path. */
export const anchorOf = (path: string) => `diff-${createHash("sha256").update(path).digest("hex")}`;

/** Launches `build` in `browserName` on `profile`, signed in with `statePath`'s cookies. */
export async function launch(
  browserName: BrowserName,
  build: string,
  profile: string,
  statePath: string,
): Promise<BrowserContext> {
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

/**
 * Asks the probe content script, retrying until it answers, and returns its result as `T`
 * unchecked: the caller names the type the probe's `op` replies with.
 */
export async function ask<T>(page: Page, request: ProbeRequest, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reply = await Promise.race([
      page.evaluate(
        (request) =>
          new Promise<{ result?: unknown; error?: string }>((resolve) => {
            const id = Math.random();
            const listener = (event: MessageEvent) => {
              if (event.data?.probeReply !== id) return;
              removeEventListener("message", listener);
              resolve(event.data);
            };
            addEventListener("message", listener);
            postMessage({ probe: id, request }, "*");
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
export async function load(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(".gh-prism-section").first().waitFor({ timeout: 30_000 });
  await page.locator("table[data-diff-anchor]").first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4000);
}

/** What the DOM holds of structural mode. */
export const structuralTraces = (page: Page) =>
  page.evaluate(
    ({ attrs, notices }) => ({
      attributes: document.querySelectorAll(attrs.map((a) => `[${a}]`).join(", ")).length,
      notices: document.querySelectorAll(notices).length,
      sheets: [...document.querySelectorAll("style")].filter((style) =>
        style.textContent?.includes("::highlight(gh-prism-"),
      ).length,
    }),
    { attrs: STRUCTURAL_ATTRS, notices: NOTICE_SELECTOR },
  );

/**
 * The text of gh-prism's node directly before `anchor`'s mounted table: `null` for none,
 * `undefined` while unmounted.
 */
export const noticeBefore = (page: Page, anchor: string) =>
  page.evaluate(
    ({ anchor, notices }) => {
      const table = document.querySelector(`table[data-diff-anchor="${anchor}"]`);
      if (!table) return undefined;
      const before = table.previousElementSibling;
      return before?.matches(notices) ? (before.textContent ?? "") : null;
    },
    { anchor, notices: NOTICE_SELECTOR },
  );

export async function offscreenDocuments(context: BrowserContext): Promise<number> {
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

export type View = "Unified" | "Split" | "Structural";

export const segmentOf = (page: Page, view: View) =>
  page
    .getByRole("list", { name: "Diff view" })
    .getByRole("button", { name: view === "Structural" ? /^Structural/ : view });

/** The gear menu's Layout choice on `page`, read and chosen as a person does. */
export function gearLayout(page: Page): LayoutChoice {
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

/** The segment the diff view control shows pressed, if any. */
export const pressedView = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector<HTMLElement>(".gh-prism-diff-view [aria-pressed='true']")?.dataset
        .view,
  );

/** Code owner shields drawn in the diffs' file headers. */
export const shields = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelectorAll(
        ':is([data-testid="diff-content"], #diff-content-parent) svg[class*="octicon-shield"]',
      ).length,
  );
