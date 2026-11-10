import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, type CDPSession, expect, type Page } from "@playwright/test";
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
const MARKED = "[data-gh-prism-structural], [data-gh-prism-quiet], [data-gh-prism-moved]";

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

test("paints a changed token, tints a quiet row, and leaves a selected row GitHub's", async ({
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
  expect((await pixel(token.x, token.y)).equals(await pixel(1, viewport.height - 2))).toBe(true);
  for (const cell of quietCells) expect(await background(cell)).toBe("rgb(255, 230, 120)");
});

test("outlines a moved line's code cells dashed, and keeps the outline on a selected row", async ({
  page,
  bundle,
}) => {
  await mount(page, bundle, [COMMIT_SPLIT], TOKENS);
  const row = page.locator(`tr:has(td[data-line-anchor="${COMMIT_ANCHOR}L137"])`);
  const codeCells = [row.locator("td").nth(1), row.locator("td").nth(3)];
  const outline = (cell: (typeof codeCells)[number]) =>
    cell.evaluate((td) => {
      const { outlineStyle, outlineColor } = getComputedStyle(td);
      return { outlineStyle, outlineColor };
    });
  const unmarked = await codeCells[0]?.screenshot();

  await row.evaluate((tr, anchor) => {
    const [, oldCode, , newCode] = tr.querySelectorAll(":scope > td");
    const oldText = oldCode?.querySelector(".diff-text-inner");
    const newText = newCode?.querySelector(".diff-text-inner");
    if (!oldText || !newText) throw new Error("no code text");
    newText.textContent = `  ${oldText.textContent ?? ""}`;

    const files = window.structural.synthesize();
    const file = files[anchor];
    if (!file) throw new Error("no file");
    const changed = { quiet: false, ranges: [] };
    files[anchor] = {
      ...file,
      annotations: {
        old: { ...file.annotations.old, 137: changed },
        new: { ...file.annotations.new, 137: changed },
      },
    };
    window.structural.start(files);
  }, COMMIT_ANCHOR);
  await repaint(page);

  await expect(row).toHaveAttribute("data-gh-prism-moved", "old new");
  for (const cell of codeCells)
    expect(await outline(cell)).toEqual({
      outlineStyle: "dashed",
      outlineColor: "rgb(90, 90, 90)",
    });
  expect((await codeCells[0]?.screenshot())?.equals(unmarked ?? Buffer.alloc(0))).toBe(false);

  await row.evaluate((tr) => {
    for (const td of tr.querySelectorAll("td")) td.dataset.selected = "true";
  });
  for (const cell of codeCells) expect((await outline(cell)).outlineStyle).toBe("dashed");

  await page.evaluate(() => window.structural.stop());
  for (const cell of codeCells) expect((await outline(cell)).outlineStyle).toBe("none");
  await expect(page.locator(MARKED)).toHaveCount(0);
});
