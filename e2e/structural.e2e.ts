import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { test as base, type CDPSession, expect, type Page } from "@playwright/test";
import { STRUCTURAL_ATTRS } from "../entrypoints/content/diffs/structural-attrs";
import type { StructuralFile } from "../utils/structural/changes";
import type { StructuralHarness } from "./structural-page";

declare const window: Window & { readonly structural: StructuralHarness };

/** `bundle` is the real painter and its harness, built once per worker that runs this file. */
const test = base.extend<object, { bundle: string }>({
  bundle: [
    // Playwright requires a destructured first parameter; this fixture depends on nothing in it.
    async ({ browserName: _ }, use) => {
      await use(
        execFileSync(
          "bun",
          [
            join(import.meta.dirname, "../bench/bundle.ts"),
            join(import.meta.dirname, "structural-page.ts"),
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

const PR_SPLIT = "files-page-diff-split.html";
const COMMIT_SPLIT = "commit-page-diff-split.html";
const PR_ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";
const COMMIT_ANCHOR = "diff-cc3fb1ce8d7fcf13784c71a054155c0fcde23acb2ebee6c808198187e6232c6a";
const MARKED = STRUCTURAL_ATTRS.map((name) => `[${name}]`).join(", ");

/** Mounts `#diffs` with one region per fixture (an empty region for `""`), then `bundle`. */
async function mount(page: Page, bundle: string, fixtures: readonly string[], head = "") {
  const regions = fixtures.map((name) => `<div>${name ? readFixture(name) : ""}</div>`).join("");
  await page.setContent(`<!doctype html>${head}<div id="diffs">${regions}</div>`);
  await page.addScriptTag({ content: bundle });
}

/** Waits out `observeDiffs`'s 50 ms debounce and the painter's frame. */
const repaint = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve())), 50),
      ),
  );

const ranges = (page: Page) => page.evaluate(() => window.structural.ranges());

/** Replaces `anchor`'s table with a deep clone in its region, as expanding context does. */
const replaceTable = (page: Page, anchor: string) =>
  page.evaluate((anchor) => {
    const table = document.querySelector(`table[data-diff-anchor="${anchor}"]`);
    table?.replaceWith(table.cloneNode(true));
  }, anchor);

const startPainted = async (page: Page, bundle: string) => {
  await mount(page, bundle, [PR_SPLIT, COMMIT_SPLIT]);
  await page.evaluate(() => window.structural.start());
  await repaint(page);
};

test("paints both split tables after load", async ({ page, bundle }) => {
  await startPainted(page, bundle);

  const { added, removed, stale, texts } = await ranges(page);
  expect(added + removed).toBeGreaterThan(0);
  expect(stale).toBe(0);
  expect(texts.every((text) => text.length > 0)).toBe(true);
  expect(await page.evaluate(() => window.structural.outcomes())).toEqual({
    [PR_ANCHOR]: "painted",
    [COMMIT_ANCHOR]: "painted",
  });
  await expect(page.locator("tr[data-gh-prism-quiet]")).not.toHaveCount(0);
  await expect(page.locator("table[data-gh-prism-structural]")).toHaveCount(2);
});

test("repaints a table replaced by expanding context, with no stale range", async ({
  page,
  bundle,
}) => {
  await startPainted(page, bundle);
  const before = await ranges(page);
  await page.evaluate(() => window.structural.mark());

  await replaceTable(page, COMMIT_ANCHOR);
  await repaint(page);

  const after = await ranges(page);
  expect(after.stale).toBe(0);
  expect([after.added, after.removed]).toEqual([before.added, before.removed]);
  expect(await page.evaluate(() => window.structural.kept())).toBeLessThan(
    after.added + after.removed,
  );
});

test("keeps every range when a thread mounts inside a painted cell", async ({ page, bundle }) => {
  await startPainted(page, bundle);
  await page.evaluate(() => window.structural.mark());

  await page.evaluate(() => {
    const [range] = CSS.highlights.get("gh-prism-removed") ?? [];
    const cell = range?.startContainer.parentElement?.closest("td.diff-text-cell");
    cell?.querySelector("code")?.after(document.createElement("div"));
  });
  await repaint(page);

  const { added, removed, stale } = await ranges(page);
  expect(await page.evaluate(() => window.structural.kept())).toBe(added + removed);
  expect(stale).toBe(0);
});

test("paints a table that loads after the painter starts", async ({ page, bundle }) => {
  await mount(page, bundle, [""]);
  const table = readFixture(COMMIT_SPLIT);

  await page.evaluate((table) => {
    const region = document.querySelector("#diffs > div");
    if (!region) return;
    region.innerHTML = table;
    const files = window.structural.synthesize();
    region.replaceChildren();
    window.structural.start(files);
  }, table);
  await repaint(page);
  await page.evaluate((table) => {
    const region = document.querySelector("#diffs > div");
    if (region) region.innerHTML = table;
  }, table);
  await repaint(page);

  await expect(page.locator("table[data-gh-prism-structural]")).toHaveCount(1);
  expect((await ranges(page)).removed).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.structural.outcomes())).toEqual({
    [COMMIT_ANCHOR]: "painted",
  });
});

test("paints under hide whitespace, where the file has lines the table doesn't mount", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, ["commit-page-diff-whitespace-split.html"]);

  await page.evaluate(() => {
    const files: Record<string, StructuralFile> = {};
    for (const [anchor, file] of Object.entries(window.structural.synthesize()))
      files[anchor] = {
        annotations: {
          old: { ...file.annotations.old, 9999: { quiet: true } },
          new: {
            ...file.annotations.new,
            9999: { quiet: false, ranges: [{ startCol: 0, endCol: 1 }] },
          },
        },
        text: { old: { ...file.text.old, 9999: "gone" }, new: { ...file.text.new, 9999: "gone" } },
      };
    window.structural.start(files);
  });
  await repaint(page);

  expect(Object.values(await page.evaluate(() => window.structural.outcomes()))).toEqual([
    "painted",
  ]);
  const { added, removed, stale } = await ranges(page);
  expect(stale).toBe(0);
  expect(added + removed).toBeGreaterThan(0);
});

test("clears a table switched to unified and repaints it switched back", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [PR_SPLIT]);
  await page.evaluate(() => window.structural.start());
  await repaint(page);
  const unified = readFixture("files-page-diff-unified.html");

  await page.evaluate((unified) => {
    const template = document.createElement("template");
    template.innerHTML = unified;
    const table = document.querySelector("table");
    const replacement = template.content.querySelector("table");
    if (!table || !replacement) return;
    const split = [...table.children];
    table.replaceChildren(...replacement.children);
    (window as unknown as { split: Element[] }).split = split;
  }, unified);
  await repaint(page);

  const cleared = await ranges(page);
  expect(cleared.added + cleared.removed).toBe(0);
  await expect(page.locator(MARKED)).toHaveCount(0);

  await page.evaluate(() => {
    const { split } = window as unknown as { split: Element[] };
    document.querySelector("table")?.replaceChildren(...split);
  });
  await repaint(page);

  const repainted = await ranges(page);
  expect(repainted.added + repainted.removed).toBeGreaterThan(0);
  await expect(page.locator("table[data-gh-prism-structural]")).toHaveCount(1);
});

test("leaves a table whose text doesn't match its file unpainted", async ({ page, bundle }) => {
  await mount(page, bundle, [PR_SPLIT, COMMIT_SPLIT]);

  await page.evaluate((anchor) => {
    const files = window.structural.synthesize();
    const file = files[anchor];
    if (!file) return;
    const [line] = Object.keys(file.text.new);
    files[anchor] = {
      ...file,
      text: { ...file.text, new: { ...file.text.new, [Number(line)]: "altered" } },
    };
    window.structural.start(files);
  }, PR_ANCHOR);
  await repaint(page);

  expect(await page.evaluate(() => window.structural.outcomes())).toEqual({
    [PR_ANCHOR]: "mismatch",
    [COMMIT_ANCHOR]: "painted",
  });
  const pr = page.locator(`table[data-diff-anchor="${PR_ANCHOR}"]`);
  await expect(pr).not.toHaveAttribute("data-gh-prism-structural");
  await expect(pr.locator(MARKED)).toHaveCount(0);
  expect(
    await pr.evaluate((table) =>
      [...CSS.highlights.values()]
        .flatMap((h) => [...h])
        .some((r) => table.contains(r.startContainer)),
    ),
  ).toBe(false);
  await expect(page.locator(`table[data-diff-anchor="${COMMIT_ANCHOR}"]`)).toHaveAttribute(
    "data-gh-prism-structural",
  );
});

test("abort removes every highlight and mark, and stops repainting", async ({ page, bundle }) => {
  await startPainted(page, bundle);

  await page.evaluate(() => window.structural.stop());

  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  await expect(page.locator(MARKED)).toHaveCount(0);

  await replaceTable(page, COMMIT_ANCHOR);
  await repaint(page);

  expect(await page.evaluate(() => CSS.highlights.size)).toBe(0);
  await expect(page.locator(MARKED)).toHaveCount(0);
});

/** Chromium's running count of layouts. */
async function layoutCount(cdp: CDPSession): Promise<number> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const count = metrics.find(({ name }) => name === "LayoutCount");
  if (!count) throw new Error("Chromium reported no LayoutCount");
  return count.value;
}

test("a repaint forces no layout", async ({ page, browserName, bundle }) => {
  test.skip(browserName === "firefox", "CDP's LayoutCount has no Firefox equivalent");
  await mount(page, bundle, [PR_SPLIT, COMMIT_SPLIT]);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const layoutsAcrossReplace = async () => {
    await repaint(page);
    const before = await layoutCount(cdp);
    await replaceTable(page, COMMIT_ANCHOR);
    await repaint(page);
    return (await layoutCount(cdp)) - before;
  };

  const baseline = await layoutsAcrossReplace();
  await page.evaluate(() => window.structural.start());
  const painting = await layoutsAcrossReplace();

  expect(painting).toBe(baseline);
});

// Routed fixtures load no Primer, so the page gets the variables the sheet reads as literals.
const TOKENS = `<style>
  :root {
    --diffBlob-additionWord-bgColor: rgb(0, 200, 0);
    --diffBlob-deletionWord-bgColor: rgb(200, 0, 0);
    --diffBlob-additionLine-bgColor: rgb(200, 255, 200);
    --diffBlob-deletionLine-bgColor: rgb(255, 200, 200);
    --diffBlob-additionNum-bgColor: rgb(150, 255, 150);
    --diffBlob-deletionNum-bgColor: rgb(255, 150, 150);
    --bgColor-default: rgb(255, 255, 255);
    --fgColor-success: rgb(0, 100, 0);
    --display-red-fgColor: rgb(100, 0, 0);
    --fgColor-muted: rgb(90, 90, 90);
  }
  td[data-selected="true"] { background-color: rgb(255, 230, 120); }
  #swatch { position: fixed; left: 0; bottom: 0; width: 8px; height: 8px; background: rgb(255, 230, 120); }
</style><div id="swatch"></div>`;

test("marks a changed token, tints a quiet row, and keeps the mark on a selected row", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], TOKENS);
  // The commit's one changed row: old line 137 holds a painted token, new line 137 is quiet.
  const row = page.locator(`tr:has(td[data-line-anchor="${COMMIT_ANCHOR}L137"])`);
  const tokenCell = row.locator("td").nth(1);
  const quietCells = [row.locator("td").nth(2), row.locator("td").nth(3)];
  const context = page.locator('td[style*="bgColor-default"]').first();
  const background = (cell: typeof context) =>
    cell.evaluate((td) => getComputedStyle(td).backgroundColor);
  const unpaintedToken = await tokenCell.screenshot();
  const quietBefore = await Promise.all(quietCells.map(background));

  await page.evaluate(() => window.structural.start());
  await repaint(page);

  expect((await tokenCell.screenshot()).equals(unpaintedToken)).toBe(false);
  const quietAfter = await Promise.all(quietCells.map(background));
  const contextBackground = await background(context);
  quietAfter.forEach((after, i) => {
    expect(after).not.toBe(quietBefore[i]);
    expect(after).not.toBe(contextBackground);
  });

  await row.evaluate((tr) => {
    for (const td of tr.querySelectorAll("td")) {
      td.dataset.selected = "true";
      td.style.removeProperty("background-color");
    }
    // Only backgrounds count here: glyphs would land on the sampled pixel.
    tr.style.color = "transparent";
  });
  await repaint(page);

  const token = await page.evaluate(() => {
    const [range] = CSS.highlights.get("gh-prism-removed") ?? [];
    const box = range instanceof Range ? range.getBoundingClientRect() : undefined;
    return box && { x: box.left + 1, y: box.top + 1 };
  });
  if (!token) throw new Error("no painted token");
  const pixel = (x: number, y: number) => page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  expect((await pixel(token.x, token.y)).equals(await pixel(1, viewport.height - 2))).toBe(false);
  for (const cell of quietCells) expect(await background(cell)).toBe("rgb(255, 230, 120)");
});

test("steps down the tint of a line changed in part, and leaves a line changed in full its tint", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], TOKENS);
  const oldCells = page.locator(
    `tr:has(td[data-line-anchor="${COMMIT_ANCHOR}L137"]) > td:nth-child(-n+2)`,
  );
  const backgrounds = () =>
    oldCells.evaluateAll((cells) => cells.map((td) => getComputedStyle(td).backgroundColor));
  const unpainted = await backgrounds();
  const line = (await oldCells.nth(1).locator(".diff-text-inner").textContent()) ?? "";

  await startOver(page, line.trim());
  await repaint(page);
  const full = await backgrounds();
  await page.evaluate(() => window.structural.stop());
  await startOver(page, "RenderLinesResponse");
  await repaint(page);
  const part = await backgrounds();

  expect(full).toEqual(unpainted);
  part.forEach((background, i) => {
    expect(background).not.toBe(unpainted[i]);
  });
});

// GitHub's own rules for a word its diff picked and for a keyword, with literal colours.
const WORD_MARKS = `<style>
  .diff-text-cell .syntax-highlighted-line.deletion .x { color: rgb(1, 2, 3); background-color: rgb(200, 0, 0); }
  :root { --color-prettylights-syntax-keyword: rgb(207, 34, 46); }
  .pl-k { color: var(--color-prettylights-syntax-keyword); }
</style>`;

test("a word GitHub's diff picked shows its syntax colour in a painted table, and GitHub's colour in any other", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], WORD_MARKS);
  const keyword = page.locator("code.deletion .pl-k.x").first();
  const colour = () => keyword.evaluate((span) => getComputedStyle(span).color);
  const unpainted = await colour();

  await page.evaluate(() => window.structural.start());
  await repaint(page);
  const painted = await colour();
  await page.evaluate(() => window.structural.stop());

  expect(unpainted).toBe("rgb(1, 2, 3)");
  expect(painted).toBe("rgb(207, 34, 46)");
  expect(await colour()).toBe("rgb(1, 2, 3)");
});

// GitHub's wrapping, which a routed fixture doesn't load, in a table narrow enough to wrap the
// commit's one changed line.
const WRAPPING = `${TOKENS}<style>
  table { table-layout: fixed; width: 900px; font: 12px/20px monospace; }
  td.diff-text-cell { padding: 0 24px 0 20px; }
  .diff-text-inner { display: block; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }
</style>`;

/** Starts the painter with one range on the commit's old line 137, over `token`. */
const startOver = (page: Page, token: string) =>
  page.evaluate(
    ({ anchor, token }) => {
      const files = window.structural.synthesize();
      const file = files[anchor];
      const startCol = file?.text.old[137]?.indexOf(token) ?? -1;
      if (!file || startCol < 0) throw new Error("no token");
      const ranges = [{ startCol, endCol: startCol + token.length }];
      files[anchor] = {
        ...file,
        annotations: { old: { 137: { quiet: false, ranges } }, new: { 137: { quiet: true } } },
      };
      window.structural.start(files);
    },
    { anchor: COMMIT_ANCHOR, token },
  );

/** The RGB of a 1×1 screenshot. */
function rgb(png: Buffer): number[] {
  const data: Buffer[] = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString("latin1", at + 4, at + 8) === "IDAT") {
      data.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
    }
  }
  // Byte 0 is the scanline's filter type.
  return [...inflateSync(Buffer.concat(data)).subarray(1, 4)];
}

/** The largest difference between two colours' channels. */
const apart = (a: readonly number[], b: readonly number[]) =>
  Math.max(...a.map((value, index) => Math.abs(value - (b[index] ?? 0))));

const padded = ([x = 0, y = 0, width = 0, height = 0]: number[]) => [
  x - 200,
  y - 200,
  width + 400,
  height + 400,
];

test("draws a mark 2px past its token on every side, with its corners rounded off", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], WRAPPING);

  await startOver(page, "RenderLinesResponse");
  await repaint(page);

  const [line, ...rest] = await page.evaluate(() => window.structural.drawn());
  expect(rest).toEqual([]);
  expect(line?.texts).toHaveLength(1);
  expect(line?.boxes).toEqual(line?.texts.map(padded));
  const root = page.locator("[data-gh-prism-marks]");
  const origin = await root.boundingBox();
  const [x = 0, y = 0, width = 0] = (line?.boxes[0] ?? []).map((value) => value / 100);
  if (!origin) throw new Error("no marked line");
  // Floored: the box sits at a fraction of a pixel wherever the font's metrics put it, and a clip
  // rounded up would sample one pixel inside the corner.
  const pixel = async (dx: number, dy: number) =>
    rgb(
      await page.screenshot({
        clip: {
          x: Math.floor(origin.x + x + dx),
          y: Math.floor(origin.y + y + dy),
          width: 1,
          height: 1,
        },
      }),
    );
  const lineTint = await pixel(-3, 8);
  const inside = await pixel(1, 8);
  expect(inside).not.toEqual(lineTint);
  expect(await pixel(width - 1, 8)).not.toEqual(lineTint);
  // Antialiasing leaves a trace of the mark in the corner pixel, so it is near the tint, not equal.
  expect(apart(await pixel(0, 0), lineTint)).toBeLessThan(apart(inside, lineTint) / 4);
});

test("draws a mark again where its token lands when a narrower table wraps the line", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], WRAPPING);
  await page.addStyleTag({ content: "table { width: 1400px !important; }" });
  await startOver(page, "keyof");
  await repaint(page);
  const [wide] = await page.evaluate(() => window.structural.drawn());

  await page.addStyleTag({ content: "table { width: 600px !important; }" });
  await repaint(page);

  const [narrow] = await page.evaluate(() => window.structural.drawn());
  expect(narrow?.texts).not.toEqual(wide?.texts);
  expect(narrow?.boxes).toEqual(narrow?.texts.map(padded));
});

/** Every row's box and every changed line's text boxes, one per rendered fragment. */
const layoutOf = (page: Page) =>
  page.evaluate(() => {
    const box = ({ x, y, width, height }: DOMRect) =>
      [x, y, width, height].map((value) => Math.round(value * 100));
    const range = document.createRange();
    return {
      rows: [...document.querySelectorAll("tr")].map((row) => box(row.getBoundingClientRect())),
      text: [...document.querySelectorAll("code.diff-text .diff-text-inner")].map((root) => {
        range.selectNodeContents(root);
        return [...range.getClientRects()].map(box);
      }),
    };
  });

test("painting moves no row and no text, on wrapped lines too", async ({ page, bundle }) => {
  await mount(page, bundle, [PR_SPLIT, COMMIT_SPLIT], WRAPPING);
  await page.addStyleTag({ content: "table { width: 600px !important; }" });
  const before = await layoutOf(page);
  expect(before.rows.some(([, , , height = 0]) => height > 2000)).toBe(true);

  await startOver(page, "keyof RenderLinesResponses");
  await repaint(page);

  await expect(page.locator("[data-gh-prism-marks]")).not.toHaveCount(0);
  await expect(page.locator("tr[data-gh-prism-quiet]")).not.toHaveCount(0);
  expect(await layoutOf(page)).toEqual(before);
});

test("marks a changed token in the system's colours under forced colours", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], TOKENS);
  await page.emulateMedia({ forcedColors: "active" });
  const tokenCell = page
    .locator(`tr:has(td[data-line-anchor="${COMMIT_ANCHOR}L137"])`)
    .locator("td")
    .nth(1);
  await startOver(page, "RenderLinesResponse");
  await repaint(page);
  const marked = await tokenCell.screenshot();

  // Without its ranges, the cell shows whatever else forced colours leave of the paint.
  await page.evaluate(() => CSS.highlights.clear());
  expect((await tokenCell.screenshot()).equals(marked)).toBe(false);
});
