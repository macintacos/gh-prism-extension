import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import type { NoticesHarness } from "./structural-notices-page";

declare const window: Window & { readonly notices: NoticesHarness };

/** `bundle` is the real notices and their harness, built once per worker that runs this file. */
const test = base.extend<object, { bundle: string }>({
  bundle: [
    // Playwright requires a destructured first parameter; this fixture depends on nothing in it.
    async ({ browserName: _ }, use) => {
      await use(
        execFileSync(
          "bun",
          [
            join(import.meta.dirname, "../bench/bundle.ts"),
            join(import.meta.dirname, "structural-notices-page.ts"),
          ],
          { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        ),
      );
    },
    { scope: "worker" },
  ],
});

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");

// GitHub's file card, which the table fixtures leave out: an entry holding a region, which holds the
// sticky header wrapper, then the bordered card around the table, whose cells are positioned. The
// header sticks 60px down, plus the variable GitHub writes on body, once GitHub has turned its
// entry's stickiness on. Each file is far taller than the viewport.
const CARD_SHEET = `<style>
  body { margin: 0; }
  .diffEntry__x { margin-bottom: 16px; }
  .diffHeaderWrapper__x {
    position: sticky;
    top: calc(var(--base-sticky-header-height, 0px) + 60px);
    z-index: 5;
    height: 42px;
    background: silver;
  }
  .diffEntry__x:not([data-sticky-enabled]) .diffHeaderWrapper__x { position: relative; top: 0; }
  .card { position: relative; border: 1px solid gray; }
  table { width: 100%; margin-bottom: 2000px; }
  td { position: relative; background: white; }
</style>`;

const HEADER_STICKS_AT = 60;

/** Mounts `#diffs` with a file card per fixture, each with its header's stickiness on, then `bundle`. */
async function mountFiles(page: Page, bundle: string, fixtures: readonly string[]) {
  const entries = fixtures
    .map(
      (name) =>
        `<div class="diffEntry__x" data-sticky-enabled><div role="region"><div class="diffHeaderWrapper__x"></div><div class="card">${readFixture(name)}</div></div></div>`,
    )
    .join("");
  await page.setContent(`<!doctype html>${CARD_SHEET}<div id="diffs">${entries}</div>`);
  await page.addScriptTag({ content: bundle });
}

/** Shows every mounted file's notice. */
async function startNotices(page: Page) {
  await page.evaluate(() => window.notices.start());
  await expect(page.locator(".gh-prism-structural-notice")).toHaveCount(
    await page.locator(".card").count(),
  );
}

async function showNotices(page: Page, bundle: string, fixtures: readonly string[]) {
  await mountFiles(page, bundle, fixtures);
  await startNotices(page);
}

/**
 * Where file `index`'s header, notice, and card sit in the viewport, in hundredths of a pixel, and
 * whether the notice is the top node at its centre, and the header at the notice's top edge.
 */
const fileBoxes = (page: Page, index = 0) =>
  page.evaluate((index) => {
    const region = document.querySelectorAll('[role="region"]')[index];
    const header = region?.querySelector(".diffHeaderWrapper__x");
    const notice = region?.querySelector(".gh-prism-structural-notice");
    const card = region?.querySelector(".card");
    if (!header || !notice || !card) throw new Error(`file ${index} is not mounted with a notice`);
    const [headerBox, noticeBox, cardBox] = [header, notice, card].map((node) =>
      node.getBoundingClientRect(),
    );
    if (!headerBox || !noticeBox || !cardBox) throw new Error("unreachable");
    const hundredths = (px: number) => Math.round(px * 100);
    const onTopAt = (node: Element, x: number, y: number) =>
      node.contains(document.elementFromPoint(x, y));
    const centreX = headerBox.left + headerBox.width / 2;
    return {
      headerTop: hundredths(headerBox.top),
      headerBottom: hundredths(headerBox.bottom),
      noticeTop: hundredths(noticeBox.top),
      noticeBottom: hundredths(noticeBox.bottom),
      cardBottom: hundredths(cardBox.bottom),
      noticeOnTop: onTopAt(notice, centreX, noticeBox.top + noticeBox.height / 2),
      headerOverNoticeTop: onTopAt(header, centreX, noticeBox.top + 1),
    };
  }, index);

const scrollTo = (page: Page, y: number) => page.evaluate((y) => window.scrollTo(0, y), y);

/** How far the page must scroll for file `index`'s card to end `px` below the viewport's top. */
const scrollWhereCardEnds = (page: Page, index: number, px: number) =>
  page.evaluate(
    ([index, px]) => {
      const card = document.querySelectorAll(".card")[index];
      if (!card) throw new Error(`no card ${index}`);
      return card.getBoundingClientRect().bottom + scrollY - px;
    },
    [index, px] as const,
  );

const TWO_FILES = ["files-page-diff-split.html", "commit-page-diff-split.html"] as const;

test("a file's notice stays directly below its sticky header, over the rows, while the file scrolls", async ({
  page,
  bundle,
}) => {
  await showNotices(page, bundle, TWO_FILES);

  await scrollTo(page, 900);

  await expect
    .poll(() => fileBoxes(page))
    .toMatchObject({
      headerTop: HEADER_STICKS_AT * 100,
      noticeTop: (HEADER_STICKS_AT + 42) * 100,
      noticeOnTop: true,
    });
});

test("a stuck notice follows its header when GitHub moves the header or changes its height", async ({
  page,
  bundle,
}) => {
  await showNotices(page, bundle, TWO_FILES);
  await scrollTo(page, 900);

  await page.evaluate(() => document.body.style.setProperty("--base-sticky-header-height", "30px"));

  await expect
    .poll(() => fileBoxes(page))
    .toMatchObject({ headerTop: 9000, noticeTop: (90 + 42) * 100 });

  await page.addStyleTag({ content: ".diffHeaderWrapper__x { height: 64px; }" });

  await expect
    .poll(() => fileBoxes(page))
    .toMatchObject({ headerTop: 9000, noticeTop: (90 + 64) * 100 });
});

test("a stuck notice leaves with its file, under the header, and never over the next file", async ({
  page,
  bundle,
}) => {
  await showNotices(page, bundle, TWO_FILES);
  await scrollTo(page, 900);
  await expect.poll(() => fileBoxes(page)).toMatchObject({ noticeTop: 10200 });

  // The first file's card ends 10px below its stuck header: less room than the notice is tall.
  await scrollTo(page, await scrollWhereCardEnds(page, 0, HEADER_STICKS_AT + 42 + 10));

  const leaving = await fileBoxes(page);
  expect(leaving.headerTop).toBe(HEADER_STICKS_AT * 100);
  expect(leaving.noticeBottom).toBeLessThanOrEqual(leaving.cardBottom);
  expect(leaving.noticeTop).toBeLessThan(leaving.headerBottom);
  expect(leaving.headerOverNoticeTop).toBe(true);

  // The second file is mid-scroll, and the first is above the viewport.
  await scrollTo(page, (await scrollWhereCardEnds(page, 1, 0)) - 900);

  expect((await fileBoxes(page, 0)).noticeBottom).toBeLessThan(0);
  await expect
    .poll(() => fileBoxes(page, 1))
    .toMatchObject({ noticeTop: (HEADER_STICKS_AT + 42) * 100, noticeOnTop: true });
});

test("a notice that lands while GitHub has its file's header unstuck sticks below the header once it is sticky", async ({
  page,
  bundle,
}) => {
  await mountFiles(page, bundle, TWO_FILES);
  const second = page.locator(".diffEntry__x").nth(1);
  await second.evaluate((entry) => entry.removeAttribute("data-sticky-enabled"));
  await startNotices(page);

  await scrollTo(page, (await scrollWhereCardEnds(page, 1, 0)) - 900);
  await second.evaluate((entry) => entry.setAttribute("data-sticky-enabled", ""));

  await expect
    .poll(() => fileBoxes(page, 1))
    .toMatchObject({
      headerTop: HEADER_STICKS_AT * 100,
      noticeTop: (HEADER_STICKS_AT + 42) * 100,
    });
});
