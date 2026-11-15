import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Locator, type Page } from "@playwright/test";
import { installLayoutMenu } from "../tests/fixtures/layout-menu";
import { inputFor, parserFor, regionsOf } from "../tests/fixtures/structural";
import { PAIRING_NEW_TEXT, PAIRING_OLD_TEXT } from "../tests/fixtures/structural-pairing";
import type { StructuralFile } from "../utils/structural/changes";
import { structuralChanges } from "../utils/structural/engine";
import { grammarOf } from "../utils/structural/grammar";
import { addFile, extensionTest } from "./harness";
import type { StructuralHarness } from "./structural-page";

const PR_URL = "https://github.com/o/r/pull/1/changes";
const COMMIT_URL = "https://github.com/o/r/commit/dd95cdc0d7a9a6817998ee6663563e888761f329";
const ANCHOR = "diff-ff278ec599adfd033d35a083ebe8948db8bf177c9817dee8ddc4f3a9e3f5728e";
const ITEM = "Click anywhere on a line to comment";
const PLUS = 'button[aria-label="Add comment"]';

const readFixture = (name: string) =>
  readFileSync(join(import.meta.dirname, "../tests/fixtures", name), "utf8");

const PAGES = {
  pr: {
    url: PR_URL,
    menu: readFixture("layout-menu-pr.html"),
    tables: {
      // Changes both sides, so its three columns can only be Unified.
      unified: readFixture("files-page-diff-rename.html"),
      split: readFixture("files-page-diff-split.html"),
    },
  },
  commit: {
    url: COMMIT_URL,
    menu: readFixture("layout-menu-commit.html"),
    tables: {
      unified: readFixture("commit-page-diff-unified.html"),
      split: readFixture("commit-page-diff-split.html"),
    },
  },
} as const;
type Kind = keyof typeof PAGES;

/**
 * The fixture loads no GitHub sheet, so this stands in for the rules that fit a table to its file
 * and position a code cell, which GitHub's "+" hangs from, and for its smooth-scrolling `html`.
 */
const FIT_TABLES =
  '<style>html { scroll-behavior: smooth; } .width-full { width: 100%; } [class*="tableLayoutFixed"] { table-layout: fixed; } td.diff-text-cell { position: relative; }</style>';

/** `kind`'s page with its captured toolbar, gear and all, and one split diff table. */
function pageBody(kind: Kind): string {
  if (kind === "pr") {
    const toolbar = readFixture("files-page-toolbar.html").replace(
      'aria-haspopup="true" aria-expanded="true"',
      'aria-haspopup="true" aria-expanded="false"',
    );
    return `<!doctype html>${FIT_TABLES}${readFixture("files-page.html")}`
      .replace(/<section class="toolbar__ztHN6">[\s\S]*?<\/section>/, toolbar)
      .replace(/(<div role="region" id="diff-ff278[^"]*">)/, `$1${PAGES.pr.tables.split}`);
  }
  return `<!doctype html>${FIT_TABLES}${readFixture("commit-page.html")}`
    .replace(
      /(<div id="diff-content-parent" tabindex="-1">\s*<div>\s*)<div class="d-flex[^"]*position-sticky[^"]*">[\s\S]*?<\/div>\s*<\/div>/,
      `$1${readFixture("commit-page-toolbar.html")}`,
    )
    .replace(/<table[\s\S]*?<\/table>/, PAGES.commit.tables.split);
}

/** `bundle` is `click-to-comment-page.ts` with the structural painter's harness, built once per worker. */
const test = extensionTest("click-to-comment-page.ts");

declare const window: Window & {
  readonly structural: StructuralHarness;
  readonly clickToComment: () => void;
  readonly opens: string[];
};

/**
 * Plays GitHub's comment controls: a `mouseover` on a code cell mounts the page's one "+" in it a
 * frame later. Records in `window.opens` each untrusted press gh-prism makes: `plus <file>:<line>`
 * for a "+", and `number` or `shift number` for a number cell, `<file>` being the table's index.
 * Self-contained, so `page.addInitScript` can install it.
 */
function installCommentControls(): void {
  const PLUS = 'button[aria-label="Add comment"]';
  const opens: string[] = [];
  Object.assign(window, { opens });
  const lineOf = (cell: Element | null | undefined) => {
    const file = [...document.querySelectorAll("table[data-diff-anchor]")].indexOf(
      cell?.closest("table") as Element,
    );
    return `${file}:${cell?.getAttribute("data-line-anchor")?.replace(/^diff-[0-9a-f]+/, "")}`;
  };

  document.addEventListener("mouseover", (event) => {
    const cell = (event.target as Element).closest?.("td.diff-text-cell[data-line-anchor]");
    if (!cell || cell.querySelector(PLUS)) return;
    requestAnimationFrame(() => {
      document.querySelector(PLUS)?.remove();
      const plus = document.createElement("button");
      plus.setAttribute("aria-label", "Add comment");
      plus.style.cssText = "position: absolute; left: 0; top: 0; width: 16px; height: 16px";
      cell.append(plus);
    });
  });
  document.addEventListener(
    "click",
    (event) => {
      if (event.isTrusted) return;
      const target = event.target as Element;
      if (target.matches(PLUS)) opens.push(`plus ${lineOf(target.closest("td"))}`);
      else if (target.matches("td") && target.nextElementSibling?.matches("td.diff-text-cell"))
        opens.push(`${event.shiftKey ? "shift " : ""}number ${lineOf(target.nextElementSibling)}`);
    },
    true,
  );
}

/** Serves `kind`'s page with a stand-in gear menu and comment controls, and opens it settled. */
async function openPage(context: BrowserContext, page: Page, kind: Kind = "pr") {
  const { url, menu, tables } = PAGES[kind];
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: pageBody(kind) }),
  );
  await context.route("https://github.com/users/diffview", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.addInitScript(installLayoutMenu, { menu, tables });
  await page.addInitScript(installCommentControls);

  await page.goto(url);
  await settle(page);
}

/** Waits for the sections to land and their reveal to finish, and closes the Structural popup. */
async function settle(page: Page) {
  await expect(page.locator("html")).not.toHaveAttribute("data-gh-prism-diffs", "covered");
  await page.locator(".gh-prism-sections").evaluate(async (view) => {
    const finite = view
      .getAnimations({ subtree: true })
      .filter(({ effect }) => effect?.getComputedTiming().iterations !== Infinity);
    // A cancelled animation's `finished` rejects, and it has settled all the same.
    await Promise.allSettled(finite.map(({ finished }) => finished));
  });
  const close = page.locator(".gh-prism-structural-popup button[aria-label=Close]");
  if (await close.isVisible()) await close.click();
}

const gear = (page: Page) => page.locator("button:has(.octicon-gear)");
const item = (page: Page) => page.getByRole("menuitemcheckbox", { name: ITEM });

async function turnOn(page: Page) {
  await gear(page).click();
  await item(page).click();
  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-click-comment");
}

/** Line `n`'s code cell on `side` in the `file`th diff table. */
const line = (page: Page, n: number, { file = 0, side = "right" } = {}) =>
  page
    .locator("table[data-diff-anchor]")
    .nth(file)
    .locator(`td.${side}-side-diff-cell[data-line-anchor="${ANCHOR}R${n}"]`);

/** Hovers `cell` and waits for its "+", as a reader's pointer resting there does. */
async function hoverLine(cell: Locator) {
  await cell.hover();
  await expect(cell.locator(PLUS)).toHaveCount(1);
}

const opens = (page: Page) => page.evaluate(() => window.opens);
const marked = (page: Page) =>
  page
    .locator("[data-gh-prism-comment-range]")
    .evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute("data-line-anchor")?.replace(/^diff-[0-9a-f]+/, "")),
    );
const selected = (page: Page) => page.evaluate(() => getSelection()?.toString() ?? "");

/** Presses on `from`, moves to `to`, and runs `held` before releasing. */
async function drag(page: Page, from: Locator, to: Locator, held = async () => {}) {
  await hoverLine(from);
  await page.mouse.down();
  await to.hover();
  await held();
  await page.mouse.up();
}

test("the gh-prism group offers click to comment unchecked after Wrap lines, and Space checks it for good", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await gear(page).click();

  const group = page.getByRole("group", { name: "gh-prism" });
  await expect(group.getByRole("menuitemcheckbox")).toHaveText([/Wrap lines/, new RegExp(ITEM)]);
  await expect(item(page)).toContainText("Hold Shift to select text");
  await expect(item(page)).toHaveAttribute("aria-checked", "false");
  await item(page).focus();
  await page.keyboard.press(" ");

  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-click-comment");
  await page.reload();
  await settle(page);
  await expect(page.locator("html")).toHaveAttribute("data-gh-prism-click-comment");
});

test("a click on a line's code opens GitHub's box on that line", async ({ context, page }) => {
  await openPage(context, page);
  await turnOn(page);

  await hoverLine(line(page, 4));
  await line(page, 4).locator(".diff-text-inner").click();

  await expect.poll(() => opens(page)).toEqual(["plus 0:R4"]);
});

test("a click on a commit's line opens GitHub's box on that line", async ({ context, page }) => {
  await openPage(context, page, "commit");
  await turnOn(page);
  const cell = page.locator('td.right-side-diff-cell[data-line-anchor$="R135"]');

  await hoverLine(cell);
  await cell.click();

  await expect.poll(() => opens(page)).toEqual([expect.stringMatching(/^plus 0:R135$/)]);
});

test("a drag marks the lines it covers and opens GitHub's box on the range, selecting no text", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await turnOn(page);

  await drag(page, line(page, 4), line(page, 6), async () => {
    await expect.poll(() => marked(page)).toEqual(["R4", "R5", "R6"]);
  });

  await expect.poll(() => opens(page)).toEqual(["number 0:R4", "shift number 0:R6", "plus 0:R6"]);
  expect(await selected(page)).toBe("");
  await expect(page.locator("[data-gh-prism-comment-range]")).toHaveCount(0);
});

test("a drag across a hunk header ends at the last line above it", async ({ context, page }) => {
  await openPage(context, page);
  await turnOn(page);
  await page.evaluate(() => {
    const table = document.querySelector("table[data-diff-anchor]");
    const hunk = table?.querySelector("tr:has(td.diff-hunk-cell)");
    const before = table?.querySelector('td.right-side-diff-cell[data-line-anchor$="R8"]');
    before?.closest("tr")?.before(hunk?.cloneNode(true) as Node);
  });

  await drag(page, line(page, 6), line(page, 10));

  await expect.poll(() => opens(page)).toEqual(["number 0:R6", "shift number 0:R7", "plus 0:R7"]);
});

test("a split drag that drifts into the other side stays on the side it started", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await turnOn(page);

  await drag(page, line(page, 4), line(page, 7, { side: "left" }));

  await expect.poll(() => opens(page)).toEqual(["number 0:R4", "shift number 0:R7", "plus 0:R7"]);
});

test("a drag into the next file ends at its own file's last line", async ({ context, page }) => {
  await openPage(context, page);
  await addFile(page, ANCHOR, "diff-0b7e");
  await turnOn(page);
  const last = await page
    .locator("table[data-diff-anchor]")
    .first()
    .locator("td.right-side-diff-cell[data-line-anchor]")
    .last()
    .evaluate((cell) => cell.getAttribute("data-line-anchor")?.replace(/^diff-[0-9a-f]+/, ""));

  await drag(page, line(page, 20), line(page, 2, { file: 1 }));

  await expect
    .poll(() => opens(page))
    .toEqual(["number 0:R20", `shift number 0:${last}`, `plus 0:${last}`]);
});

test("Escape mid-drag clears the marks and opens nothing", async ({ context, page }) => {
  await openPage(context, page);
  await turnOn(page);

  await drag(page, line(page, 4), line(page, 6), async () => {
    await expect.poll(() => marked(page)).toHaveLength(3);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-gh-prism-comment-range]")).toHaveCount(0);
  });

  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await opens(page)).toEqual([]);
});

test("holding a drag at the window's bottom edge scrolls the page and carries the range along", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await addFile(page, ANCHOR, "diff-0b7e");
  await addFile(page, ANCHOR, "diff-0b7f");
  await turnOn(page);
  const start = line(page, 4);
  // FIT_TABLES' html scrolls smoothly, and a press mid-scroll lands on a line with no "+".
  await start.evaluate((cell) =>
    window.scrollBy({ top: cell.getBoundingClientRect().top - 560, behavior: "instant" }),
  );
  await hoverLine(start);
  const box = await start.boundingBox();
  if (!box) throw new Error("no start line");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, 700);
  const first = (await marked(page)).length;
  const moved = await page.evaluate(async () => {
    const top = scrollY;
    for (let frame = 0; frame < 10; frame++) await new Promise(requestAnimationFrame);
    return scrollY - top;
  });

  // 14px a frame at this depth; a smooth scroll restarted each frame lags far behind.
  expect(moved).toBeGreaterThan(100);
  await expect.poll(async () => (await marked(page)).length).toBeGreaterThan(first);
  await page.mouse.up();
});

test("a Shift drag on a line's code selects its text in place of opening a box", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await addFile(page, ANCHOR, "diff-0b7e");
  await turnOn(page);
  await line(page, 4, { file: 1 })
    .locator(".diff-text-inner")
    .evaluate((other) => getSelection()?.selectAllChildren(other));
  expect(await selected(page)).not.toBe("");
  const text = line(page, 4).locator(".diff-text-inner");
  await text.scrollIntoViewIfNeeded();
  // The text's own box: the inner runs past a short line's last character.
  const box = await text.evaluate((inner) => {
    const range = document.createRange();
    range.selectNodeContents(inner);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
  const y = box.y + box.height / 2;

  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width / 3, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Shift");

  expect(await selected(page)).not.toBe("");
  expect(
    await line(page, 4).evaluate((cell) => {
      const selection = getSelection();
      return (
        cell.contains(selection?.anchorNode ?? null) && cell.contains(selection?.focusNode ?? null)
      );
    }),
  ).toBe(true);
  expect(await opens(page)).toEqual([]);
});

test("a press on a link in a line, a number cell, or the + is left to GitHub", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await turnOn(page);
  await line(page, 4)
    .locator(".diff-text-inner")
    .evaluate((inner) =>
      inner.append(
        Object.assign(document.createElement("a"), { href: "#link", textContent: "link" }),
      ),
    );

  await line(page, 4).getByRole("link", { name: "link" }).click();
  await line(page, 6).evaluate((cell) => cell.previousElementSibling?.setAttribute("id", "number"));
  await page.locator("#number").click();
  await hoverLine(line(page, 8));
  await line(page, 8).locator(PLUS).click();

  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  expect(await opens(page)).toEqual([]);
});

test("a file that loads after click to comment is turned on takes clicks too", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  await turnOn(page);

  await addFile(page, ANCHOR, "diff-0b7e");
  await hoverLine(line(page, 4, { file: 1 }));
  await line(page, 4, { file: 1 }).click();

  await expect.poll(() => opens(page)).toEqual(["plus 1:R4"]);
});

test("the diff takes clicks after a switch to Unified", async ({ context, page }) => {
  await openPage(context, page);
  await turnOn(page);

  await page
    .getByRole("list", { name: "Diff view" })
    .getByRole("button", { name: "Unified" })
    .click();
  await expect(page.locator("table[data-diff-anchor] > colgroup > col")).toHaveCount(3);
  const cell = page.locator('table[data-diff-anchor] td.diff-text-cell[data-line-anchor$="R12"]');
  await hoverLine(cell);
  await cell.click();

  await expect.poll(() => opens(page)).toEqual(["plus 0:R12"]);
});

/** The cursor over whatever sits at `target`'s centre, where `hover` rests the pointer. */
async function cursorAt(page: Page, target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("target has no box");
  return page.evaluate(
    ({ x, y }) => {
      const under = document.elementFromPoint(x, y);
      return under ? getComputedStyle(under).cursor : "";
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

test("a line shows the pointer, through a drag, and the text cursor while Shift is held", async ({
  context,
  page,
}) => {
  await openPage(context, page);
  const code = (n: number) => line(page, n).locator(".diff-text-inner");
  expect(await cursorAt(page, code(4))).not.toBe("pointer");
  await turnOn(page);

  await hoverLine(line(page, 4));
  await code(4).hover();
  expect(await cursorAt(page, code(4))).toBe("pointer");

  await page.keyboard.down("Shift");
  await expect.poll(() => cursorAt(page, code(4))).toBe("text");
  await page.keyboard.up("Shift");
  await expect.poll(() => cursorAt(page, code(4))).toBe("pointer");

  await drag(page, line(page, 4), code(5), async () => {
    await expect.poll(() => marked(page)).toEqual(["R4", "R5"]);
    expect(await cursorAt(page, code(5))).toBe("pointer");
  });
});

test("with click to comment off, a drag on code selects text and opens nothing", async ({
  context,
  page,
}) => {
  await openPage(context, page);

  await line(page, 4).locator(".diff-text-inner").hover();
  await page.mouse.down();
  await line(page, 6).locator(".diff-text-inner").hover();
  await page.mouse.up();

  expect(await selected(page)).not.toBe("");
  expect(await opens(page)).toEqual([]);
});

/** The engine's line matches for the pairing sandbox pull request's `app/records.py`. */
async function pairingMatches(): Promise<NonNullable<StructuralFile["matches"]>> {
  const python = grammarOf("records.py");
  if (!python) throw new Error("no python grammar");
  const result = await structuralChanges(
    inputFor({
      oldText: PAIRING_OLD_TEXT,
      newText: PAIRING_NEW_TEXT,
      language: { grammar: python, parser: await parserFor("python") },
      regions: regionsOf(PAIRING_OLD_TEXT, PAIRING_NEW_TEXT),
    }),
  );
  if (!result.ok || !result.changes.matches) throw new Error("the engine gave no matches");
  return result.changes.matches;
}

test("a drag over Structural's re-paired rows skips the row it leaves empty on that side", async ({
  page,
  bundle,
}) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.setContent(
    `<!doctype html>${FIT_TABLES}<div id="diffs"><div>${readFixture("files-page-pairing-split.html")}</div></div>`,
  );
  await page.addScriptTag({ content: bundle });
  await page.evaluate(installCommentControls);
  const matches = await pairingMatches();
  await page.evaluate((matches) => {
    const files = window.structural.synthesize();
    for (const [anchor, file] of Object.entries(files)) files[anchor] = { ...file, matches };
    window.structural.start(files);
    window.clickToComment();
  }, matches);
  // Old line 120 sits alone in its row once re-paired, between new lines 137 and 138.
  await expect(page.locator("tr[data-gh-prism-added-row]")).toHaveCount(1);
  const cell = (n: number) => page.locator(`td.right-side-diff-cell[data-line-anchor$="R${n}"]`);

  await drag(page, cell(137), cell(139), async () => {
    await expect
      .poll(() => marked(page))
      .toEqual([
        expect.stringMatching(/R137$/),
        expect.stringMatching(/R138$/),
        expect.stringMatching(/R139$/),
      ]);
  });

  await expect
    .poll(() => opens(page))
    .toEqual([
      expect.stringMatching(/^number 0:R137$/),
      expect.stringMatching(/^shift number 0:R139$/),
      expect.stringMatching(/^plus 0:R139$/),
    ]);
});
