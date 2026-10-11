import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, test as base, chromium, expect } from "@playwright/test";

const EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const PR_URL = "https://github.com/o/r/pull/1/changes";
const COMMIT_URL = "https://github.com/o/r/commit/dd95cdc0d7a9a6817998ee6663563e888761f329";

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");
const PR_BODY = `<!doctype html>${readFixture("files-page.html")}`;
// README.md's tree row in tests/fixtures/files-page.html links to this id.
const README_DIFF = "diff-0a13";
// The wrapper supplies GitHub's layout container; the switch's container query needs ≥ 1012 px (default viewport: 1280).
const COMMIT_BODY = `<!doctype html><div class="PageLayout-PageLayoutContent">${readFixture("commit-page.html")}</div>`;

const test = base.extend<{ context: BrowserContext }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from this pattern.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // The headless shell can't load extensions; `mise run e2e` installs only full Chromium.
      channel: "chromium",
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    // Also answers the extension worker's fetches so intent settles offline; each serve() registers later and wins.
    await context.route("https://github.com/**", (route) => route.fulfill({ status: 404 }));
    await use(context);
    await context.close();
  },
});

const serve = (context: BrowserContext, url: string, body: string) =>
  context.route(url, (route) => route.fulfill({ contentType: "text/html", body }));

test("a pull request mounts its sections in path-only mode", async ({ context, page }) => {
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  const nav = page.getByRole("navigation", { name: "Changed files by section" });
  for (const name of [
    "Implementation",
    "Tests",
    "Documentation",
    "Config",
    "Generated / lockfiles",
  ]) {
    await expect(nav.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.locator(".gh-prism-notice")).toHaveText(/^Grouped by path\./);
});

test("a commit mounts its sections in path-only mode", async ({ context, page }) => {
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await page.goto(COMMIT_URL);
  const nav = page.getByRole("navigation", { name: "Changed files by section" });
  for (const name of ["Implementation", "Tests"]) {
    await expect(nav.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.locator(".gh-prism-notice")).toHaveText(/^Grouped by path\./);
});

test("the side switch docks the sidebar on the other side and remembers it", async ({
  context,
  page,
}) => {
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await page.goto(COMMIT_URL);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-gh-prism-side", "right");
  await page.getByRole("button", { name: "Move file tree to the left" }).click();
  await expect(html).toHaveAttribute("data-gh-prism-side", "left");
  // The side saves asynchronously; reload until a load reads it back.
  await expect(async () => {
    await page.reload();
    await expect(html).toHaveAttribute("data-gh-prism-side", "left", { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Move file tree to the right" })).toBeVisible();
});

test("clicking a file scrolls its diff into view", async ({ context, page }) => {
  await serve(
    context,
    PR_URL,
    `${PR_BODY}<div id="${README_DIFF}" style="margin-top: 300vh">README.md</div>`,
  );
  await page.goto(PR_URL);
  const diff = page.locator(`#${README_DIFF}`);
  await expect(diff).not.toBeInViewport();
  await page.locator('[data-item-path="README.md"]').click();
  await expect(diff).toBeInViewport();
});
