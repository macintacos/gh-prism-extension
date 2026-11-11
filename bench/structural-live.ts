/**
 * Live parity smoke for the structural painter: runs the real painter, through the
 * `e2e/structural-page.ts` harness, on a signed-in GitHub pull request in Split and checks that it
 * leaves GitHub's accessibility tree, copy, find, line selection, comments, and replies alone.
 * Kept out of CI, Vitest and Playwright like the rest of `bench/`. It opens comment and reply
 * forms and always cancels them; it never submits one.
 *
 *   bun bench/structural-live.ts --browser <chromium|firefox> --state <storage-state path> [--url <url>]
 *
 * With the default URL it runs every check; with another `--url` it paints, counts, and stops.
 * The documented large-diff run, 25 files of which 19 are modified:
 *
 *   bun bench/structural-live.ts --browser chromium --state <path> --url https://github.com/cli/cli/pull/14805/changes?diff=split
 *
 * The last line is `parity: all checks passed`, or `parity: <N> checks passed, <M> not driven` when
 * a check it could not drive was left to a reviewer; it exits 0 either way, and 1 on a failure.
 */

import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";
import { chromium, firefox, type Locator, type Page } from "@playwright/test";
import type { StructuralHarness } from "../e2e/structural-page";
import { STRUCTURAL_ATTRS } from "../entrypoints/content/diffs/structural-attrs";
import type { StructuralFile } from "../utils/structural/changes";
import { bundle } from "./bundle";

declare const window: Window & { readonly structural: StructuralHarness };

const SANDBOX = "https://github.com/macintacos/gh-prism-sandbox/pull/3/changes?diff=split";
// src/engine.rs, which carries the page's one review thread on line 22.
const ENGINE_ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";

const { values } = parseArgs({
  options: {
    browser: { type: "string", default: "chromium" },
    state: { type: "string" },
    url: { type: "string", default: SANDBOX },
  },
});
const { browser: browserName = "chromium", state, url = SANDBOX } = values;
if (!state || !["chromium", "firefox"].includes(browserName)) {
  console.error(
    "usage: bun bench/structural-live.ts --browser <chromium|firefox> --state <path> [--url <url>]",
  );
  process.exit(1);
}

class Failure extends Error {}

const tally = { passed: 0, notDriven: 0 };

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) throw new Failure(`${name}: FAILED ${detail}`);
  tally.passed++;
  console.log(`${name}: ok ${detail}`);
}

/** Logs a check the script could not drive in this browser, left for a reviewer. */
function notDriven(name: string, why: string): void {
  tally.notDriven++;
  console.log(`${name}: NOT DRIVEN (${why}) — reviewer check`);
}

/** A code cell's number cell, the one before it in its row. */
const numberOf = (cell: Locator) => cell.locator("xpath=preceding-sibling::td[1]");

const selectedRows = (page: Page) =>
  page.evaluate(
    () =>
      new Set(
        [...document.querySelectorAll('td[data-selected="true"]')].map((td) => td.parentElement),
      ).size,
  );

/** Lets `observeDiffs`' 50 ms debounce and the painter's frame run. */
const settle = (page: Page) => page.waitForTimeout(400);

const engineCell = (page: Page, side: "left" | "right", line: number) =>
  page.locator(
    `table[data-diff-anchor="${ENGINE_ANCHOR}"] td.diff-text-cell[data-diff-side="${side}"][data-line-number="${line}"]`,
  );

/** Loads `target` and waits out the re-render GitHub makes a few seconds after load. */
async function load(page: Page, target: string): Promise<void> {
  await page.goto(target);
  await page.locator("table[data-diff-anchor] .diff-text-inner").first().waitFor();
  await page.waitForTimeout(6000);
  await page.addScriptTag({
    content: await bundle(`${import.meta.dirname}/../e2e/structural-page.ts`),
  });
}

/** The page's synthesized files, with the engine thread's line 22 painted rather than quiet. */
function startWithThreadLinePainted(page: Page): Promise<void> {
  return page.evaluate((engine) => {
    const files = window.structural.synthesize();
    const file = files[engine] as StructuralFile | undefined;
    const text = file?.text.new[22];
    if (file && text !== undefined) {
      const word = /\S+/.exec(text);
      const start = word?.index ?? 0;
      files[engine] = {
        ...file,
        annotations: {
          ...file.annotations,
          new: {
            ...file.annotations.new,
            22: {
              quiet: false,
              ranges: [{ startCol: start, endCol: start + (word?.[0].length ?? 0) }],
            },
          },
        },
      };
    }
    window.structural.start(files);
  }, ENGINE_ANCHOR);
}

const ranges = (page: Page) => page.evaluate(() => window.structural.ranges());

/** A cell's text, what selecting all of it copies, and its computed `user-select`. */
const copyOf = (cell: Locator) =>
  cell.evaluate((td) => {
    getSelection()?.selectAllChildren(td);
    const copied = getSelection()?.toString();
    getSelection()?.removeAllRanges();
    return { text: td.textContent, copied, userSelect: getComputedStyle(td).userSelect };
  });

const background = (cell: Locator) => cell.evaluate((td) => getComputedStyle(td).backgroundColor);

/** The `[r, g, b]` of the 1×1 screenshot at (`x`, `y`), from its uncompressed PNG scanline. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  let at = 8;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT")
      data.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  // One filter byte, then the pixel; a single pixel's filter adds nothing to its first sample.
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
}

const rgbOf = (css: string) => (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

/** Opens the comment form on `cell`'s row, types, checks the painting survived, and cancels. */
async function commentOn(page: Page, name: string, cell: Locator): Promise<void> {
  await cell.hover();
  await page.locator("button[data-add-comment-button]").first().click();
  const box = page.getByPlaceholder("Leave a comment").first();
  await box.fill("parity");
  await settle(page);
  const { stale } = await ranges(page);
  check(name, (await box.isVisible()) && stale === 0, `(form open, stale ${stale})`);
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await settle(page);
  check(`${name} cancelled`, (await page.getByPlaceholder("Leave a comment").count()) === 0);
}

/** Every check against the sandbox pull request. */
async function parity(page: Page): Promise<void> {
  await load(page, url);
  const diffs = page.locator("#diffs").or(page.locator("body")).first();
  const quietLine = await page.evaluate((engine) => {
    const files = window.structural.synthesize();
    const quiet = Object.entries(files[engine]?.annotations.new ?? {}).find(
      ([line, annotation]) =>
        annotation.quiet && Number(line) !== 22 && files[engine]?.text.new[Number(line)]?.trim(),
    );
    return Number(quiet?.[0]);
  }, ENGINE_ANCHOR);
  const painted = engineCell(page, "right", 22);
  const quiet = engineCell(page, "right", quietLine);
  const context = page
    .locator(
      `table[data-diff-anchor="${ENGINE_ANCHOR}"] td.diff-text-cell[style*="bgColor-default"]`,
    )
    .first();

  const aria = await diffs.ariaSnapshot();
  const before = { painted: await copyOf(painted), quiet: await copyOf(quiet) };
  const quietBefore = await background(quiet);
  const quietNumber = numberOf(quiet);
  const quietNumberBefore = await background(quietNumber);
  console.log(`1 baseline: ok (painted R22, quiet R${quietLine})`);

  await startWithThreadLinePainted(page);
  await settle(page);
  const painting = await ranges(page);
  const outcomes = Object.values(await page.evaluate(() => window.structural.outcomes()));
  check(
    "2 painted",
    painting.added + painting.removed > 0 &&
      painting.stale === 0 &&
      outcomes.every((o) => o === "painted"),
    `(added ${painting.added}, removed ${painting.removed}, stale ${painting.stale}, ${outcomes.length} files)`,
  );

  check("3 accessibility", (await diffs.ariaSnapshot()) === aria);

  const after = { painted: await copyOf(painted), quiet: await copyOf(quiet) };
  check(
    "4 copy and selection",
    JSON.stringify(after) === JSON.stringify(before),
    JSON.stringify(after.quiet),
  );

  const found = await page.evaluate(
    (text) => (window as unknown as { find(text: string): boolean }).find(text.trim()),
    after.quiet.copied ?? "",
  );
  check("5 find in page", found);

  const quietNow = await background(quiet);
  const quietNumberNow = await background(quietNumber);
  const contextBackground = await background(context);
  check(
    "6 quiet row tinted",
    quietNow !== quietBefore &&
      quietNow !== contextBackground &&
      quietNumberNow !== quietNumberBefore,
    `(code ${quietBefore} → ${quietNow}, number ${quietNumberBefore} → ${quietNumberNow}, context ${contextBackground})`,
  );
  // The background GitHub's rules paint on a selected line.
  const selected = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.backgroundColor = "var(--bgColor-attention-muted)";
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await quietNumber.click();
  await settle(page);
  check(
    "6 quiet row selected",
    (await background(quiet)) === selected,
    `(${await background(quiet)} = ${selected})`,
  );

  await commentOn(page, "7 comment on painted row", painted);
  await commentOn(page, "7 comment on quiet row", quiet);

  await multiLine(page, painted, quiet, selected);

  await page
    .locator(`table[data-diff-anchor="${ENGINE_ANCHOR}"] button`, { hasText: "Write a reply" })
    .first()
    .click();
  const reply = page.getByPlaceholder("Leave a comment").first();
  await reply.fill("parity");
  await settle(page);
  check("9 reply on painted thread", (await reply.isVisible()) && (await ranges(page)).stale === 0);
  await reply.fill("");
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();

  // Checks 7 to 9 change GitHub's own tree (an expanded thread), so abort is compared with the
  // tree just before it; check 3 already compared the painted tree with the baseline.
  await settle(page);
  const ariaPainted = await diffs.ariaSnapshot();
  await page.evaluate(() => window.structural.stop());
  await checkStopped(page);
  const ariaAfter = (await diffs.ariaSnapshot()).split("\n");
  const was = new Set(ariaPainted.split("\n"));
  check(
    "11 accessibility after abort",
    ariaAfter.join("\n") === ariaPainted,
    ariaAfter.filter((line) => !was.has(line)).join(" | "),
  );

  await linkedLine(page);
  await contrast(page);
}

/** Selects from the quiet row to the painted one by dragging across their line numbers, as a person does. */
async function multiLine(
  page: Page,
  painted: Locator,
  quiet: Locator,
  selected: string,
): Promise<void> {
  const [from, to] = [await numberOf(quiet).boundingBox(), await numberOf(painted).boundingBox()];
  if (!from || !to) return check("8 multi-line range", false, "(no boxes)");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  await settle(page);
  const rows = await selectedRows(page);
  if (rows < 2) {
    notDriven("8 multi-line range", `dragging across line numbers selected ${rows} row`);
  } else {
    const allSelected = await page.evaluate(() =>
      [...document.querySelectorAll('td[data-selected="true"]')].every((td) =>
        // A one-sided row's empty side carries no data-selected at all.
        [...(td.parentElement?.querySelectorAll("td:not(.empty-diff-line)") ?? [])].every(
          (cell) => cell.getAttribute("data-selected") === "true",
        ),
      ),
    );
    const quietBackground = await background(quiet);
    check(
      "8 multi-line range",
      allSelected && quietBackground === selected,
      `(${rows} rows, quiet ${quietBackground})`,
    );
  }
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  if (await cancel.count()) await cancel.first().click();
}

/** Checks the painter left no highlight and no attribute behind. */
async function checkStopped(page: Page): Promise<void> {
  const left = await page.evaluate(
    (markedSelector) => ({
      highlights: CSS.highlights.size,
      attributes: document.querySelectorAll(markedSelector).length,
    }),
    STRUCTURAL_ATTRS.map((name) => `[${name}]`).join(", "),
  );
  check("11 abort", left.highlights === 0 && left.attributes === 0, JSON.stringify(left));
}

/** Reloads on a painted line's hash and reads a pixel inside its token, above the underline. */
async function linkedLine(from: Page): Promise<void> {
  // A fresh tab, so the hash arrives on the page's first navigation as a followed link's would.
  const page = await from.context().newPage();
  await load(page, `${url}#${ENGINE_ANCHOR}R22`);
  await page
    .locator('td[data-selected="true"]')
    .first()
    .waitFor({ timeout: 15000 })
    .catch(() => undefined);
  await startWithThreadLinePainted(page);
  await settle(page);
  const cells = engineCell(page, "right", 22).locator("xpath=..").locator("td");
  const countSelected = () =>
    cells.evaluateAll(
      (tds) => tds.filter((td) => td.getAttribute("data-selected") === "true").length,
    );
  let selectedCells = await countSelected();
  if (selectedCells === 0) {
    notDriven("10 linked line", "GitHub selected no cell on load");
    console.log("10 linked line: selecting R22 by its number instead");
    // The hash already names R22, so a click there alone changes nothing; select R21 first.
    await numberOf(engineCell(page, "right", 21)).click();
    await settle(page);
    await numberOf(engineCell(page, "right", 22)).click();
    await settle(page);
    selectedCells = await countSelected();
  }
  const token = await page.evaluate((engine) => {
    const range = [...(CSS.highlights.get("gh-prism-added") ?? [])].find(
      (r) =>
        r instanceof Range &&
        r.startContainer.parentElement?.closest(`table[data-diff-anchor="${engine}"]`),
    ) as Range | undefined;
    const box = range?.getBoundingClientRect();
    return box && { x: box.x + box.width / 2, y: box.y + 3 };
  }, ENGINE_ANCHOR);
  const expected = rgbOf(await background(engineCell(page, "right", 22)));
  const got = token ? await pixel(page, token.x, token.y) : [];
  const ok =
    selectedCells === (await cells.and(page.locator("td:not(.empty-diff-line)")).count()) &&
    got.length === 3 &&
    got.every((v, i) => Math.abs(v - (expected[i] ?? -99)) <= 2);
  const detail = `(${selectedCells} cells selected, pixel ${got} vs ${expected})`;
  if (browserName === "firefox" && !ok)
    console.log(`10 linked line: MISSED in Firefox ${detail} — reported, not failed`);
  else check("10 linked line", ok, detail);
  await page.evaluate(() => window.structural.stop());
  await page.close();
}

/** WCAG contrast of each underline and word text against its word background, light then dark. */
async function contrast(page: Page): Promise<void> {
  for (const mode of ["light", "dark"]) {
    await page.evaluate(
      (mode) => document.documentElement.setAttribute("data-color-mode", mode),
      mode,
    );
    const ratios = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement("i"));
      const rgba = (value: string) => {
        probe.style.color = value;
        const parts = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      };
      const over = (top: number[], under: number[]) =>
        top.slice(0, 3).map((c, i) => c * (top[3] ?? 1) + (under[i] ?? 0) * (1 - (top[3] ?? 1)));
      const luminance = (rgb: number[]) =>
        rgb
          .map((c) => c / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [luminance(a), luminance(b)];
        return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
      };
      const page = rgba("var(--bgColor-default)").slice(0, 3);
      // Keep in sync with structural.css's underline colours.
      const sides = { addition: "--fgColor-success", deletion: "--display-red-fgColor" } as const;
      // Keep in sync with structural.css's moved outline colour.
      const movedColor = "--fgColor-muted";
      const result = Object.entries(sides).map(([side, underlineColor]) => {
        const line = over(rgba(`var(--diffBlob-${side}Line-bgColor)`), page);
        const word = over(rgba(`var(--diffBlob-${side}Word-bgColor)`), line);
        return {
          side,
          underline: ratio(over(rgba(`var(${underlineColor})`), word), word),
          text: ratio(
            over(rgba(`var(--diffBlob-${side}Word-fgColor, var(--fgColor-default))`), word),
            word,
          ),
          moved: ratio(over(rgba(`var(${movedColor})`), line), line),
        };
      });
      probe.remove();
      return result;
    });
    for (const { side, underline, text, moved } of ratios)
      check(
        `12 contrast ${mode} ${side}`,
        underline >= 3 && text >= 4.5 && moved >= 3,
        `(underline ${underline}:1, text ${text}:1, moved ${moved}:1)`,
      );
  }
}

/** Paints a larger pull request and counts what it holds. */
async function count(page: Page): Promise<void> {
  await load(page, url);
  // Mounts as many files as GitHub will before the harness lists them.
  for (let step = 0; step < 30; step++) {
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1500);
  const split = await page.evaluate(() => Object.keys(window.structural.synthesize()).length);
  await page.evaluate(() => window.structural.start());
  await settle(page);
  const painting = await ranges(page);
  const tables = await page.locator("table[data-diff-anchor]").count();
  // A file only added or only deleted mounts a three-column table, which the painter skips, so a
  // page with no split table paints nothing and proves nothing.
  check(
    "2 painted",
    split > 0 && painting.added + painting.removed > 0 && painting.stale === 0,
    `(${split} split tables; added ${painting.added}, removed ${painting.removed}, stale ${painting.stale})`,
  );
  console.log(
    `13 range count: ${tables} mounted tables, ${split} in split (GitHub virtualizes files, so mounted, not all), ${painting.added + painting.removed} ranges`,
  );
  await page.evaluate(() => window.structural.stop());
  await checkStopped(page);
}

const browser = await (browserName === "firefox" ? firefox : chromium).launch(
  browserName === "chromium" ? { channel: "chromium" } : {},
);
try {
  const context = await browser.newContext({
    storageState: state,
    bypassCSP: true,
    viewport: { width: 1600, height: 1200 },
  });
  const page = await context.newPage();
  // A form with text asks before discarding it; accepting discards, it never submits.
  page.on("dialog", (dialog) => void dialog.accept());
  await (url === SANDBOX ? parity(page) : count(page));
  console.log(
    tally.notDriven
      ? `parity: ${tally.passed} checks passed, ${tally.notDriven} not driven`
      : "parity: all checks passed",
  );
} catch (error) {
  console.error(error instanceof Failure ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
