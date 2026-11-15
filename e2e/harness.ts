import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, test as base, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";

const CHROME_EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const FIREFOX_EXTENSION = join(import.meta.dirname, "../.output/firefox-mv3");

/**
 * A test whose `context` loads the built extension and answers any unrouted GitHub request with a
 * 404, and whose `bundle` is `entry`, an e2e page script, built once per worker.
 */
export const extensionTest = (entry: string) =>
  base.extend<{ context: BrowserContext }, { bundle: string }>({
    bundle: [
      // Playwright requires a destructured first parameter; this fixture depends on nothing in it.
      async ({ browserName: _ }, use) => {
        await use(
          execFileSync(
            "bun",
            [join(import.meta.dirname, "../bench/bundle.ts"), join(import.meta.dirname, entry)],
            { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
          ),
        );
      },
      { scope: "worker" },
    ],
    context: async ({ browserName }, use) => {
      const profile = await mkdtemp(join(tmpdir(), "gh-prism-e2e-"));
      const context = await (browserName === "firefox"
        ? withExtension(firefox, FIREFOX_EXTENSION).launchPersistentContext(profile, {
            proxy: { server: "http://127.0.0.1:9" },
          })
        : chromium.launchPersistentContext(profile, {
            channel: "chromium",
            args: [
              `--disable-extensions-except=${CHROME_EXTENSION}`,
              `--load-extension=${CHROME_EXTENSION}`,
            ],
          }));
      await context.route("https://github.com/**", (route) => route.fulfill({ status: 404 }));

      await use(context);

      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  });

/** A copy of the diff region `from` under `anchor`, appended after it, as a file that loads late. */
export const addFile = (page: Page, from: string, anchor: string) =>
  page.evaluate(
    ({ from, anchor }) => {
      const region = document.getElementById(from);
      if (!region) throw new Error("no diff region");
      const copy = region.cloneNode(true) as HTMLElement;
      copy.id = anchor;
      copy.querySelector("table")?.setAttribute("data-diff-anchor", anchor);
      region.after(copy);
    },
    { from, anchor },
  );
