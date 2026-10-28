import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { commitPage } from "../entrypoints/content/files-page";

const EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const PR_URL = "https://github.com/o/r/pull/1/changes";
const COMMIT_URL = "https://github.com/o/r/commit/dd95cdc0d7a9a6817998ee6663563e888761f329";

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");
const PR_BODY = `<!doctype html>${readFixture("files-page.html")}`;
const CLASSIC_URL = "https://github.com/o/r/pull/1/files";
// GitHub names no login for a signed-out viewer.
const CLASSIC_BODY = `<!doctype html><meta name="user-login" content="">${readFixture("classic-files-page.html")}`;
// README.md's tree row in tests/fixtures/files-page.html links to this id.
const README_DIFF = "diff-0a13";

// src/lib.rs's and config/app.toml's diff regions in tests/fixtures/viewed-files-page.html;
// keep in sync with tests/fixtures/files-page.ts, whose ?raw imports e2e can't load.
const VIEWED_LIB_RS = "diff-b1a35a68f14e696205874893c07fd24fdb88882b47c23cc0e0c80a30c7d53759";
const VIEWED_APP_TOML = "diff-c9bd6e09f349b0f93c557afe2376f4a9345a21b5daed12c6af0a714773aba693";
const TREE_OPEN = '<ul role="tree" aria-label="File Tree">';
// Hex, as GitHub's diff anchors are.
const bulkDiff = (n: number) => `diff-b${n.toString(16).padStart(3, "0")}`;
const bulkRow = (n: number) => {
  const name = `file-${String(n).padStart(3, "0")}.rs`;
  return `<li role="treeitem" id="bulk/${name}" aria-level="1" aria-label="${name}" aria-selected="false"><a href="#${bulkDiff(n)}">${name}</a></li>`;
};
// gh-prism's tree flattens its folders into one chain row above the file.
const CHAIN_FILE = "managed/dot_config/opencode/skills/sentry-cli/SKILL.md";
const CHAIN_ROW = `<li role="treeitem" id="${CHAIN_FILE}" aria-level="1" aria-label="SKILL.md" aria-selected="false"><a href="#diff-c4a1">SKILL.md</a></li>`;
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

/** Sets the Viewed toggle in diff region `anchor` to `viewed`, as GitHub's click leaves its attributes. */
const setViewed = (page: Page, anchor: string, viewed: boolean) =>
  page.evaluate(
    ({ anchor, viewed }) => {
      const toggle = document.querySelector(
        `#${anchor} button[aria-pressed][aria-label$="Viewed"]`,
      );
      if (!toggle) throw new Error(`no toggle in #${anchor}`);
      toggle.setAttribute("aria-pressed", String(viewed));
      toggle.setAttribute("aria-label", viewed ? "Viewed" : "Not Viewed");
    },
    { anchor, viewed },
  );

const VIEWED_URL = "https://github.com/macintacos/gh-prism-sandbox/pull/3/changes";
const VIEWED_BODY = `<!doctype html>${readFixture("viewed-files-page.html")}`;
// GitHub's "N / M viewed" counter, which tells the extension the page offers Viewed.
const LARGE_VIEWED_BODY = LARGE_PR_BODY.replace(
  "<!doctype html>",
  '<!doctype html><div class="file-controls__x"><span class="ProgressContainer__x">0 / 309 viewed</span></div>',
);

/**
 * Stands in for GitHub's Viewed toggles: a click flips the toggle in a microtask, before the
 * click's dispatch ends, as GitHub's does, then saves through `POST <pull>/file_review`,
 * flipping back on a failed save when `revert`.
 */
const copyGitHubToggles = (page: Page, { revert }: { revert: boolean }) =>
  page.evaluate((revert) => {
    const flip = (toggle: Element) => {
      const viewed = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", String(viewed));
      toggle.setAttribute("aria-label", viewed ? "Viewed" : "Not Viewed");
    };
    for (const toggle of document.querySelectorAll(
      '[class*="diff-file-header__"] button[aria-pressed][aria-label$="Viewed"]',
    ))
      toggle.addEventListener("click", () =>
        queueMicrotask(async () => {
          flip(toggle);
          const response = await fetch(
            `${location.pathname.replace(/\/changes$/, "")}/file_review`,
            { method: "POST" },
          );
          if (!response.ok && revert) flip(toggle);
        }),
      );
  }, revert);

/** Answers every `file_review` save with `status`; registered after the catch-all 404, so it wins. */
const routeFileReview = async (context: BrowserContext, status: number) => {
  const saves = { count: 0 };
  await context.route("**/file_review", (route) => {
    saves.count++;
    return route.fulfill({ status, contentType: "application/json", body: "{}" });
  });
  return saves;
};

const viewedBox = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: `Viewed: ${name}` });

test("the classic Files changed page explains in a dialog why gh-prism is off, until it's closed", async ({
  context,
  page,
}) => {
  await serve(context, CLASSIC_URL, CLASSIC_BODY);
  const dialog = page.getByRole("dialog", { name: /gh-prism/ });
  const opener = page.getByRole("button", { name: /why is gh-prism off/i });

  await page.goto(CLASSIC_URL);
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  await expect(dialog.getByRole("link", { name: "Sign in" })).toBeVisible();

  // The backdrop's corner, outside the centered dialog.
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  await page.reload();
  // The button and the dialog come in together, so the dialog has had its chance to open.
  await expect(opener).toBeVisible();
  await expect(dialog).toBeHidden();

  await opener.click();
  await expect(dialog).toBeVisible();
});

test("a pull request mounts its sections in path-only mode", async ({ context, page }) => {
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  const nav = page.getByRole("navigation", { name: "Changed files by section" });
  for (const name of [
    "Implementation",
    "Tests",
    "Docs & Comments",
    "Config",
    "Generated / lockfiles",
  ]) {
    await expect(nav.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.locator(".gh-prism-notice")).toHaveText(/^Grouped by path\./);
  // The e2e build carries no release notes.
  await expect(page.locator(".gh-prism-whats-new")).toHaveCount(0);
});

test("a commit mounts its sections in path-only mode", async ({ context, page }) => {
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await page.goto(COMMIT_URL);
  const nav = page.getByRole("navigation", { name: "Changed files by section" });
  for (const name of ["Implementation", "Tests"]) {
    await expect(nav.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.locator(".gh-prism-notice")).toHaveText(/^Grouped by path\./);
  await expect(page.locator("[data-item-checkbox]")).toHaveCount(0);
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
          (row) =>
            getComputedStyle(
              row.querySelector(
                `:scope > [data-item-section="spacing"] > [data-ancestor-path="${row.dataset.itemPath?.replace(/[^/]*$/, "")}"]`,
              ) ?? row,
            )
              .getPropertyValue("--gh-prism-lit")
              .trim() === "1",
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
  const piece = page.locator(
    '[data-item-path="bulk/file-100.rs"] > [data-item-section="spacing"] > [data-ancestor-path="bulk/"]',
  );
  await expect
    .poll(() =>
      piece.evaluate((el) => getComputedStyle(el).getPropertyValue("--gh-prism-lit").trim()),
    )
    .toBe("1");
  const fade = () => piece.evaluate((el) => getComputedStyle(el, "::before").transitionDuration);
  expect(await fade()).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await fade()).toBe("0s");

  const resting = page.locator(
    '[data-item-path="bulk/file-101.rs"] > [data-item-section="spacing"] > [data-ancestor-path="bulk/"]',
  );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect
    .poll(() =>
      resting.evaluate((el) => getComputedStyle(el).getPropertyValue("--gh-prism-lit").trim()),
    )
    .toBe("");
  expect(await resting.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("the sidebar dims viewed files and follows GitHub's Viewed toggle", async ({
  context,
  page,
}) => {
  const url = "https://github.com/macintacos/gh-prism-sandbox/pull/3/changes";
  await serve(context, url, `<!doctype html>${readFixture("viewed-files-page.html")}`);
  await page.goto(url);
  await expect(page.locator('[data-item-path="src/lib.rs"]')).toBeVisible();
  const viewedOf = (path: string) =>
    page
      .locator(`[data-item-path="${path}"]`)
      .first()
      .evaluate((row) => {
        const content = row.querySelector('[data-item-section="content"]');
        if (!content) throw new Error(`no content section in ${path}'s row`);
        const spacing = row.querySelector('[data-item-section="spacing"]');
        return {
          flag: getComputedStyle(row).getPropertyValue("--gh-prism-viewed").trim(),
          dimmed: Number(getComputedStyle(content).opacity) < 1,
          spacingOpacity: spacing && getComputedStyle(spacing).opacity,
        };
      });

  await expect
    .poll(() => viewedOf("config/app.toml"))
    .toEqual({ flag: "1", dimmed: true, spacingOpacity: "1" });
  expect(await viewedOf("src/lib.rs")).toMatchObject({ flag: "", dimmed: false });

  await page.evaluate(() => {
    for (const host of document.querySelectorAll<HTMLElement>(".gh-prism-tree"))
      host.dataset.e2eMark = "";
  });
  await setViewed(page, VIEWED_LIB_RS, true);
  await expect.poll(() => viewedOf("src/lib.rs")).toMatchObject({ flag: "1", dimmed: true });
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".gh-prism-tree")].every(
        (host) => host.dataset.e2eMark === "",
      ),
    ),
  ).toBe(true);

  await setViewed(page, VIEWED_LIB_RS, false);
  await expect.poll(() => viewedOf("src/lib.rs")).toMatchObject({ flag: "", dimmed: false });
});

test("section headers count viewed files once any file is Viewed", async ({ context, page }) => {
  const url = "https://github.com/macintacos/gh-prism-sandbox/pull/3/changes";
  await serve(context, url, `<!doctype html>${readFixture("viewed-files-page.html")}`);
  await page.goto(url);
  const counters = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map((section) => {
          const counter = section.querySelector(".gh-prism-counter");
          return [
            section.dataset.section,
            (counter?.querySelector('[aria-hidden="true"]') ?? counter)?.textContent,
          ];
        }),
      ),
    );

  await expect.poll(counters).toEqual({ implementation: "0/1", config: "1/1", generated: "0/1" });
  await expect(
    page.locator('.gh-prism-section[data-section="config"] h3 button'),
  ).toHaveAccessibleName(/1 of 1 viewed/);

  await setViewed(page, VIEWED_LIB_RS, true);
  await expect.poll(counters).toEqual({ implementation: "1/1", config: "1/1", generated: "0/1" });

  await setViewed(page, VIEWED_LIB_RS, false);
  await setViewed(page, VIEWED_APP_TOML, false);
  await expect.poll(counters).toEqual({ implementation: "1", config: "1", generated: "1" });
  await expect(page.locator(".gh-prism-counter .sr-only")).toHaveCount(0);
});

test("every file row has a Viewed checkbox showing its file's state", async ({ context, page }) => {
  await serve(context, VIEWED_URL, VIEWED_BODY);
  await page.goto(VIEWED_URL);

  await expect(viewedBox(page, "app.toml")).toBeChecked();
  await expect(viewedBox(page, "app.toml")).toHaveAttribute("title", /^Mark as not viewed /);
  await expect(viewedBox(page, "lib.rs")).not.toBeChecked();
  await expect(viewedBox(page, "lib.rs")).toHaveAttribute("title", /^Mark as viewed /);
  await expect(page.locator("[data-item-checkbox]")).toHaveCount(3);
});

/** Opens the Viewed fixture, whose toggles save through `POST <pull>/file_review`, and its saves. */
const openViewed = async (context: BrowserContext, page: Page) => {
  const saves = await routeFileReview(context, 200);
  await serve(context, VIEWED_URL, VIEWED_BODY);
  await page.goto(VIEWED_URL);
  await expect(viewedBox(page, "lib.rs")).toBeVisible();
  await copyGitHubToggles(page, { revert: true });
  return saves;
};

/** Waits out the sections' reveal, which moves every row. */
const revealSettled = (page: Page) =>
  page.locator(".gh-prism-sections").evaluate(async (view) => {
    await Promise.all(view.getAnimations({ subtree: true }).map(({ finished }) => finished));
  });

test("ticking a row's box saves its file's Viewed state once", async ({ context, page }) => {
  const saves = await openViewed(context, page);

  await viewedBox(page, "lib.rs").click();
  await expect(viewedBox(page, "lib.rs")).toBeChecked();
  await expect(page.locator(`#${VIEWED_LIB_RS} button[aria-label$="Viewed"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => saves.count).toBe(1);

  await viewedBox(page, "app.toml").dblclick();
  await expect(viewedBox(page, "app.toml")).not.toBeChecked();
  await expect(viewedBox(page, "app.toml")).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(() => saves.count).toBe(2);
  await page.waitForTimeout(500);
  expect(saves.count).toBe(2);
});

test("ticking GitHub's current file's box saves its Viewed state", async ({ context, page }) => {
  const saves = await openViewed(context, page);
  // Playwright retries a click whose target is moving.
  await revealSettled(page);
  // The fixture runs no GitHub script, so a row click alone never makes its file current.
  await page.evaluate(() =>
    document.getElementById("src/lib.rs")?.setAttribute("aria-current", "true"),
  );
  await expect(page.locator('[data-item-path="src/lib.rs"]')).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await viewedBox(page, "lib.rs").click({ timeout: 5_000 });

  await expect(viewedBox(page, "lib.rs")).toBeChecked();
  await expect(page.locator(`#${VIEWED_LIB_RS} button[aria-label$="Viewed"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect.poll(() => saves.count).toBe(1);
});

test("Alt-clicking a file's row marks it Viewed and back, and does nothing else", async ({
  context,
  page,
}) => {
  const saves = await openViewed(context, page);
  // Playwright retries a click whose target is moving.
  await revealSettled(page);
  const row = page.locator('[data-item-path="src/lib.rs"]');
  const toggle = page.locator(`#${VIEWED_LIB_RS} button[aria-label$="Viewed"]`);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.url()));
  // The tree re-asserts its selection in the same task, so only the attributes' old values show
  // a selection that came and went.
  const record = await row.evaluateHandle((el) => {
    const seen = { selected: false, clicks: [] as MouseEvent[] };
    const isLib = (node: EventTarget) =>
      node instanceof Element && node.getAttribute("data-item-path") === "src/lib.rs";
    const selected = (node: Element) =>
      node.getAttribute("aria-selected") === "true" || node.hasAttribute("data-item-selected");
    new MutationObserver((records) => {
      for (const { type, target, oldValue, addedNodes } of records) {
        if (type === "attributes" && isLib(target))
          seen.selected ||= oldValue === "true" || selected(target as Element);
        for (const node of addedNodes) if (isLib(node)) seen.selected ||= selected(node as Element);
      }
    }).observe(el.getRootNode(), {
      subtree: true,
      childList: true,
      attributeFilter: ["aria-selected", "data-item-selected"],
      attributeOldValue: true,
    });
    window.addEventListener(
      "click",
      (event) => {
        if (event.composedPath().some(isLib)) seen.clicks.push(event);
      },
      { capture: true },
    );
    return seen;
  });

  await row.click({ modifiers: ["Alt"] });
  await expect(viewedBox(page, "lib.rs")).toBeChecked();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  await row.click({ modifiers: ["Alt"] });
  await expect(viewedBox(page, "lib.rs")).not.toBeChecked();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  expect(saves.count).toBe(2);
  expect(await page.evaluate(() => location.hash)).toBe("");
  expect(
    await record.evaluate(({ selected, clicks }) => ({
      selected,
      cancelled: clicks.map((click) => click.defaultPrevented),
    })),
  ).toEqual({ selected: false, cancelled: [true, true] });
  expect(await row.evaluate((el) => (el.getRootNode() as ShadowRoot).activeElement)).toBeNull();
  expect(downloads).toEqual([]);
});

test("a box follows the header when GitHub keeps a rejected save's state", async ({
  context,
  page,
}) => {
  await routeFileReview(context, 500);
  await serve(context, VIEWED_URL, VIEWED_BODY);
  await page.goto(VIEWED_URL);
  await expect(viewedBox(page, "lib.rs")).toBeVisible();
  await copyGitHubToggles(page, { revert: false });

  await viewedBox(page, "lib.rs").click();

  await expect(page.locator(`#${VIEWED_LIB_RS} button[aria-label$="Viewed"]`)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(viewedBox(page, "lib.rs")).toBeChecked();
  await expect(viewedBox(page, "lib.rs")).not.toHaveAttribute("aria-busy", "true");
});

test("the keyboard reaches and ticks a row's Viewed box", async ({ context, page }) => {
  await openViewed(context, page);
  const row = page.locator('[data-item-path="src/lib.rs"]');

  await row.focus();
  await page.keyboard.press("Tab");
  await expect(viewedBox(page, "lib.rs")).toBeFocused();

  await page.keyboard.press("Space");
  await expect(viewedBox(page, "lib.rs")).toBeChecked();

  await page.keyboard.press("Shift+Tab");
  await expect(row).toBeFocused();
});

test("every rendered file row of a large pull request keeps its Viewed box", async ({
  context,
  page,
}) => {
  await serve(context, PR_URL, LARGE_VIEWED_BODY);
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-checkbox="bulk/file-000.rs"]')).toBeVisible();
  const rendered = () =>
    page.evaluate(() => {
      const shadows = [...document.querySelectorAll(".gh-prism-tree")].map(
        (host) => host.shadowRoot,
      );
      const count = (selector: string) =>
        shadows.reduce((sum, shadow) => sum + (shadow?.querySelectorAll(selector).length ?? 0), 0);
      return {
        rows: count('[data-type="item"][data-item-type="file"]'),
        boxes: count("[data-item-checkbox]"),
      };
    });

  for (const n of [0, 150, 280]) {
    await scrollSidebarToBulkRow(page, n);
    await expect(
      page.locator(`[data-item-checkbox="bulk/file-${String(n).padStart(3, "0")}.rs"]`),
    ).toBeAttached();
    const { rows, boxes } = await rendered();
    expect(rows).toBeGreaterThan(0);
    expect(boxes).toBe(rows);
  }
});

test("ticking a box doesn't scroll the sidebar", async ({ context, page }) => {
  await serve(context, PR_URL, LARGE_VIEWED_BODY);
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-checkbox="bulk/file-000.rs"]')).toBeVisible();
  // Playwright scrolls a box it finds moving into view itself.
  await revealSettled(page);
  // The tree's focused row stays its top one, which the reader never focused.
  await scrollSidebarToBulkRow(page, 150);
  const box = page.locator('[data-item-checkbox="bulk/file-150.rs"]');
  await expect(box).toBeInViewport();
  // A click the scrolling tree ignores is retried, with a scroll.
  await expect
    .poll(() => box.evaluate((el) => getComputedStyle(el).pointerEvents))
    .not.toBe("none");
  const sidebar = page.locator("#pr-file-tree");
  const before = await sidebar.evaluate((el) => el.scrollTop);

  await box.click();
  await expect(box).toHaveAttribute("aria-busy", "true");
  await expect(box).not.toHaveAttribute("aria-busy", "true", { timeout: 7000 });

  expect(await sidebar.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(box).not.toBeChecked();
});

test("a focused Viewed box keeps focus while the tree re-renders", async ({ context, page }) => {
  await serve(context, PR_URL, LARGE_VIEWED_BODY);
  await page.goto(PR_URL);
  await expect(page.locator('[data-item-checkbox="bulk/file-000.rs"]')).toBeVisible();
  await scrollSidebarToBulkRow(page, 150);
  const sidebar = page.locator("#pr-file-tree");
  const box = page.locator('[data-item-checkbox="bulk/file-151.rs"]');
  await page.locator('[data-item-path="bulk/file-151.rs"]').focus();
  await page.keyboard.press("Tab");
  await expect(box).toBeFocused();

  await sidebar.evaluate((el) => {
    el.scrollTop += 20;
  });
  await page.evaluate(() =>
    document.getElementById("bulk/file-160.rs")?.setAttribute("aria-current", "true"),
  );
  await page.waitForTimeout(500);
  await expect(box).toBeFocused();

  await page.locator('[data-item-path="bulk/file-150.rs"]').click();
  await page.locator("body").focus();
  await page.locator('[data-item-checkbox="bulk/file-153.rs"]').click();
  await page.waitForTimeout(500);
  const before = await sidebar.evaluate((el) => el.scrollTop);
  await sidebar.evaluate((el) => {
    el.scrollTop += 150;
  });
  await page.waitForTimeout(500);

  await expect(page.locator('[data-item-checkbox="bulk/file-153.rs"]')).toBeFocused();
  expect(await sidebar.evaluate((el) => el.scrollTop)).toBe(before + 150);
});

test("each file's icon takes its type's color in the page's color scheme", async ({
  context,
  page,
}) => {
  // A type with no palette color: its icon stays the row's color, whatever the file's status.
  const fontRowMarkup =
    '<li role="treeitem" id="x.woff2" aria-level="1" aria-label="x.woff2" aria-selected="false"><div class="PRIVATE_TreeView-item-visual"><svg class="octicon octicon-file-added"></svg></div><a href="#diff-f047">x.woff2</a></li>';
  await serve(context, PR_URL, PR_BODY.replace(TREE_OPEN, `${TREE_OPEN}${fontRowMarkup}`));
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
      const fontRow = [...document.querySelectorAll(".gh-prism-tree")]
        .map((host) => host.shadowRoot?.querySelector('[data-item-path="x.woff2"]'))
        .find((found) => found);
      const colorInFontRow = (selector: string) => {
        const found = fontRow?.querySelector(selector);
        return found ? getComputedStyle(found).color : null;
      };
      // Not src/lib.rs: the fixture selects it, and a selected row's icon color differs regardless.
      return {
        font: colorInFontRow('[data-item-section="icon"] svg'),
        fontSpan: colorInFontRow('[data-item-section="icon"]'),
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
  expect(onDarkOs.font).not.toBeNull();
  expect(onDarkOs.font).toBe(onDarkOs.fontSpan);
});

/**
 * How the first row listing `path` lays out: the decoration parts it shows whole and those it
 * shows only partly, each in visual order, whether its name runs into them or ends in the tree's ellipsis, and whether
 * its status letter stays in the tree; `null` until the row has all of those.
 */
const rowLayout = (page: Page, path: string) =>
  page.evaluate((path) => {
    const host = [...document.querySelectorAll(".gh-prism-tree")].find((tree) =>
      tree.shadowRoot?.querySelector(`[data-item-path="${path}"]`),
    );
    const row = host?.shadowRoot?.querySelector(`[data-item-path="${path}"]`);
    const lane = row?.querySelector('[data-item-section="decoration"]');
    const content = row?.querySelector('[data-item-section="content"]');
    const status = row?.querySelector('[data-item-section="git"]');
    if (!host || !lane || !content || !status) return null;
    const within = (inner: Element, outer: Element) => {
      const a = inner.getBoundingClientRect();
      const b = outer.getBoundingClientRect();
      return (
        a.left >= b.left - 0.5 &&
        a.right <= b.right + 0.5 &&
        a.top >= b.top - 0.5 &&
        a.bottom <= b.bottom + 0.5
      );
    };
    const apart = (one: Element, other: Element) => {
      const a = one.getBoundingClientRect();
      const b = other.getBoundingClientRect();
      return (
        a.right <= b.left + 0.5 ||
        a.left >= b.right - 0.5 ||
        a.bottom <= b.top + 0.5 ||
        a.top >= b.bottom - 0.5
      );
    };
    const parts = [...lane.querySelectorAll("span > span")].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    return {
      shown: parts.filter((part) => within(part, lane)).map((part) => part.textContent),
      cut: parts
        .filter((part) => !within(part, lane) && !apart(part, lane))
        .map((part) => part.textContent),
      overlapped: content.getBoundingClientRect().right > lane.getBoundingClientRect().left + 0.5,
      ellipsis: [...content.querySelectorAll("[data-truncate-marker]")].some(
        (marker) => getComputedStyle(marker).opacity === "1",
      ),
      statusInTree: within(status, host),
    };
  }, path);

test("a row too narrow for its name truncates the name, never its decoration", async ({
  context,
  page,
}) => {
  const name = "a_module_name_far_too_long_for_the_sidebar_to_show_whole.rs";
  const rowMarkup = `<li role="treeitem" id="${name}" aria-level="1" aria-label="${name} has 12 comments" aria-selected="false"><div class="PRIVATE_TreeView-item-visual"><svg class="octicon octicon-file-diff"></svg></div><a href="#diff-a11c">${name}</a><div class="PRIVATE_TreeView-item-visual"><div><svg class="octicon octicon-comment"></svg><div>12</div></div></div></li>`;
  await serve(
    context,
    PR_URL,
    PR_BODY.replace(
      "<!doctype html>",
      "<!doctype html><style>#pr-file-tree { width: 280px; }</style>",
    ).replace(TREE_OPEN, `${TREE_OPEN}${rowMarkup}`),
  );
  await page.goto(PR_URL);
  await expect(page.locator(`[data-item-path="${name}"]`)).toBeVisible();

  await expect
    .poll(() => rowLayout(page, name))
    .toEqual({
      shown: ["12"],
      cut: [],
      overlapped: false,
      ellipsis: true,
      statusInTree: true,
    });
});

/**
 * The chain row above CHAIN_FILE: the units it shows, in order, as folder names and `…`, and
 * which of those are cut; `null` until it renders.
 */
const chainLayout = (page: Page) =>
  page.evaluate(() => {
    const row = [...document.querySelectorAll(".gh-prism-tree")]
      .flatMap((tree) => [...(tree.shadowRoot?.querySelectorAll('[data-type="item"]') ?? [])])
      .find((item) => item.querySelector('[data-item-flattened-subitem$="sentry-cli/"]'));
    const units = [...(row?.querySelectorAll("[data-item-flattened-subitems] > *") ?? [])].filter(
      (unit) => getComputedStyle(unit).visibility === "visible",
    );
    if (!units.length) return null;
    const nameOf = (unit: Element) =>
      unit.getAttribute("data-item-flattened-subitem")?.split("/").at(-2) ?? "…";
    const isCut = (unit: Element) =>
      unit.scrollWidth > unit.clientWidth ||
      [...unit.querySelectorAll("[data-truncate-marker]")].some(
        (marker) => getComputedStyle(marker).opacity === "1",
      );
    return { shown: units.map(nameOf), cut: units.filter(isCut).map(nameOf) };
  });

const setTreeWidth = (page: Page, width: number) =>
  page.evaluate((width) => {
    const tree = document.getElementById("pr-file-tree");
    if (!tree) throw new Error("no #pr-file-tree");
    tree.style.width = `${width}px`;
  }, width);

const servesChain = async (context: BrowserContext, page: Page) => {
  await serve(context, PR_URL, PR_BODY.replace(TREE_OPEN, `${TREE_OPEN}${CHAIN_ROW}`));
  await page.goto(PR_URL);
};

const expectCollapsedChain = async (page: Page) => {
  await setTreeWidth(page, 280);

  await expect
    .poll(async () => {
      const layout = await chainLayout(page);
      return {
        first: layout?.shown[0],
        last: layout?.shown.at(-1),
        ellipses: layout?.shown.filter((name) => name === "…").length,
        cut: layout?.cut,
      };
    })
    .toEqual({ first: "managed", last: "sentry-cli", ellipses: 1, cut: [] });
};

test("a folder chain too long for its row keeps its first and deepest folders around one …", async ({
  context,
  page,
}) => {
  await servesChain(context, page);

  await expectCollapsedChain(page);
});

test("a folder chain refits as the sidebar is resized", async ({ context, page }) => {
  await servesChain(context, page);
  await setTreeWidth(page, 280);
  await expect.poll(() => chainLayout(page)).toMatchObject({ cut: [] });
  const collapsed = await chainLayout(page);

  await setTreeWidth(page, 900);
  await expect
    .poll(() => chainLayout(page))
    .toEqual({
      shown: ["managed", "dot_config", "opencode", "skills", "sentry-cli"],
      cut: [],
    });

  await setTreeWidth(page, 280);
  await expect.poll(() => chainLayout(page)).toEqual(collapsed);
  expect(collapsed?.shown).toContain("…");
});

test("a folder chain at 200% zoom keeps the same rules", async ({ context, page }) => {
  await page.addInitScript(() => {
    document.documentElement.style.zoom = "2";
  });
  await servesChain(context, page);

  await expectCollapsedChain(page);
});

test("a folder chain with room for only its deepest folder shows … and that folder", async ({
  context,
  page,
}) => {
  await servesChain(context, page);
  await setTreeWidth(page, 190);

  await expect.poll(() => chainLayout(page)).toEqual({ shown: ["…", "sentry-cli"], cut: [] });
});

test("a deepest folder too long for its row truncates in the middle", async ({ context, page }) => {
  await servesChain(context, page);
  await setTreeWidth(page, 140);

  await expect
    .poll(() => chainLayout(page))
    .toEqual({ shown: ["…", "sentry-cli"], cut: ["sentry-cli"] });
});

test("a folder chain settles at every sidebar width", async ({ context, page }) => {
  const chains = [
    "alpha/bravo-charlie/delta/echo_foxtrot/golf-hotel-india",
    "pkg/a/b/zzz-component",
  ];
  const rows = chains.map(
    (chain, i) =>
      `<li role="treeitem" id="${chain}/F${i}.md" aria-level="1" aria-label="F${i}.md" aria-selected="false"><a href="#diff-c4b${i}">F${i}.md</a></li>`,
  );
  await serve(
    context,
    PR_URL,
    PR_BODY.replace(TREE_OPEN, `${TREE_OPEN}${CHAIN_ROW}${rows.join("")}`),
  );
  await page.goto(PR_URL);
  await expect.poll(() => chainLayout(page)).not.toBeNull();

  const unsettled = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const layout = () =>
      [...document.querySelectorAll(".gh-prism-tree")]
        .flatMap((tree) => [
          ...(tree.shadowRoot?.querySelectorAll("[data-item-flattened-subitems] > *") ?? []),
        ])
        .map((unit) => getComputedStyle(unit).visibility)
        .join();
    const tree = document.getElementById("pr-file-tree");
    if (!tree) throw new Error("no #pr-file-tree");
    const unsettledWidths = [];
    for (let width = 220; width <= 370; width++) {
      tree.style.width = `${width}px`;
      await frame();
      await frame();
      const before = layout();
      await frame();
      if (layout() !== before) unsettledWidths.push(width);
    }
    return unsettledWidths;
  });

  expect(unsettled).toEqual([]);
});

const CHAIN_PATH = "managed/dot_config/opencode/skills/sentry-cli/";
const CHAIN_FULL_NAME = "managed/dot_config/opencode/skills/sentry-cli";
const CHAIN_ACCESSIBLE_NAME = "managed / dot_config / opencode / skills / sentry-cli";

/**
 * Samples every frame, in the page and the trees' shadow roots, for each shown full-name copy:
 * the distinct transforms its text took, and any copy shown on a row neither hovered nor
 * focus-visible, or reading another row's name.
 */
const sampleReveals = (page: Page) =>
  page.addInitScript(() => {
    const seen: Record<string, string[]> = {};
    const strays: string[] = [];
    Object.assign(window, { revealSeen: seen, revealStrays: strays });
    const tick = () => {
      const roots = [
        document,
        ...[...document.querySelectorAll(".gh-prism-tree")].flatMap((tree) =>
          tree.shadowRoot ? [tree.shadowRoot] : [],
        ),
      ];
      for (const copy of roots.flatMap((root) => [...root.querySelectorAll("[data-full-name]")])) {
        if (getComputedStyle(copy).visibility !== "visible") continue;
        const text = copy.textContent ?? "";
        const transform = getComputedStyle(copy.firstElementChild ?? copy).transform;
        seen[text] = [...new Set([...(seen[text] ?? []), transform])];
        const button = copy.closest("button");
        const readsOwnName =
          !button?.matches('[data-type="item"]') ||
          button.getAttribute("aria-label")?.replaceAll(" / ", "/").startsWith(text);
        if (!button?.matches(":hover, :focus-visible") || !readsOwnName) strays.push(text);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** The distinct transforms `text`'s revealed copy has taken so far. */
const transformsOf = (page: Page, text: string) =>
  page.evaluate(
    (text) =>
      (window as unknown as { revealSeen: Record<string, string[]> }).revealSeen[text] ?? [],
    text,
  );

/**
 * Inside button `row`: whether its full-name copy shows, what it reads, whether anything of the
 * at-rest text still paints, and how many animations its text runs.
 */
const revealOf = (row: Locator) =>
  row.evaluate((row) => {
    const copy = row.querySelector("[data-full-name]");
    const host = copy?.parentElement;
    if (!copy || !host) return null;
    const style = getComputedStyle(copy);
    const atRest = [host, ...host.querySelectorAll("*")].filter(
      (part) => !copy.contains(part) && getComputedStyle(part).visibility === "visible",
    );
    return {
      shown: style.visibility === "visible" && style.opacity === "1",
      text: copy.textContent,
      atRestShown: atRest.length > 0,
      animations: copy.firstElementChild?.getAnimations().length ?? 0,
    };
  });

const servesNarrowChain = async (context: BrowserContext, page: Page) => {
  await sampleReveals(page);
  await servesChain(context, page);
  await setTreeWidth(page, 280);
  await expect.poll(() => chainLayout(page)).toMatchObject({ cut: [] });
};

const expectScrollingReveal = async (page: Page, row: Locator, text: string) => {
  await expect
    .poll(() => revealOf(row))
    .toEqual({ shown: true, text, atRestShown: false, animations: 1 });
  await expect.poll(async () => (await transformsOf(page, text)).length).toBeGreaterThan(2);
};

test("hovering a truncated row scrolls its full name, and leaving restores it", async ({
  context,
  page,
}) => {
  await servesNarrowChain(context, page);
  const row = page.locator(`[data-item-path="${CHAIN_PATH}"]`);

  const folder = row.locator("[data-item-flattened-subitem]").last();
  await folder.hover();
  // Read before the reveal hides the folder and it stops matching :hover.
  expect(
    await folder.evaluate((el) => el.matches(":hover") && getComputedStyle(el).textDecorationLine),
  ).toBe("none");
  await expectScrollingReveal(page, row, CHAIN_FULL_NAME);

  await page.mouse.move(0, 0);
  await expect(revealOf(row)).resolves.toEqual({
    shown: false,
    text: CHAIN_FULL_NAME,
    atRestShown: true,
    animations: 0,
  });
});

test("keyboard focus reveals a truncated row's full name", async ({ context, page }) => {
  await servesNarrowChain(context, page);
  const row = page.locator(`[data-item-path="${CHAIN_PATH}"]`);

  await row.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");

  await expect(row).toBeFocused();
  await expectScrollingReveal(page, row, CHAIN_FULL_NAME);
});

test("a truncated file row reveals its file name, not its path", async ({ context, page }) => {
  const name = "a_module_name_far_too_long_for_the_sidebar_to_show_whole.rs";
  await sampleReveals(page);
  await serve(
    context,
    PR_URL,
    PR_BODY.replace(
      "<!doctype html>",
      "<!doctype html><style>#pr-file-tree { width: 280px; }</style>",
    ).replace(
      TREE_OPEN,
      `${TREE_OPEN}<li role="treeitem" id="src/${name}" aria-level="1" aria-label="${name}" aria-selected="false"><a href="#diff-a11c">${name}</a></li>`,
    ),
  );
  await page.goto(PR_URL);
  const row = page.locator(`[data-item-path="src/${name}"]`);

  await row.hover();

  await expectScrollingReveal(page, row, name);
});

test("a truncated section header reveals its full label", async ({ context, page }) => {
  await sampleReveals(page);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  const toggle = page.locator(
    '.gh-prism-section[data-section="generated"] .gh-prism-section-toggle',
  );
  await expect(toggle).toBeVisible();
  await setTreeWidth(page, 150);

  await toggle.hover();

  await expectScrollingReveal(page, toggle, "Generated / lockfiles");
});

test("a row stays clickable while its name scrolls", async ({ context, page }) => {
  await servesNarrowChain(context, page);
  const row = page.locator(`[data-item-path="${CHAIN_PATH}"]`);
  const expandedBefore = await row.getAttribute("aria-expanded");
  await row.hover();
  await expectScrollingReveal(page, row, CHAIN_FULL_NAME);

  await row.click();

  await expect(row).not.toHaveAttribute("aria-expanded", expandedBefore ?? "");
});

test("scrolling the tree never leaves a revealed name on another file's row", async ({
  context,
  page,
}) => {
  await sampleReveals(page);
  await serve(context, PR_URL, LARGE_PR_BODY.replace(TREE_OPEN, `${TREE_OPEN}${CHAIN_ROW}`));
  await page.goto(PR_URL);
  await setTreeWidth(page, 280);
  const row = page.locator(`[data-item-path="${CHAIN_PATH}"]`);
  await row.hover();
  await expect.poll(() => revealOf(row)).toMatchObject({ shown: true });
  const sidebar = page.locator("#pr-file-tree");
  const scrollTopBefore = await sidebar.evaluate((sidebar) => sidebar.scrollTop);

  for (let step = 0; step < 10; step++) await page.mouse.wheel(0, -300);
  await expect
    .poll(() => sidebar.evaluate((sidebar) => sidebar.scrollTop))
    .toBeLessThan(scrollTopBefore - 2000);

  expect(
    await page.evaluate(() => (window as unknown as { revealStrays: string[] }).revealStrays),
  ).toEqual([]);
});

test("under reduced motion a revealed name scrolls only by hand", async ({ context, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await servesNarrowChain(context, page);
  const row = page.locator(`[data-item-path="${CHAIN_PATH}"]`);

  await row.hover();
  await expect.poll(() => revealOf(row)).toMatchObject({ shown: true, animations: 0 });

  const scrolled = await row.evaluate((row) => {
    const copy = row.querySelector("[data-full-name]");
    if (!copy) return 0;
    copy.scrollLeft = 30;
    return copy.scrollLeft;
  });
  expect(scrolled).toBe(30);
});

test("a folder chain's accessible name is its full path, once", async ({ context, page }) => {
  await servesNarrowChain(context, page);

  const row = page.getByRole("treeitem", { name: CHAIN_ACCESSIBLE_NAME, exact: true });

  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-full-name]")).toHaveAttribute("aria-hidden", "true");
  await expect(row.locator("[data-item-flattened-ellipsis]")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

// paths.ts, an Implementation file of tests/fixtures/commit-page.html, adds a comment line, so
// its row reads Partial +1 −1, after the review-comment count COMMIT_WITH_COMMENTS gives it.
const COMMIT_DIFF = `diff --git a/src/adapters/opencode/paths.ts b/src/adapters/opencode/paths.ts
index 1111111..2222222 100644
--- a/src/adapters/opencode/paths.ts
+++ b/src/adapters/opencode/paths.ts
@@ -1,3 +1,4 @@
 export const a = 1;
+// The launcher's own path.
+export const b = 2;
-export const d = 4;
 export const c = 3;
`;

const COMMIT_WITH_COMMENTS = COMMIT_BODY.replace(
  'aria-label="paths.ts"',
  'aria-label="paths.ts has 3 comments"',
).replace(
  'role="presentation" tabindex="-1">paths.ts</a></span>',
  'role="presentation" tabindex="-1">paths.ts</a></span><div class="PRIVATE_TreeView-item-visual"><div><svg class="octicon octicon-comment"></svg><div>3</div></div></div>',
);

test("a row short of room for its decoration drops whole parts from its start, never part of one", async ({
  context,
  page,
}) => {
  const path = "src/adapters/opencode/paths.ts";
  await serve(
    context,
    COMMIT_URL,
    COMMIT_WITH_COMMENTS.replace(
      "<!doctype html>",
      "<!doctype html><style>#diff_file_tree { width: 400px; }</style>",
    ),
  );
  await context.route(`${COMMIT_URL}.diff`, (route) =>
    route.fulfill({ contentType: "text/plain", body: COMMIT_DIFF }),
  );
  await page.goto(COMMIT_URL);
  const setWidth = (width: number) =>
    page.evaluate((width) => {
      const tree = document.getElementById("diff_file_tree");
      if (!tree) throw new Error("no #diff_file_tree");
      tree.style.width = `${width}px`;
    }, width);

  await expect
    .poll(() => rowLayout(page, path))
    .toMatchObject({ shown: ["3", "Partial", "+1", "−1"], cut: [], overlapped: false });

  // Room for the name's few characters, Partial and the counts, short of the comment count.
  await setWidth(250);

  await expect
    .poll(() => rowLayout(page, path))
    .toMatchObject({ shown: ["Partial", "+1", "−1"], cut: [], overlapped: false });

  // Room for the name's few characters and the counts, short of Partial by about its width.
  await setWidth(205);

  await expect
    .poll(() => rowLayout(page, path))
    .toMatchObject({ shown: ["+1", "−1"], cut: [], overlapped: false, statusInTree: true });

  // Narrows the tree until the decoration has half its last part's width.
  await page.evaluate((path) => {
    const row = [...document.querySelectorAll(".gh-prism-tree")]
      .map((tree) => tree.shadowRoot?.querySelector(`[data-item-path="${path}"]`))
      .find((found) => found);
    const lane = row?.querySelector('[data-item-section="decoration"]');
    const last = lane?.querySelector("span > span:last-child");
    const tree = document.getElementById("diff_file_tree");
    if (!lane || !last || !tree) throw new Error(`no decoration for ${path}`);
    const excess = lane.getBoundingClientRect().width - last.getBoundingClientRect().width / 2;
    tree.style.width = `${tree.offsetWidth - excess}px`;
  }, path);

  await expect.poll(() => rowLayout(page, path)).toMatchObject({ shown: [], cut: [] });
});

const OVERLAY_HTML = readFixture("pr-overlay.html");
const NARROW = { width: 900, height: 720 };

/** Mounts the overlay fixture as GitHub does on open: a fresh copy of the docked tree, before the page. */
// Keep in sync with tests/fixtures/files-page.ts, whose ?raw imports e2e can't load.
const openOverlay = (page: Page) =>
  page.evaluate((html) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const portal = template.content.querySelector("#__primerPortalRoot__");
    const docked = document.querySelector('#pr-file-tree ul[role="tree"]');
    const slot = portal?.querySelector(
      '#pr-file-tree [class*="FileTreeScrollable"] ul[role="tree"]',
    );
    if (!portal || !docked || !slot) throw new Error("fixture has no overlay or tree");
    const tree = docked.cloneNode(true);
    if (!(tree instanceof Element)) throw new Error("docked tree is not an element");
    slot.replaceWith(tree);
    document.body.prepend(portal);
  }, OVERLAY_HTML);

const closeOverlay = (page: Page) =>
  page.evaluate(() => document.getElementById("__primerPortalRoot__")?.remove());

const overlay = (page: Page) => page.locator('[role="dialog"] #pr-file-tree');
const backdropJustify = (page: Page) =>
  page
    .locator('[class*="prc-Dialog-Backdrop"]')
    .evaluate((el) => getComputedStyle(el).justifyContent);

test("the narrow overlay shows the sections in place of GitHub's tree", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await openOverlay(page);
  await expect(overlay(page).locator(".gh-prism-sections")).toHaveCount(1);
  await expect(overlay(page).locator('ul[role="tree"]')).toBeHidden();
});

test("the narrow overlay opens from the chosen side", async ({ context, page }) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await openOverlay(page);
  await expect.poll(() => backdropJustify(page)).toBe("flex-end");
  await closeOverlay(page);
  await page.getByRole("button", { name: "Move file tree to the left" }).click();
  await openOverlay(page);
  await expect.poll(() => backdropJustify(page)).not.toBe("flex-end");
});

test("the overlay slides in from the right only beside the page, not as a fullscreen sheet", async ({
  context,
  page,
}) => {
  const dialogAnimation = () =>
    page
      .locator('[class*="prc-Dialog-Dialog-"]:has(#pr-file-tree)')
      .evaluate((el) => getComputedStyle(el).animationName);
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await openOverlay(page);
  await expect.poll(dialogAnimation).toBe("gh-prism-overlay-in");
  await page.setViewportSize({ width: 700, height: 720 });
  await expect.poll(dialogAnimation).not.toBe("gh-prism-overlay-in");
});

test("the narrow layout shows the side switch beside its tree toggle", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  const sideSwitch = page.locator(".gh-prism-side-switch");
  await expect(sideSwitch).toBeVisible();
  expect(
    await sideSwitch.evaluate(
      (el) => el.previousElementSibling?.querySelector('[class*="MobileTreeToggle"]') != null,
    ),
  ).toBe(true);
});

test("the narrow side switch opens its tooltip toward the page's middle", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await expect
    .poll(() =>
      page.locator(".gh-prism-side-switch").evaluate((el) => getComputedStyle(el, "::after").left),
    )
    .toBe("0px");
});

test("clicking a file in the narrow overlay scrolls its diff into view", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(
    context,
    PR_URL,
    `${PR_BODY}<div id="${README_DIFF}" style="margin-top: 300vh">README.md</div>`,
  );
  await page.goto(PR_URL);
  await openOverlay(page);
  const diff = page.locator(`#${README_DIFF}`);
  await expect(diff).not.toBeInViewport();
  await overlay(page).locator('[data-item-path="README.md"]').click();
  await expect(diff).toBeInViewport();
});

test("closing the narrow overlay returns the sections to the docked tree", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await openOverlay(page);
  await expect(overlay(page).locator(".gh-prism-sections")).toHaveCount(1);
  await closeOverlay(page);
  await expect(page.locator("#pr-file-tree .gh-prism-sections")).toHaveCount(1);
});

test("an open overlay keeps one sidebar, and its collapsed section, across the narrow breakpoint", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(context, PR_URL, PR_BODY);
  await page.goto(PR_URL);
  await openOverlay(page);
  const toggle = overlay(page).locator(
    '.gh-prism-section[data-section="implementation"] .gh-prism-section-toggle',
  );
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setViewportSize(NARROW);
  await expect(page.locator(".gh-prism-sections")).toHaveCount(1);
  await expect(overlay(page).locator(".gh-prism-sections")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("without a narrow tree toggle, the side switch stays hidden below 1012px", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await serve(
    context,
    PR_URL,
    PR_BODY.replace(/<button class="[^"]*MobileTreeToggle[^"]*"><\/button>/, ""),
  );
  await page.goto(PR_URL);
  await expect(page.locator(".gh-prism-sections")).toHaveCount(1);
  await expect(page.locator(".gh-prism-side-switch")).toBeHidden();
});

test("a commit's narrow layout keeps the side switch hidden", async ({ context, page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await page.goto(COMMIT_URL);
  await expect(page.locator(".gh-prism-sections")).toHaveCount(1);
  await expect(page.locator(".gh-prism-side-switch")).toBeHidden();
});

// src/engine.rs's diff region in tests/fixtures/files-page.html.
const ENGINE_DIFF = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";
const FIXTURE_OWNERS: Record<string, string[]> = {
  "src/lib.rs": ["@o/frontend"],
  "src/helpers.rs": ["@o/frontend"],
  "src/engine.rs": ["@o/platform"],
};

/**
 * Answers the code owners and PR reviewers reads for tests/fixtures/files-page.html; registered
 * after the catch-all 404. `ownership` maps each path to its CODEOWNERS tokens; it defaults to
 * `FIXTURE_OWNERS`. `reviewersStatus` is the status the PR reviewers read answers with.
 */
const routeCodeOwners = async (
  context: BrowserContext,
  ownership = FIXTURE_OWNERS,
  reviewersStatus = 200,
) => {
  const ownershipByPath = Object.fromEntries(
    Object.entries(ownership).map(([path, owners]) => [path, { isOwnedByViewer: false, owners }]),
  );
  await context.route("**/page_data/codeowners", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ isEnabled: true, ownershipByPath }),
    }),
  );
  await context.route("**/page_data/review_requests", (route) =>
    route.fulfill({
      status: reviewersStatus,
      contentType: "application/json",
      body: readFixture("review-requests-sandbox.json"),
    }),
  );
};

/** The file paths the sidebar lists, top to bottom. */
const sidebarFiles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".gh-prism-tree")]
      .flatMap((host) => [
        ...(host.shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
      ])
      .map((row) => row.dataset.itemPath ?? "")
      .filter((path) => !path.endsWith("/")),
  );

for (const [when, reviewersStatus] of [
  ["", 200],
  [" while review_requests fails", 404],
] as const) {
  test(`an owner filter lists only that owner's files and hides the others' diffs${when}`, async ({
    context,
    page,
  }) => {
    await routeCodeOwners(context, FIXTURE_OWNERS, reviewersStatus);
    const url = `${PR_URL}?gh-prism-owner=o/frontend`;
    await serve(context, url, PR_BODY);
    await page.goto(url);

    await expect.poll(() => sidebarFiles(page)).toEqual(["src/helpers.rs", "src/lib.rs"]);
    await expect(shieldOf(page, "src/lib.rs")).toHaveCount(1);
    // The fixture's regions are empty, so visibility can't tell a hidden entry from a shown one.
    await expect(page.locator(`#${ENGINE_DIFF}`).locator("..")).toHaveCSS("display", "none");
  });
}

test("an owner filter shows the diffs of that owner's files", async ({ context, page }) => {
  await routeCodeOwners(context);
  const url = `${PR_URL}?gh-prism-owner=o/platform`;
  await serve(context, url, PR_BODY);
  await page.goto(url);

  await expect.poll(() => sidebarFiles(page)).toEqual(["src/engine.rs"]);
  await expect(page.locator(`#${ENGINE_DIFF}`).locator("..")).not.toHaveCSS("display", "none");
});

// A sibling at each level keeps the tree from flattening the folders, so the file sits at depth 5.
const DEEP_FILE = "src/generated/x/y/z/deep.rs";
const DEEP_ROWS = ["src/generated/x/x.rs", "src/generated/x/y/y.rs", DEEP_FILE]
  .map((path, n) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return `<li role="treeitem" id="${path}" aria-level="1" aria-label="${name}" aria-selected="false"><a href="#diff-dee${n}">${name}</a></li>`;
  })
  .join("");
const OWNED_PATHS = ["README.md", "src/engine.rs", "src/generated/schema.rs", DEEP_FILE];

/** Each of `OWNED_PATHS` owned by `owners`. */
const ownedBy = (owners = ["@o/team", "@octocat"]) =>
  Object.fromEntries(OWNED_PATHS.map((path) => [path, owners]));

const treeRow = (page: Page, path: string) =>
  page.locator(`[data-type="item"][data-item-path="${path}"]`);
const rowIcon = (page: Page, path: string) =>
  treeRow(page, path).locator('[data-item-section="icon"] > svg');
const shieldOf = (page: Page, path: string) => page.locator(`[data-item-shield="${path}"]`);
/** Opens the PR with `OWNED_PATHS` owned by `owners`, once its shields have settled in. */
const openOwned = async (context: BrowserContext, page: Page, owners?: string[]) => {
  await routeCodeOwners(context, ownedBy(owners));
  await serve(context, PR_URL, PR_BODY.replace(TREE_OPEN, `${TREE_OPEN}${DEEP_ROWS}`));
  await page.goto(PR_URL);
  await expect(shieldOf(page, "README.md")).toHaveCount(1);
  await revealSettled(page);
};
const opacityOf = (locator: Locator) =>
  locator.evaluate((element) => getComputedStyle(element).opacity);

test("an owned file's row shows a shield in place of its icon while hovered or focused", async ({
  context,
  page,
}) => {
  await serve(context, COMMIT_URL, COMMIT_BODY);
  await openOwned(context, page);
  const readme = treeRow(page, "README.md");
  const readmeShield = shieldOf(page, "README.md");

  await readme.hover();
  await expect.poll(() => opacityOf(readmeShield)).toBe("1");
  await expect.poll(() => opacityOf(rowIcon(page, "README.md"))).toBe("0");
  await readmeShield.hover();
  await expect.poll(() => opacityOf(readmeShield)).toBe("1");
  await expect.poll(() => opacityOf(rowIcon(page, "README.md"))).toBe("0");
  await page.mouse.move(0, 0);
  await expect.poll(() => opacityOf(readmeShield)).toBe("0");
  await expect.poll(() => opacityOf(rowIcon(page, "README.md"))).toBe("1");

  await treeRow(page, "docs/guide.md").hover();
  await expect(shieldOf(page, "docs/guide.md")).toHaveCount(0);
  await expect.poll(() => opacityOf(rowIcon(page, "docs/guide.md"))).toBe("1");

  for (const path of OWNED_PATHS) {
    const icon = await treeRow(page, path).locator('[data-item-section="icon"]').boundingBox();
    const shield = await shieldOf(page, path).boundingBox();
    if (!icon || !shield) throw new Error(`${path} has no icon or shield box`);
    expect(Math.abs(shield.x + shield.width / 2 - (icon.x + icon.width / 2))).toBeLessThanOrEqual(
      0.5,
    );
    expect(Math.abs(shield.y + shield.height / 2 - (icon.y + icon.height / 2))).toBeLessThanOrEqual(
      1,
    );
  }

  await page.mouse.move(0, 0);
  await readme.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await expect(readme).toBeFocused();
  await expect.poll(() => opacityOf(readmeShield)).toBe("1");
  await page.keyboard.press("Tab");
  await expect(readmeShield).toBeFocused();

  await page.goto(COMMIT_URL);
  await expect(page.locator(".gh-prism-sections")).toHaveCount(1);
  await expect(page.locator("[data-item-shield]")).toHaveCount(0);
});

test("a shield lists its file's code owners in a popover until Escape returns to the row", async ({
  context,
  page,
}) => {
  await openOwned(context, page, ["@o/team", "@someone", "dev@example.com"]);
  const readme = treeRow(page, "README.md");
  const readmeShield = shieldOf(page, "README.md");
  const popover = page.locator(".gh-prism-owners");
  await readme.hover();
  const before = await page.evaluate(() => ({ scrollY: window.scrollY, hash: location.hash }));
  await readmeShield.click();

  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);
  await popover.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map(({ finished }) => finished));
  });
  const shieldBox = await readmeShield.boundingBox();
  const popoverBox = await popover.boundingBox();
  if (!shieldBox || !popoverBox) throw new Error("no shield or popover box");
  // Below the shield, or above it where the viewport has no room below.
  expect(
    Math.min(
      Math.abs(popoverBox.y - (shieldBox.y + shieldBox.height)),
      Math.abs(popoverBox.y + popoverBox.height - shieldBox.y),
    ),
  ).toBeLessThan(1);
  expect(
    await popover.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.position, style.padding, style.maxHeight !== "none"];
    }),
  ).toEqual(["fixed", "12px", true]);
  const links = popover.locator("a");
  await expect(links).toHaveCount(2);
  expect(await links.evaluateAll((all) => all.map((link) => link.getAttribute("href")))).toEqual([
    "https://github.com/orgs/o/teams/team",
    "https://github.com/someone",
  ]);
  expect(await links.evaluateAll((all) => all.map((link) => link.getAttribute("target")))).toEqual([
    "_blank",
    "_blank",
  ]);
  await expect(popover.locator("li").nth(2)).toHaveText("dev@example.com");
  await expect(popover.locator("li").nth(2).locator("a")).toHaveCount(0);
  await expect(readme).not.toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => ({ scrollY: window.scrollY, hash: location.hash }))).toEqual(
    before,
  );

  await page.mouse.move(0, 0);
  expect(await popover.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect.poll(() => opacityOf(readmeShield)).toBe("1");
  await expect.poll(() => opacityOf(rowIcon(page, "README.md"))).toBe("0");

  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  expect(
    await readme.evaluate((row) => (row.getRootNode() as ShadowRoot).activeElement === row),
  ).toBe(true);

  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await expect(readme).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(readmeShield).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);
  expect(await popover.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await popover.locator("a").last().focus();
  await page.keyboard.press("Tab");
  const pastPopover = await focusedControl(page);
  await page.mouse.click(1, 1);
  await expect(popover).toHaveCount(0);
  await readme.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(readmeShield).toBeFocused();
  // Focus opens it, and Tab from the shield walks its links, then goes on past them.
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);
  for (const link of await popover.locator("a").all()) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
  }
  await page.keyboard.press("Tab");
  expect(pastPopover).toBe(await focusedControl(page));
  await expect(popover).toHaveCount(0);
});

test("an owned file's shield opens its owners on hover, and closes as the pointer leaves", async ({
  context,
  page,
}) => {
  await openOwned(context, page);
  const readmeShield = shieldOf(page, "README.md");
  const popover = page.locator(".gh-prism-owners:popover-open");
  await treeRow(page, "README.md").hover();

  await readmeShield.hover();

  await expect(popover).toHaveAttribute("aria-label", "Code owners of README.md");
  expect(await popover.evaluate((element) => element.contains(document.activeElement))).toBe(false);
  await popover.hover();
  await expect(popover).toHaveCount(1);
  await page.mouse.move(1, 1);
  await expect(popover).toHaveCount(0);
});

/** Whether `row` is the focused element of its tree's shadow root. */
const rowFocused = (row: Locator) =>
  row.evaluate((element) => (element.getRootNode() as ShadowRoot).activeElement === element);

test("a hover-opened owners popover holding focus hands it to its row as the pointer leaves", async ({
  context,
  page,
}) => {
  await openOwned(context, page);
  const readme = treeRow(page, "README.md");
  const popover = page.locator(".gh-prism-owners:popover-open");
  await readme.hover();
  await shieldOf(page, "README.md").hover();
  await popover.hover();
  await popover.locator("a").first().focus();

  await page.mouse.move(1, 1);

  await expect(popover).toHaveCount(0);
  expect(await rowFocused(readme)).toBe(true);
});

test("a pinned owners popover holding focus hands it to its row as another shield's opens", async ({
  context,
  page,
}) => {
  await openOwned(context, page);
  const readme = treeRow(page, "README.md");
  await readme.hover();
  await shieldOf(page, "README.md").click();
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);

  await treeRow(page, "src/engine.rs").hover();
  await shieldOf(page, "src/engine.rs").hover();

  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveAttribute(
    "aria-label",
    "Code owners of engine.rs",
  );
  expect(await rowFocused(readme)).toBe(true);
});

/** The focused element, through shadow roots, as the start of its markup. */
const focusedControl = (page: Page) =>
  page.evaluate(() => {
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    return focused?.outerHTML.slice(0, 120);
  });

test("a shield's popover in the overlay closes as the overlay does, leaving its shield usable", async ({
  context,
  page,
}) => {
  await page.setViewportSize(NARROW);
  await openOwned(context, page);
  await openOverlay(page);
  const readmeShield = overlay(page).locator('[data-item-shield="README.md"]');
  await treeRow(page, "README.md").hover();
  await readmeShield.click();
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);

  await closeOverlay(page);

  await expect(page.locator(".gh-prism-owners")).toHaveCount(0);
  await expect(shieldOf(page, "README.md")).not.toHaveAttribute("aria-expanded");
  await treeRow(page, "README.md").hover();
  await shieldOf(page, "README.md").click();
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveCount(1);
});

test("a hovered shield keeps its glyph in forced colours", async ({ context, page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openOwned(context, page);
  const glyphColor = () =>
    shieldOf(page, "README.md").evaluate(
      (shield) => getComputedStyle(shield, "::before").backgroundColor,
    );
  const atRest = await glyphColor();

  await treeRow(page, "README.md").hover();
  await shieldOf(page, "README.md").hover();

  await expect.poll(glyphColor).toBe(atRest);
});

test("a shield's click closes its open popover, and another shield's swaps it", async ({
  context,
  page,
}) => {
  await openOwned(context, page);
  const readme = treeRow(page, "README.md");
  const readmeShield = shieldOf(page, "README.md");
  const popover = page.locator(".gh-prism-owners");

  await readme.hover();
  await readmeShield.click();
  await expect(popover).toHaveCount(1);
  await readmeShield.click();

  await expect(popover).toHaveCount(0);
  await expect(readmeShield).not.toHaveAttribute("aria-expanded");

  await readmeShield.click();
  await expect(popover).toHaveCount(1);
  await treeRow(page, "src/engine.rs").hover();
  await shieldOf(page, "src/engine.rs").click();

  await expect(popover).toHaveCount(1);
  await expect(page.locator(".gh-prism-owners:popover-open")).toHaveAttribute(
    "aria-label",
    "Code owners of engine.rs",
  );
  await expect(readmeShield).not.toHaveAttribute("aria-expanded");
});

test("a code owner reviewer's shield opens their files, closing as the pointer leaves or on Escape", async ({
  context,
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await serve(
    context,
    "https://github.com/o/r/pull/1",
    `<!doctype html>${readFixture("conversation-page.html")}`,
  );
  await context.route("https://github.com/o/r/pull/1/page_data/codeowners", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: readFixture("codeowners-sandbox.json"),
    }),
  );
  await page.goto("https://github.com/o/r/pull/1");
  const shield = page.locator('[id="codeowner-excessive-dev/frontend"]');
  const popup = page.locator(".gh-prism-reviewer-files");

  await shield.hover();
  await expect(popup).toContainText("api/generated/client.ts");
  await expect(popup).toContainText("web/app.ts");

  await page.getByRole("link", { name: "frontend", exact: true }).hover();
  await expect(popup).toBeHidden();

  await shield.focus();
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).toBeHidden();
  expect(errors).toEqual([]);
});

/** Serves the code-owners sandbox's PR #1 Conversation tab at `o/r#1`, with its code owners. */
const serveSandboxConversation = async (context: BrowserContext) => {
  await serve(
    context,
    "https://github.com/o/r/pull/1",
    `<!doctype html>${readFixture("conversation-page.html")}`,
  );
  await context.route("https://github.com/o/r/pull/1/page_data/codeowners", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: readFixture("codeowners-sandbox.json"),
    }),
  );
};
/** Replaces the classic Reviewers list with a copy, as GitHub's `reviewers_updated` does. */
const replaceReviewers = (page: Page) =>
  page
    .locator('form[id^="pull-request-reviewers-form-"]')
    .evaluate((form) => form.replaceWith(form.cloneNode(true)));

for (const { how, open, leave } of [
  {
    how: "hovered card closes once the pointer moves on",
    open: (shield: Locator) => shield.hover(),
    leave: (page: Page) => page.mouse.move(1, 1),
  },
  {
    how: "focused card closes",
    open: (shield: Locator) => shield.focus(),
    leave: async () => {},
  },
]) {
  test(`a code owner reviewer's ${how} after GitHub replaces the Reviewers list`, async ({
    context,
    page,
  }) => {
    await serveSandboxConversation(context);
    await page.goto("https://github.com/o/r/pull/1");
    const shield = page.locator('[id="codeowner-excessive-dev/frontend"]');
    const popup = page.locator(".gh-prism-reviewer-files");
    await expect(async () => {
      await shield.blur();
      await open(shield);
      await expect(popup).toBeVisible({ timeout: 1000 });
    }).toPass();

    await replaceReviewers(page);
    await leave(page);

    await expect(popup).toHaveCount(0);
  });
}

const NODE_PR = "https://github.com/nodejs/node/pull/67056";
const NODE_CRYPTO_FILES = [
  "src/crypto/crypto_context.cc",
  "src/crypto/crypto_context.h",
  "src/crypto/crypto_hash.cc",
  "src/crypto/crypto_rsa.cc",
  "src/crypto/crypto_tls.cc",
  "src/crypto/crypto_util.cc",
];

/**
 * Serves nodejs/node#67056's Conversation tab with `edit` applied to its markup, and its code
 * owners and review_requests, the latter with `editRequests` applied.
 */
const serveNodeConversation = async (
  context: BrowserContext,
  editRequests: (body: {
    pendingReviewRequests: Record<string, unknown>[];
    completedReviews: Record<string, unknown>[];
  }) => void,
  edit: (html: string) => string = (html) => html,
) => {
  await serve(context, NODE_PR, `<!doctype html>${edit(readFixture("conversation-node.html"))}`);
  await context.route(`${NODE_PR}/page_data/codeowners`, (route) =>
    route.fulfill({ contentType: "application/json", body: readFixture("codeowners-node.json") }),
  );
  const requests = JSON.parse(readFixture("review-requests-node.json"));
  editRequests(requests);
  await context.route(`${NODE_PR}/page_data/review_requests`, (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(requests) }),
  );
};
const cryptoTeam = { displayLogin: "nodejs/crypto", name: "crypto", reviewerType: "Team" };

test("a code owner who reviewed for a team keeps a shield that opens their team's files", async ({
  context,
  page,
}) => {
  await serveNodeConversation(context, ({ completedReviews: [pimterry] }) => {
    Object.assign(pimterry ?? {}, { onBehalfOfTeams: [cryptoTeam] });
  });
  await page.goto(NODE_PR);
  const shield = page.locator('button[data-gh-prism-owner="@pimterry"]');
  const popup = page.locator(".gh-prism-reviewer-files");

  await expect(shield).toHaveAccessibleName("pimterry is a code owner through nodejs/crypto");
  await shield.hover();

  await expect(popup).toContainText("Through @nodejs/crypto");
  expect((await popup.locator("li").allTextContents()).sort()).toEqual(NODE_CRYPTO_FILES);
  await expect(popup.getByRole("link", { name: "@nodejs/crypto" })).toHaveAttribute(
    "href",
    "https://github.com/orgs/nodejs/teams/crypto",
  );
});

test("Tab from a code owner reviewer's shield reaches their card's team link, and Escape returns to the shield", async ({
  context,
  page,
}) => {
  await serveNodeConversation(context, ({ completedReviews: [pimterry] }) => {
    Object.assign(pimterry ?? {}, { onBehalfOfTeams: [cryptoTeam] });
  });
  await page.goto(NODE_PR);
  const shield = page.locator('button[data-gh-prism-owner="@pimterry"]');
  const popup = page.locator(".gh-prism-reviewer-files");
  await expect(async () => {
    await shield.blur();
    await shield.focus();
    await expect(popup).toBeVisible({ timeout: 1000 });
  }).toPass();

  await page.keyboard.press("Tab");

  await expect(popup.getByRole("link", { name: "@nodejs/crypto" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(shield).toBeFocused();
});

test("a user's code-owner shield lists their team's files when assigned on its behalf", async ({
  context,
  page,
}) => {
  await serveNodeConversation(
    context,
    ({ pendingReviewRequests: [jasnell] }) => {
      Object.assign(jasnell ?? {}, {
        delegatedFromTeam: cryptoTeam,
        isCodeOwner: true,
        isCodeOwnerFromDelegation: true,
      });
    },
    // GitHub's user shield, shaped as it draws a team's, which a viewer outside nodejs never gets.
    (html) =>
      html.replace(
        '</button><tool-tip id="tooltip-f3e317d4-edf8-45a1-8341-07956ffcced5"',
        '</button><button type="button" id="codeowner-jasnell" class="mr-2 btn-link muted-icon"><span class="reviewers-status-icon">⛨</span></button><tool-tip id="tooltip-f3e317d4-edf8-45a1-8341-07956ffcced5"',
      ),
  );
  await page.goto(NODE_PR);
  const popup = page.locator(".gh-prism-reviewer-files");

  await page.locator('[id="codeowner-jasnell"]').hover();

  await expect(popup).toContainText("Through @nodejs/crypto");
  expect((await popup.locator("li").allTextContents()).sort()).toEqual(NODE_CRYPTO_FILES);
  await expect(page.locator("button[data-gh-prism-owner]")).toHaveCount(0);
});

test("Tab from a code owner's shield enters their long list, then moves on through the sidebar", async ({
  context,
  page,
}) => {
  await serve(
    context,
    "https://github.com/o/r/pull/1",
    `<!doctype html>${readFixture("conversation-page.html")}`,
  );
  const ownershipByPath = Object.fromEntries(
    Array.from({ length: 24 }, (_, i) => [
      `web/components/file-${i}.ts`,
      { isOwnedByViewer: false, owners: ["@excessive-dev/frontend"] },
    ]),
  );
  await context.route("https://github.com/o/r/pull/1/page_data/codeowners", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ isEnabled: true, ownershipByPath }),
    }),
  );
  await page.goto("https://github.com/o/r/pull/1");
  const shield = page.locator('[id="codeowner-excessive-dev/frontend"]');

  // Refocus until the content script, which may attach after load, sees the focus.
  await expect(async () => {
    await shield.blur();
    await shield.focus();
    await expect(page.locator(".gh-prism-reviewer-files")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.keyboard.press("Tab");
  await expect(page.locator(".gh-prism-reviewer-files")).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(page.locator(".gh-prism-reviewer-files")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.activeElement !== document.body &&
        !!document.activeElement?.closest("#partial-discussion-sidebar"),
    ),
  ).toBe(true);
});
