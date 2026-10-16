import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, test as base, chromium, expect, type Page } from "@playwright/test";
import { commitPage } from "../entrypoints/content/files-page";

const EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const PR_URL = "https://github.com/o/r/pull/1/changes";
const COMMIT_URL = "https://github.com/o/r/commit/dd95cdc0d7a9a6817998ee6663563e888761f329";

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");
const PR_BODY = `<!doctype html>${readFixture("files-page.html")}`;
// README.md's tree row in tests/fixtures/files-page.html links to this id.
const README_DIFF = "diff-0a13";
const TREE_OPEN = '<ul role="tree" aria-label="File Tree">';
// Hex, as GitHub's diff anchors are.
const bulkDiff = (n: number) => `diff-b${n.toString(16).padStart(3, "0")}`;
const bulkRow = (n: number) => {
  const name = `file-${String(n).padStart(3, "0")}.rs`;
  return `<li role="treeitem" id="bulk/${name}" aria-level="1" aria-label="${name}" aria-selected="false"><a href="#${bulkDiff(n)}">${name}</a></li>`;
};
// 300 more files under a new top-level bulk/, in a sidebar that scrolls within the 720 px viewport
// as GitHub's pane does. No file is current, so the sidebar starts at its top rather than revealing one.
const LARGE_PR_BODY = PR_BODY.replace(
  "<!doctype html>",
  "<!doctype html><style>#pr-file-tree { height: 600px; overflow-y: auto; }</style>",
)
  .replace(TREE_OPEN, `${TREE_OPEN}${Array.from({ length: 300 }, (_, n) => bulkRow(n)).join("")}`)
  .replace(' aria-current="true"', "");
// The fixture's last Implementation file in native order.
const LAST_IMPLEMENTATION_FILE = "src/render.rs";
const scrollSidebarToBulkRow = (page: Page, n: number): Promise<void> =>
  page.evaluate((n) => {
    const sidebar = document.getElementById("pr-file-tree");
    const tree = document.querySelector(
      '.gh-prism-section[data-section="implementation"] .gh-prism-tree',
    );
    if (!sidebar || !tree) throw new Error("no sidebar or Implementation tree");
    const treeTop =
      tree.getBoundingClientRect().top - sidebar.getBoundingClientRect().top + sidebar.scrollTop;
    // A bulk file's row follows bulk/, 28 px a row; 100 px of it shows below the top.
    sidebar.scrollTop = treeTop + (n + 1) * 28 - 100;
  }, n);
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

test("a commit's diff list skips a comment thread beside it", async ({ context, page }) => {
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await page.goto(COMMIT_URL);

  // happy-dom over-matches a multi-step :has(), so only a real browser proves this.
  const regionsPerList = await page.evaluate((diffList) => {
    document
      .getElementById("comments")
      ?.insertAdjacentHTML("beforeend", "<div><p>A comment</p></div>");
    return [...document.querySelectorAll(diffList)].map(
      (list) => list.querySelectorAll('[role="region"]').length,
    );
  }, commitPage.diffList);

  expect(regionsPerList).toEqual([2]);
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

test("a large pull request renders only the rows near the sidebar's viewport, and the sidebar scrolls as one", async ({
  context,
  page,
}) => {
  await serve(context, PR_URL, LARGE_PR_BODY);
  await page.goto(PR_URL);
  const bulk = page.locator('[data-item-path="bulk/"]');
  await expect(bulk).toBeVisible();
  const trees = await page.evaluate(() =>
    [...document.querySelectorAll(".gh-prism-tree")].map((host) => ({
      rows: host.shadowRoot?.querySelectorAll('[data-type="item"]').length ?? 0,
      overflows: [
        ...(host.shadowRoot?.querySelectorAll("[data-file-tree-virtualized-scroll]") ?? []),
      ].map((scroll) => getComputedStyle(scroll).overflowY),
    })),
  );
  for (const { rows, overflows } of trees) {
    expect(rows).toBeLessThan(100);
    expect(overflows).toEqual(["hidden"]);
  }
  await expect(page.locator('[data-item-path="bulk/file-299.rs"]')).toHaveCount(0);

  const sidebar = page.locator("#pr-file-tree");
  await bulk.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

  await scrollSidebarToBulkRow(page, 150);
  await expect(page.locator('[data-item-path="bulk/file-150.rs"]')).toBeInViewport();
});

test("the keyboard reaches a tree's off-screen rows", async ({ context, page }) => {
  await serve(context, PR_URL, LARGE_PR_BODY);
  await page.goto(PR_URL);
  const bulk = page.locator('[data-item-path="bulk/"]');
  await bulk.focus();
  await page.keyboard.press("End");
  const last = page.locator(`[data-item-path="${LAST_IMPLEMENTATION_FILE}"]`);
  await expect(last).toBeFocused();
  await expect(last).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(bulk).toBeFocused();
  await expect(bulk).toBeInViewport();
});

for (const [how, focus] of [
  [
    "the keyboard",
    async (page: Page) => {
      await page.locator('[data-item-path="bulk/"]').focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
    },
  ],
  ["a click", (page: Page) => page.locator('[data-item-path="bulk/file-005.rs"]').click()],
] as const) {
  test(`the sidebar scrolls away from a row ${how} focused`, async ({ context, page }) => {
    await serve(context, PR_URL, LARGE_PR_BODY);
    await page.goto(PR_URL);
    await expect(page.locator('[data-item-path="bulk/"]')).toBeVisible();
    await focus(page);
    const sidebar = page.locator("#pr-file-tree");
    await sidebar.hover();
    for (let step = 0; step < 10; step++) await page.mouse.wheel(0, 300);
    await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBeGreaterThan(2000);
  });
}

test("GitHub's current file off screen is selected and scrolled into view", async ({
  context,
  page,
}) => {
  await serve(context, PR_URL, LARGE_PR_BODY);
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-path="bulk/"]')).toBeVisible();
  await page.evaluate(() => {
    document.getElementById("bulk/file-299.rs")?.setAttribute("aria-current", "true");
  });
  const row = page.locator('[data-item-path="bulk/file-299.rs"]');
  await expect(row).toHaveAttribute("aria-selected", "true");
  await expect(row).toBeInViewport();
});

test("the sidebar highlights the files whose diffs are on screen", async ({ context, page }) => {
  await serve(context, PR_URL, LARGE_PR_BODY);
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-path="bulk/"]')).toBeVisible();
  // One stand-in diff per bulk row; every seventh is taller than the 720 px viewport.
  await page.evaluate(
    (ids) => {
      const list = document.querySelector('[data-testid="progressive-diffs-list"]');
      if (!list) throw new Error("no diff list");
      for (let n = 0; n < 300; n++)
        list.insertAdjacentHTML(
          "beforeend",
          `<div style="content-visibility: auto; contain-intrinsic-size: auto ${n % 7 ? 230 : 900}px"><div role="region" id="${ids[n]}" data-n="${n}" style="height: ${n % 7 ? 230 : 900}px"></div></div>`,
        );
    },
    Array.from({ length: 300 }, (_, n) => bulkDiff(n)),
  );
  const markedAndInViewPaths = () =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll(".gh-prism-tree")].flatMap((host) => [
        ...(host.shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
      ]);
      const rendered = new Set(rows.map((row) => row.dataset.itemPath));
      const marked = rows
        .filter(
          (row) => getComputedStyle(row).getPropertyValue("--gh-prism-on-screen").trim() === "1",
        )
        .map((row) => row.dataset.itemPath ?? "");
      const inView = [...document.querySelectorAll('[role="region"][data-n]')]
        .filter((region) => {
          const { top, bottom } = region.getBoundingClientRect();
          // Inclusive, as IntersectionObserver counts a region whose edge touches the viewport's.
          return bottom >= 0 && top <= innerHeight;
        })
        .map((region) => `bulk/file-${(region as HTMLElement).dataset.n?.padStart(3, "0")}.rs`)
        // The sidebar renders only the rows near its viewport.
        .filter((path) => rendered.has(path));
      return {
        marked: marked.filter((path) => path.startsWith("bulk/file-")).sort(),
        inView: inView.sort(),
      };
    });
  const expectMarkedInView = () =>
    expect(async () => {
      const { marked, inView } = await markedAndInViewPaths();
      expect(inView.length).toBeGreaterThan(0);
      expect(marked).toEqual(inView);
    }).toPass({ timeout: 10_000 });
  const scrollToDiff = (n: number) =>
    page.evaluate((n) => {
      const region = document.querySelector(`[data-n="${n}"]`);
      if (!region) throw new Error(`no diff ${n}`);
      // 37 px past the region's top keeps every region edge off the viewport's, where the
      // rect check and the observer can round differently.
      window.scrollTo({
        top: region.getBoundingClientRect().top + scrollY + 37,
        behavior: "instant",
      });
    }, n);

  await scrollSidebarToBulkRow(page, 20);
  await scrollToDiff(20);
  await expectMarkedInView();

  // A scroll Playwright makes before clicking moves the tree's own viewport, which
  // SectionTree.sync snaps back between pointerdown and pointerup, so the click lands nowhere.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await scrollSidebarToBulkRow(page, 250);
  const row250 = page.locator('[data-item-path="bulk/file-250.rs"]');
  await expect(row250).toBeInViewport();
  // Playwright retries, with a scroll, a click on a row the sections' landing reveal still moves,
  // or one the tree ignores pointer events on just after a scroll.
  await page
    .locator(".gh-prism-section")
    .evaluateAll((sections) =>
      Promise.all(sections.flatMap((section) => section.getAnimations().map((a) => a.finished))),
    );
  await expect
    .poll(() => row250.evaluate((el) => getComputedStyle(el).pointerEvents))
    .not.toBe("none");
  await row250.click();
  await expect
    .poll(() => markedAndInViewPaths().then(({ inView }) => inView))
    .toContain("bulk/file-250.rs");
  await expectMarkedInView();

  await scrollToDiff(100);
  await expect(page.locator('[data-item-path="bulk/file-100.rs"]')).toHaveCount(0);
  await scrollSidebarToBulkRow(page, 100);
  const row = page.locator('[data-item-path="bulk/file-100.rs"]');
  await expect
    .poll(() =>
      row.evaluate((el) => getComputedStyle(el).getPropertyValue("--gh-prism-on-screen").trim()),
    )
    .toBe("1");
});

test("each file's icon takes its type's color in the page's color scheme", async ({
  context,
  page,
}) => {
  await serve(context, PR_URL, PR_BODY);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-path="Cargo.toml"]')).toBeVisible();
  // GitHub's light theme on a dark OS.
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = "light";
  });

  const iconColors = () =>
    page.evaluate(() => {
      const colorOf = (path: string) => {
        const icon = [...document.querySelectorAll(".gh-prism-tree")]
          .map((host) =>
            host.shadowRoot?.querySelector(
              `[data-item-path="${path}"] [data-item-section="icon"] svg`,
            ),
          )
          .find((found) => found);
        return icon ? getComputedStyle(icon).color : null;
      };
      return {
        rust: colorOf("src/helpers.rs"),
        manifest: colorOf("Cargo.toml"),
        markdown: colorOf("README.md"),
      };
    });
  const onDarkOs = await iconColors();
  await page.emulateMedia({ colorScheme: "light" });
  const onLightOs = await iconColors();

  expect(onDarkOs.rust).not.toBe(onDarkOs.markdown);
  expect(onDarkOs.manifest).toBe(onDarkOs.rust);
  expect(onDarkOs).toEqual(onLightOs);
});
