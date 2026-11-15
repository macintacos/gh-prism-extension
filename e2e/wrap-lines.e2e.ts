import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  firefox,
  type Page,
} from "@playwright/test";
import { withExtension } from "playwright-webextext";
import { MARKS_ATTR } from "../entrypoints/content/diffs/structural-attrs";
import { installLayoutMenu } from "../tests/fixtures/layout-menu";
import type { NoticesHarness } from "./structural-notices-page";
import type { StructuralHarness } from "./structural-page";

const CHROME_EXTENSION = join(import.meta.dirname, "../.output/chrome-mv3");
const FIREFOX_EXTENSION = join(import.meta.dirname, "../.output/firefox-mv3");
const PR_URL = "https://github.com/o/r/pull/1/changes";
const ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");
const MENU = readFixture("layout-menu-pr.html");
const TABLES = {
  // Changes both sides, so its three columns can only be Unified.
  unified: readFixture("files-page-diff-rename.html"),
  split: readFixture("files-page-diff-split.html"),
};
const TOOLBAR = readFixture("files-page-toolbar.html").replace(
  'aria-haspopup="true" aria-expanded="true"',
  'aria-haspopup="true" aria-expanded="false"',
);

type Layout = keyof typeof TABLES;

/**
 * The fixture loads no GitHub sheet, so this stands in for the two rules that fit a table to its
 * file, and the one that positions a code cell, which makes it its line's offset parent in Firefox.
 */
const FIT_TABLES =
  '<style>.width-full { width: 100%; } [class*="tableLayoutFixed"] { table-layout: fixed; } td.diff-text-cell { position: relative; }</style>';
/** The pull request page with the captured toolbar, gear and all, and one diff table in `layout`. */
const pageBody = (layout: Layout) =>
  `<!doctype html>${FIT_TABLES}${readFixture("files-page.html")}`
    .replace(/<section class="toolbar__ztHN6">[\s\S]*?<\/section>/, TOOLBAR)
    .replace(/(<div role="region" id="diff-ff278[^"]*">)/, `$1${TABLES[layout]}`);

/**
 * `bundle` is `wrap-lines-page.ts` with the structural painter's and notices' harnesses, built once
 * per worker. A content script can't be reached on a routed page, which has no repository to compare.
 */
const test = base.extend<{ context: BrowserContext }, { bundle: string }>({
  bundle: [
    // Playwright requires a destructured first parameter; this fixture depends on nothing in it.
    async ({ browserName: _ }, use) => {
      await use(
        execFileSync(
          "bun",
          [
            join(import.meta.dirname, "../bench/bundle.ts"),
            join(import.meta.dirname, "wrap-lines-page.ts"),
          ],
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

declare const window: Window & {
  readonly structural: StructuralHarness;
  readonly notices: NoticesHarness;
  readonly unwrapDiffs: () => void;
};

/** Mounts `table` alone in `#diffs` at a width where its lines overflow, then `bundle`. */
async function mountHarness(page: Page, bundle: string, table: string) {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.setContent(`<!doctype html>${FIT_TABLES}<div id="diffs"><div>${table}</div></div>`);
  await page.addScriptTag({ content: bundle });
}

const toHundredths = (px: number) => Math.round(px * 100) / 100 + 0;

const gear = (page: Page) => page.locator("button:has(.octicon-gear)");
const wrapItem = (page: Page) => page.getByRole("menuitemcheckbox", { name: "Wrap lines" });
const segment = (page: Page, name: "Unified" | "Split" | "Structural") =>
  page
    .getByRole("list", { name: "Diff view" })
    .getByRole("button", { name: name === "Structural" ? /^Structural/ : name });

/**
 * Moves focus through the open menu's items on ArrowDown and ArrowUp, as Primer's menu does; the
 * stand-in Layout menu plays only clicks.
 */
function installMenuArrows(): void {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const menu = (event.target as Element | null)?.closest?.('ul[role="menu"]');
    if (!menu) return;
    const items = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((item) =>
      item.checkVisibility(),
    );
    const at = items.indexOf(event.target as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
    event.preventDefault();
  });
}

/**
 * Serves the pull request page with a stand-in gear menu at a width where some lines overflow,
 * and opens it with the cover lifted and the Structural popup closed. Returns every
 * `/users/diffview` request.
 */
async function openPage(context: BrowserContext, page: Page, layout: Layout = "split") {
  const diffviews: string[] = [];
  await context.route(PR_URL, (route) =>
    route.fulfill({ contentType: "text/html", body: pageBody(layout) }),
  );
  await context.route("https://github.com/users/diffview", (route) => {
    diffviews.push(route.request().postData() ?? "");
    return route.fulfill({ status: 200, body: "" });
  });
  await page.setViewportSize({ width: 900, height: 720 });
  await page.addInitScript(installLayoutMenu, { menu: MENU, tables: TABLES });
  await page.addInitScript(installMenuArrows);

  await page.goto(PR_URL);
  await settle(page);
  return diffviews;
}

/** Waits for the cover to lift and closes the Structural popup, which sits over the toolbar. */
async function settle(page: Page) {
  await expect(page.locator("html")).not.toHaveAttribute("data-gh-prism-diffs", "covered");
  await segment(page, "Structural").scrollIntoViewIfNeeded();
  const close = page.locator(".gh-prism-structural-popup button[aria-label=Close]");
  if (await close.isVisible()) await close.click();
}

/** Opens the gear and clicks "Wrap lines", waiting for the menu to close. */
async function toggleWrap(page: Page) {
  await gear(page).click();
  await wrapItem(page).click();
  await expect(wrapItem(page)).toHaveCount(0);
}

async function unwrap(page: Page) {
  await toggleWrap(page);
  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-wrap", "off");
}

const whiteSpaces = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll("table[data-diff-anchor] td.diff-text-cell .diff-text-inner"),
    ].map((inner) => getComputedStyle(inner).whiteSpace),
  );

/** Each diff table's scrolling box: how far it can scroll sideways. */
const scrollRanges = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("table[data-diff-anchor]")].map(({ parentElement: box }) =>
      box ? box.scrollWidth - box.clientWidth : 0,
    ),
  );

/** Scrolls the first table's box to `x`, then waits a frame for the shift to paint. */
const scrollFileTo = (page: Page, x: number) =>
  page.evaluate(async (x) => {
    const box = document.querySelector("table[data-diff-anchor]")?.parentElement;
    if (!box) throw new Error("no diff table");
    box.scrollLeft = x;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, x);

/**
 * The first table's geometry: its left edge, every number cell's and marker's x, each hunk row's
 * width, and each side's text x and reach.
 */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const table = document.querySelector("table[data-diff-anchor]");
    const box = table?.parentElement;
    if (!table || !box) throw new Error("no diff table");
    const x = (node: Element) => node.getBoundingClientRect().x;
    const textX = (side: string) =>
      [...table.querySelectorAll(`td.${side}-side-diff-cell .diff-text-inner`)].map(x);
    const reach = (side: string) =>
      Number.parseFloat(box.style.getPropertyValue(`--gh-prism-reach-${side}`)) || 0;
    return {
      table: x(table),
      numbers: [...table.querySelectorAll('td[class*="line-number"]')].map(x),
      markers: [...table.querySelectorAll(".diff-text-marker")].map(x),
      hunks: [...table.querySelectorAll("td.diff-hunk-cell")].map(
        (cell) => cell.getBoundingClientRect().width,
      ),
      old: { text: textX("left"), reach: reach("old") },
      new: { text: textX("right"), reach: reach("new") },
      scrollLeft: box.scrollLeft,
    };
  });

type Geometry = Awaited<ReturnType<typeof geometry>>;

/** Each side's text in `moved` sits left of `rest` by the scroll, clamped to that side's reach. */
function expectTextShifted(rest: Geometry, moved: Geometry) {
  for (const side of ["old", "new"] as const) {
    const shift = Math.min(moved.scrollLeft, rest[side].reach);
    expect(moved[side].text.map(toHundredths)).toEqual(
      rest[side].text.map((x) => toHundredths(x - shift)),
    );
  }
}

/** Every `.diff-text-inner` in the first table matching `selector`: its x and computed transform. */
const inners = (page: Page, selector: string) =>
  page.locator(`table[data-diff-anchor] ${selector}`).evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: node.getBoundingClientRect().x,
      transform: getComputedStyle(node).transform,
    })),
  );

/** A copy of the page's diff region under a new anchor, appended after it, as a file that loads late. */
const addFile = (page: Page, anchor: string) =>
  page.evaluate(
    ({ from, anchor }) => {
      const region = document.getElementById(from);
      if (!region) throw new Error("no diff region");
      const copy = region.cloneNode(true) as HTMLElement;
      copy.id = anchor;
      copy.querySelector("table")?.setAttribute("data-diff-anchor", anchor);
      region.after(copy);
    },
    { from: ANCHOR, anchor },
  );

test("Wrap lines is a checked item in the gh-prism group that Space unchecks from the keyboard", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await gear(page).click();
  await expect(page.locator("#__primerPortalRoot__ :focus")).toHaveCount(1);
  const items = await page.locator('#__primerPortalRoot__ [role^="menuitem"]').count();

  const onWrap = () => wrapItem(page).evaluate((item) => item === document.activeElement);
  for (let n = 0; n < items && !(await onWrap()); n++) await page.keyboard.press("ArrowDown");

  await expect(wrapItem(page)).toBeFocused();
  await expect(wrapItem(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "gh-prism" }).locator(wrapItem(page))).toHaveCount(
    1,
  );

  await page.keyboard.press(" ");

  await expect(wrapItem(page)).toHaveCount(0);
  await expect(gear(page)).toBeFocused();
  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-wrap", "off");
});

test("Wrap lines sits after a divider in a group whose heading shows gh-prism's glyph", async ({
  context,
  page,
}) => {
  await openPage(context, page);

  await gear(page).click();

  const item = page.getByRole("menuitemcheckbox", { name: "Wrap lines", exact: true });
  await expect(item).toHaveCount(1);
  await expect(item.locator('[data-component="ActionList.TrailingVisual"]')).toHaveCount(0);
  const group = page.locator(
    '[data-component="ActionList.Group"]:has(> ul[aria-label="gh-prism"])',
  );
  await expect(group.locator('[data-component="GroupHeadingWrap"] svg')).toBeVisible();
  expect(
    await group.evaluate((el) =>
      el.previousElementSibling?.matches('[data-component="ActionList.Divider"]'),
    ),
  ).toBe(true);
});

test("unchecking Wrap lines keeps every code line on one row, and an overflowing file scrolls sideways", async ({
  context,
  page,
}) => {
  await openPage(context, page);

  await unwrap(page);

  await expect.poll(() => whiteSpaces(page)).not.toContain("normal");
  expect(new Set(await whiteSpaces(page))).toEqual(new Set(["pre"]));
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
});

test("scrolling a split file sideways shifts both sides' text together while numbers, markers, and hunks hold still", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await unwrap(page);
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const rest = await geometry(page);
  const expectShifted = (moved: Awaited<ReturnType<typeof geometry>>) => {
    expect(toHundredths(moved.table)).toBe(toHundredths(rest.table));
    expect(moved.numbers.map(toHundredths)).toEqual(rest.numbers.map(toHundredths));
    expect(moved.markers.map(toHundredths)).toEqual(rest.markers.map(toHundredths));
    expect(moved.hunks.map(toHundredths)).toEqual(rest.hunks.map(toHundredths));
    expectTextShifted(rest, moved);
  };

  await scrollFileTo(page, 40);
  const scrolled = await geometry(page);
  expect(scrolled.scrollLeft).toBeGreaterThan(0);
  expectShifted(scrolled);

  await scrollFileTo(page, 0);
  await page.locator("table[data-diff-anchor] td.diff-text-cell").first().hover();
  await page.mouse.wheel(30, 0);
  await expect.poll(async () => (await geometry(page)).scrollLeft).toBeGreaterThan(0);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expectShifted(await geometry(page));
});

test("scrolling one unified file sideways leaves another file's offset alone", async ({
  context,
  page,
}) => {
  await openPage(context, page, "unified");
  // The rename's lines are short; one long line makes both copies overflow.
  await page.evaluate(() => {
    document
      .querySelector("table[data-diff-anchor] td.diff-text-cell .diff-text-inner")
      ?.append(" // a comment long enough to run past the cell".repeat(8));
  });
  await addFile(page, "diff-0b7e");
  await unwrap(page);
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);

  await scrollFileTo(page, 30);

  const offsets = await page.evaluate(() =>
    [...document.querySelectorAll("table[data-diff-anchor]")].map((table) =>
      table.parentElement?.style.getPropertyValue("--gh-prism-x"),
    ),
  );
  expect(offsets).toEqual(["30px", ""]);
});

test("a file that loads after Wrap lines is unchecked comes up unwrapped and measured", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await unwrap(page);

  await addFile(page, "diff-0b7e");

  const late = page.locator("#diff-0b7e");
  await expect
    .poll(() => late.evaluate((region) => region.style.getPropertyValue("--gh-prism-reach")))
    .toMatch(/px$/);
  const spaces = await late.evaluate((region) =>
    [...region.querySelectorAll("td.diff-text-cell .diff-text-inner")].map(
      (inner) => getComputedStyle(inner).whiteSpace,
    ),
  );
  expect(new Set(spaces)).toEqual(new Set(["pre"]));
});

test("a review thread in a line's cell holds its place while the file scrolls sideways", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await page.evaluate(() => {
    const code = document.querySelector("table[data-diff-anchor] td.diff-text-cell code");
    const thread = Object.assign(document.createElement("div"), {
      id: "thread",
      textContent: "A review comment",
    });
    code?.after(thread);
  });
  await unwrap(page);
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const rest = await page.locator("#thread").boundingBox();

  await scrollFileTo(page, 40);

  const moved = await page.locator("#thread").boundingBox();
  expect(moved && [moved.x, moved.width].map(toHundredths)).toEqual(
    rest && [rest.x, rest.width].map(toHundredths),
  );
});

test("a line's add-comment button, hung past its cell's left edge, stays whole while unwrapped", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>("table[data-diff-anchor] td.diff-text-cell");
    if (!cell) throw new Error("no code cell");
    const button = Object.assign(document.createElement("button"), { id: "add-comment" });
    button.style.cssText =
      "position: absolute; left: -11px; top: 0; width: 24px; height: 20px; z-index: 2";
    cell.append(button);
  });
  await unwrap(page);
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const leftEdgeHit = () =>
    page.evaluate(() => {
      const button = document.getElementById("add-comment");
      if (!button) throw new Error("no add-comment button");
      window.scrollBy(0, button.getBoundingClientRect().y - 300);
      const box = button.getBoundingClientRect();
      return document.elementFromPoint(box.x + 1, box.y + box.height / 2)?.id;
    });

  expect(await leftEdgeHit()).toBe("add-comment");
  await scrollFileTo(page, 40);
  expect(await leftEdgeHit()).toBe("add-comment");
});

test("the widest line's last character shows once its file scrolls all the way", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await unwrap(page);
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);

  await page.evaluate(() => {
    const overflow = (inner: HTMLElement) => {
      const code = inner.parentElement as HTMLElement;
      return inner.offsetLeft + inner.offsetWidth - (code.offsetLeft + code.clientWidth);
    };
    const inners = [
      ...document.querySelectorAll<HTMLElement>(
        "table[data-diff-anchor] td.diff-text-cell .diff-text-inner",
      ),
    ];
    const widest = inners.reduce((a, b) => (overflow(b) > overflow(a) ? b : a));
    widest.id = "widest";
    window.scrollTo(0, widest.getBoundingClientRect().y + window.scrollY - 300);
  });
  await scrollFileTo(page, 100_000);

  const lastCharacterHit = await page.evaluate(() => {
    const widest = document.getElementById("widest");
    if (!widest) throw new Error("no widest line");
    const walker = document.createTreeWalker(widest, NodeFilter.SHOW_TEXT);
    let text: Text | undefined;
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (node.textContent?.trim()) text = node as Text;
    if (!text) throw new Error("widest line has no text");
    const end = (text.textContent ?? "").trimEnd().length;
    const range = document.createRange();
    range.setStart(text, end - 1);
    range.setEnd(text, end);
    const char = range.getBoundingClientRect();
    return widest.contains(document.elementFromPoint(char.right - 1, char.y + char.height / 2));
  });
  expect(lastCharacterHit).toBe(true);
});

test("Wrap lines stays unchecked across a reload, and checking it wraps the diffs again", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await unwrap(page);

  await page.reload();
  await settle(page);

  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-wrap", "off");
  await expect.poll(() => whiteSpaces(page)).not.toContain("normal");
  await gear(page).click();
  await expect(wrapItem(page)).toHaveAttribute("aria-checked", "false");
  await wrapItem(page).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-gh-prism-wrap");
  expect(new Set(await whiteSpaces(page))).toEqual(new Set(["normal"]));
  expect(Math.max(...(await scrollRanges(page)))).toBeLessThanOrEqual(0);
});

test("toggling Wrap lines never saves GitHub's diff settings", async ({ context, page }) => {
  const diffviews = await openPage(context, page);

  await unwrap(page);
  await toggleWrap(page);
  await expect(page.locator("html")).not.toHaveAttribute("data-gh-prism-wrap");

  expect(diffviews).toEqual([]);
});

test("Structural's marked lines stay as wide as their text and shift with their row while unwrapped", async ({
  bundle,
  page,
}) => {
  await mountHarness(page, bundle, TABLES.split);
  await page.evaluate(() => window.structural.start());
  const marked = page.locator(`table[data-diff-anchor] [${MARKS_ATTR}]`);
  await expect.poll(() => marked.count()).toBeGreaterThan(0);
  const rows = await page.locator("table[data-diff-anchor] tr").count();

  await page.evaluate(() => window.unwrapDiffs());
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const rest = await geometry(page);

  await scrollFileTo(page, 40);

  expectTextShifted(rest, await geometry(page));
  const widths = await marked.evaluateAll((inners) =>
    inners.map((inner) => {
      const range = document.createRange();
      range.selectNodeContents(inner);
      return {
        width: (inner as HTMLElement).offsetWidth,
        text: range.getBoundingClientRect().width,
      };
    }),
  );
  for (const { width, text } of widths) expect(width).toBeGreaterThanOrEqual(Math.floor(text));
  expect(await page.locator("table[data-diff-anchor] tr").count()).toBe(rows);
});

test("on a commit's unified view, every line shifts by the same scroll once it passes the deletions' reach", async ({
  bundle,
  page,
}) => {
  await mountHarness(page, bundle, readFixture("commit-page-diff-unified.html"));
  await page.evaluate(() => {
    document
      .querySelector("table[data-diff-anchor] td.right-side-diff-cell .diff-text-inner")
      ?.append(" // a comment long enough to run past the cell".repeat(8));
  });
  await page.evaluate(() => window.unwrapDiffs());
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(200);
  const lines = "td.diff-text-cell .diff-text-inner";
  const rest = await inners(page, lines);

  await scrollFileTo(page, 200);

  const shifts = (await inners(page, lines)).map(({ x }, n) => toHundredths((rest[n]?.x ?? 0) - x));
  expect(new Set(shifts)).toEqual(new Set([200]));
});

test("a hunk header's text holds still while its file scrolls sideways", async ({
  bundle,
  page,
}) => {
  await mountHarness(page, bundle, TABLES.split);
  await page.evaluate(() => window.unwrapDiffs());
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const hunks = "td.diff-hunk-cell .diff-text-inner";
  const rest = await inners(page, hunks);
  expect(rest.length).toBeGreaterThan(0);

  await scrollFileTo(page, 40);

  const moved = await inners(page, hunks);
  expect(moved.map(({ x }) => toHundredths(x))).toEqual(rest.map(({ x }) => toHundredths(x)));
  expect(new Set(moved.map(({ transform }) => transform))).toEqual(new Set(["none"]));
});

test("a Structural notice stays clear of the code and holds its place while its file is unwrapped", async ({
  bundle,
  page,
}) => {
  await mountHarness(page, bundle, TABLES.split);
  await page.evaluate(() => window.notices.start());
  const notice = page.locator(".gh-prism-structural-notice");
  await expect(notice).toBeVisible();
  await page.evaluate(() => window.unwrapDiffs());
  await expect.poll(async () => (await scrollRanges(page))[0]).toBeGreaterThan(0);
  const rest = await notice.boundingBox();

  await scrollFileTo(page, 40);

  const moved = await notice.boundingBox();
  expect(moved && toHundredths(moved.x)).toBe(rest && toHundredths(rest.x));
  const overlaps = await notice.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [...document.querySelectorAll("table[data-diff-anchor] tr:has(td.diff-text-cell)")]
      .map((row) => row.getBoundingClientRect())
      .filter((row) => row.top < box.bottom && box.top < row.bottom).length;
  });
  expect(overlaps).toBe(0);
});
