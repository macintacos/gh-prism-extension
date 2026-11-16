import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type BrowserContext, test as base, chromium, firefox, type Page } from "@playwright/test";
import { withExtension } from "playwright-webextext";

const CHROME_EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const FIREFOX_EXTENSION = join(import.meta.dirname, "../.output/firefox-mv3");
// A launch takes under 2 s; this leaves a retry room inside the 30 s test timeout.
const LAUNCH_STALL_MS = 10_000;

const launchChromium = (profile: string) =>
  chromium.launchPersistentContext(profile, {
    // The headless shell can't load extensions; `mise run e2e` installs only full Chromium.
    channel: "chromium",
    args: [
      `--disable-extensions-except=${CHROME_EXTENSION}`,
      `--load-extension=${CHROME_EXTENSION}`,
    ],
  });

// playwright-webextext installs the build as a temporary add-on over Firefox's remote debugging
// protocol, and grants its content scripts' origins in the profile before launch. Its background
// fetches skip context.route, so they go to a proxy on a port nothing listens on and fail at once,
// rather than waiting on the real github.com.
const launchFirefox = (profile: string) =>
  withExtension(firefox, FIREFOX_EXTENSION).launchPersistentContext(profile, {
    proxy: { server: "http://127.0.0.1:9" },
  });

/** The built extension's context in `browserName`, on a fresh profile the caller removes. */
export const launchExtension = (browserName: string) =>
  launchContext(browserName === "firefox" ? launchFirefox : launchChromium);

/**
 * `launch`'s context on a fresh profile. A launch still pending after `stallMs` is abandoned and
 * tried once more on another profile.
 */
export async function launchContext<C extends Pick<BrowserContext, "close">>(
  launch: (profile: string) => Promise<C>,
  stallMs = LAUNCH_STALL_MS,
): Promise<{ context: C; profile: string }> {
  const first = await launchWithin(launch, stallMs);
  if (first) return first;

  console.warn(`gh-prism e2e: a browser launch stalled past ${stallMs} ms; retrying`);
  const second = await launchWithin(launch, stallMs);
  if (second) return second;

  throw new Error(`a browser launch stalled past ${stallMs} ms twice`);
}

/** `launch`'s context on a fresh profile, or `undefined` once `stallMs` passes without one. */
async function launchWithin<C extends Pick<BrowserContext, "close">>(
  launch: (profile: string) => Promise<C>,
  stallMs: number,
): Promise<{ context: C; profile: string } | undefined> {
  const profile = await mkdtemp(join(tmpdir(), "gh-prism-e2e-"));
  const launching = launch(profile);
  const context = await Promise.race([launching, delay(stallMs, undefined, { ref: false })]);
  if (context) return { context, profile };

  // The retry owns the outcome, so a launch that settles late is only cleaned up.
  void launching
    .then((late) => late.close())
    .finally(() => rm(profile, { recursive: true, force: true }))
    .catch(() => {});
  return undefined;
}

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
      const { context, profile } = await launchExtension(browserName);
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
