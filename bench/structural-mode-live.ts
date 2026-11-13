/**
 * Live check of Structural mode in the built extension on signed-in GitHub pages: nothing
 * structural, notices included, with the preference off; on the pairing pull request, matching
 * lines sharing a row and GitHub's rows restored; with the preference on, each on-screen file
 * painted or skipped for a reason, an unsupported file's notice and none on a painted one;
 * GitHub's Unified turning it off; and the diff view control driving both. Kept out of CI, Vitest
 * and Playwright like the rest of `bench/`.
 *
 *   bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]
 *
 * Builds a scratch copy of the working tree with a bench-only content script that sets and reads
 * the preference and asks the port for a file's answer. Choosing Unified changes the account's
 * saved Layout; the run chooses the original again before it ends, on failure too. Prints one line
 * per check, ends with `mismatch: <n> of <m>`, and exits 1 on a failed assertion.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { buildCopy, scratchCopy } from "./scratch-build";
import {
  anchorOf,
  ask,
  Failure,
  gearLayout,
  launch,
  load,
  noticeBefore,
  offscreenDocuments,
  PROBE,
  pressedView,
  segmentOf,
  shields,
  structuralTraces,
  type View,
} from "./structural-mode-live/harness";
import { type Layout, withLayoutRestored } from "./structural-mode-live/layout";
import type { ProbeAnswer } from "./structural-mode-live/probe";

const [browserName, state, ...urlArgs] = process.argv.slice(2);
if ((browserName !== "chromium" && browserName !== "firefox") || !state) {
  console.error(
    "usage: bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]",
  );
  process.exit(1);
}
const statePath: string = state;

const SANDBOX = "https://github.com/macintacos/gh-prism-sandbox";
const PR4 = `${SANDBOX}/pull/4/changes`;
const PAIRING_PR = `${SANDBOX}/pull/11/changes?diff=split`;
const URLS = urlArgs.length
  ? urlArgs
  : [
      `${PR4}?diff=split`,
      `${SANDBOX}/pull/3/changes?diff=split`,
      `${SANDBOX}/commit/8d807ee?diff=split`,
      `${SANDBOX}/commit/4630717?diff=split`,
    ];
// Keep in sync with structural-notices.ts's NOTICE_COPY.unsupported and the link after it.
const UNSUPPORTED_COPY =
  "Structural mode doesn't cover this file's language yet, so this is GitHub's diff. Request this language";

const log = (line: string) => console.log(line);

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) throw new Failure(`${name}: FAILED ${detail}`);
  log(`${name}: ok ${detail}`.trimEnd());
}

/** Pass 1: with the preference at its default, no URL shows any trace of structural mode. */
async function modeOff(page: Page): Promise<void> {
  check("default preference off", (await ask<unknown>(page, { op: "get" })) === false);
  for (const url of URLS) {
    await load(page, url);
    const [added, removed] = await ask<number[]>(page, { op: "highlights" });
    const traces = await structuralTraces(page);
    const offscreen = browserName === "chromium" ? await offscreenDocuments(page.context()) : 0;
    check(
      `off ${url}`,
      added === 0 &&
        removed === 0 &&
        traces.attributes === 0 &&
        traces.sheets === 0 &&
        traces.notices === 0 &&
        offscreen === 0,
      JSON.stringify({ added, removed, ...traces, offscreen }),
    );
  }
  log("mode off: ok");
}

type Classification =
  | { readonly kind: "unmounted" | "not-split" }
  | { readonly kind: "painted" | "unpainted" }
  | { readonly kind: "mismatch"; readonly detail: string };

/** How `anchor`'s mounted table compares with `answer`'s text, and whether it was painted. */
const classify = (page: Page, anchor: string, answer: ProbeAnswer & { ok: true }) =>
  page.evaluate(
    ({ anchor, text }): Classification => {
      const table = document.querySelector(`table[data-diff-anchor="${anchor}"]`);
      if (!table) return { kind: "unmounted" };
      if (table.querySelector(":scope > colgroup")?.childElementCount !== 4)
        return { kind: "not-split" };
      for (const code of table.querySelectorAll(
        "td.diff-text-cell > code.diff-text.addition, td.diff-text-cell > code.diff-text.deletion",
      )) {
        const [, letter, line] =
          /([LR])(\d+)$/.exec(code.closest("td")?.dataset.lineAnchor ?? "") ?? [];
        const shown = code.querySelector(":scope > .diff-text-inner")?.textContent;
        const side = letter === "R" ? "new" : "old";
        const expected = text[side][Number(line)];
        if (letter && shown !== expected)
          return {
            kind: "mismatch",
            detail: `${letter}${line} page ${JSON.stringify(shown)} port ${JSON.stringify(expected)}`,
          };
      }
      return { kind: table.hasAttribute("data-gh-prism-structural") ? "painted" : "unpainted" };
    },
    { anchor, text: answer.text },
  );

/** Split tables mounted wholly below the viewport, and how many of them are painted. */
const belowFold = (page: Page) =>
  page.evaluate(() => {
    const below = [...document.querySelectorAll("table[data-diff-anchor]")].filter(
      (table) =>
        table.querySelector(":scope > colgroup")?.childElementCount === 4 &&
        table.getBoundingClientRect().top > innerHeight,
    );
    return {
      below: below.length,
      painted: below.filter((table) => table.hasAttribute("data-gh-prism-structural")).length,
    };
  });

/**
 * Scrolls `url` top to bottom, letting each step settle, and classifies every file it mounts. An
 * `unsupported` file that mounted without its sentence before its table, or a painted file with a
 * notice, reads `notice …` instead.
 */
async function scrollAndClassify(
  page: Page,
  answers: Record<string, ProbeAnswer>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  // Unsupported files seen mounted, and whether any step found their sentence.
  const noticeSeen = new Map<string, boolean>();
  let lastY = -1;
  for (let step = 0; step < 60; step++) {
    await page.waitForTimeout(2500);
    for (const [path, answer] of Object.entries(answers)) {
      if (!answer.ok) {
        results.set(path, `problem:${answer.problem}`);
        if (answer.problem !== "unsupported") continue;
        const notice = await noticeBefore(page, anchorOf(path));
        if (notice !== undefined) {
          noticeSeen.set(path, (noticeSeen.get(path) ?? false) || notice === UNSUPPORTED_COPY);
        }
        continue;
      }
      const found = await classify(page, anchorOf(path), answer);
      if (found.kind === "unmounted" || found.kind === "not-split") {
        if (!results.has(path)) results.set(path, found.kind);
        continue;
      }
      if (results.get(path) === "painted" || results.get(path)?.startsWith("notice")) continue;
      const notice = found.kind === "painted" ? await noticeBefore(page, anchorOf(path)) : null;
      results.set(
        path,
        found.kind === "mismatch"
          ? `mismatch ${found.detail}`
          : notice
            ? `notice on a painted file: ${notice}`
            : found.kind,
      );
    }
    const y = await page.evaluate(() => scrollY);
    if (y === lastY) break;
    lastY = y;
    await page.mouse.wheel(0, 700);
  }
  for (const [path, noticed] of noticeSeen) {
    if (!noticed) results.set(path, "notice missing on an unsupported file");
  }
  return results;
}

/** Pass 2: with the preference on, each file the port answered `ok` for paints or mismatches. */
async function modeOn(page: Page): Promise<void> {
  await ask(page, { op: "set", on: true });
  check("preference set on", (await ask<unknown>(page, { op: "get" })) === true);
  let mismatches = 0;
  let answeredOk = 0;
  let unpainted = 0;
  let wrongNotices = 0;
  let mostFiles = { url: "", files: -1 };
  for (const url of URLS) {
    await load(page, url);
    const paths = await ask<string[]>(page, { op: "paths" });
    const answers = await ask<Record<string, ProbeAnswer>>(page, { op: "answers", paths });
    // A URL whose every answer is a problem paints nothing anywhere, so it proves nothing there.
    const paintable = Object.values(answers).some((answer) => answer.ok);
    if (paintable && paths.length > mostFiles.files) mostFiles = { url, files: paths.length };
    const results = await scrollAndClassify(page, answers);
    for (const [path, result] of results) {
      log(`${url} ${path}: ${result}`);
      if (answers[path]?.ok) answeredOk++;
      if (result.startsWith("mismatch")) mismatches++;
      if (result === "unpainted") unpainted++;
      if (result.startsWith("notice")) wrongNotices++;
    }
  }
  check("notices", wrongNotices === 0, `(${wrongNotices} wrong)`);

  // A short window, so a file of that URL starts below the fold.
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport?.width ?? 1600, height: 300 });
  await load(page, mostFiles.url);
  const fold = await belowFold(page);
  if (viewport) await page.setViewportSize(viewport);
  check(
    `unscrolled ${mostFiles.url}`,
    fold.below > 0 && fold.painted === 0,
    `(${fold.below} split tables below the fold, never scrolled to, ${fold.painted} painted)`,
  );
  check("no unpainted file", unpainted === 0, `(${unpainted})`);
  log(`mismatch: ${mismatches} of ${answeredOk}`);
}

const unifiedInSearch = (page: Page) =>
  page.evaluate(() => new URLSearchParams(location.search).get("diff") === "unified");

/**
 * Pass 3: choosing Unified from the gear on pull request #4 turns the preference off. Returns the
 * Layout saved before it.
 */
async function unifiedTurnsOff(page: Page): Promise<Layout> {
  // The menu's checked item follows the layout on screen, so the saved one reads without `?diff=`.
  await load(page, PR4);
  const layout = gearLayout(page);
  const original = await withLayoutRestored(layout, async (original) => {
    log(`layout before: ${original}`);
    // A saved Unified on that load already turned the preference off.
    await ask(page, { op: "set", on: true });
    await load(page, `${PR4}?diff=split`);
    for (let step = 0; step < 5; step++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1500);
    }
    const [addedBefore, removedBefore] = await ask<[number, number]>(page, { op: "highlights" });
    check(
      "painted before Unified",
      addedBefore + removedBefore > 0,
      `(${addedBefore}, ${removedBefore})`,
    );

    await layout.choose("unified");
    const [added, removed] = await ask<number[]>(page, { op: "highlights" });
    const traces = await structuralTraces(page);
    const stored = await ask<unknown>(page, { op: "get" });
    check(
      "unified",
      stored === false &&
        added === 0 &&
        removed === 0 &&
        traces.attributes === 0 &&
        traces.notices === 0,
      JSON.stringify({ stored, added, removed, ...traces }),
    );
    log("unified: preference off");
    log(
      `unified: location.search gained diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
    );

    if (original === "unified") {
      await layout.choose("split");
      log(
        `split: location.search still holds diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
      );
    }
    return original;
  });
  if ((await layout.read()) === "split")
    log(
      `split restored: location.search still holds diff=unified: ${await unifiedInSearch(page)} (${await page.evaluate(() => location.search)})`,
    );
  return original;
}

/**
 * Where ArrowDown from the first changed diff cell moves focus: `next-row` when it lands on the
 * same column one row down.
 */
async function arrowDown(page: Page): Promise<string> {
  const start = await page.evaluate(() => {
    const cell = document.querySelector<HTMLElement>(
      "table[data-diff-anchor] td.diff-text-cell:has(code.addition, code.deletion)",
    );
    if (!cell) return false;
    cell.scrollIntoView({ block: "center" });
    cell.focus();
    return document.activeElement === cell;
  });
  if (!start) return "no focusable cell";
  await page.keyboard.press("ArrowDown");
  return page.evaluate(() => {
    const now = document.activeElement;
    return now instanceof HTMLTableCellElement && now.matches("td.diff-text-cell")
      ? "next-row"
      : `${now?.tagName ?? "none"}.${now?.className ?? ""}`;
  });
}

/** Pass 4: the diff view control drives GitHub's Layout and the mode, on each URL. */
async function viewControl(page: Page): Promise<void> {
  let diffviewPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/users/diffview")) diffviewPosts++;
  });
  await ask(page, { op: "set", on: false });
  await load(page, PR4);
  const layout = gearLayout(page);
  let paintedSomewhere = false;

  await withLayoutRestored(layout, async () => {
    for (const url of URLS) {
      await load(page, url);
      const shieldsBefore = await shields(page);
      const keyOff = await arrowDown(page);

      const press = async (view: View, from: Layout) => {
        const postsBefore = diffviewPosts;
        await segmentOf(page, view).click();
        await page.waitForTimeout(2500);
        const wanted: Layout = view === "Unified" ? "unified" : "split";
        const gear = await layout.read();
        const on = await ask<boolean>(page, { op: "get" });
        const shown = await pressedView(page);
        const posts = diffviewPosts - postsBefore;
        const shieldsNow = await shields(page);
        check(
          `control ${url} ${view}`,
          shown === view.toLowerCase() &&
            gear === wanted &&
            on === (view === "Structural") &&
            posts === (from === wanted ? 0 : 1) &&
            shieldsNow === shieldsBefore,
          JSON.stringify({ shown, gear, on, posts, shields: [shieldsBefore, shieldsNow] }),
        );
      };
      const checkClean = async (after: string) => {
        const [added, removed] = await ask<number[]>(page, { op: "highlights" });
        const traces = await structuralTraces(page);
        check(
          `control ${url} clean after ${after}`,
          added === 0 &&
            removed === 0 &&
            traces.attributes === 0 &&
            traces.sheets === 0 &&
            traces.notices === 0,
          JSON.stringify({ added, removed, ...traces }),
        );
      };
      const checkReload = async (view: View) => {
        await load(page, page.url());
        const shown = await pressedView(page);
        check(`control ${url} reload ${view}`, shown === view.toLowerCase(), `(${shown})`);
      };

      await press("Unified", "split");
      await press("Structural", "unified");
      for (let step = 0; step < 4; step++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(1500);
      }
      const [added, removed] = await ask<[number, number]>(page, { op: "highlights" });
      paintedSomewhere ||= added + removed > 0;
      log(`control ${url} painted after Structural: (${added}, ${removed})`);
      const keyOn = await arrowDown(page);
      await checkReload("Structural");

      await press("Split", "split");
      await checkClean("Split");
      const keyAfter = await arrowDown(page);
      check(
        `control ${url} ArrowDown`,
        keyOff === "next-row" && keyOn === keyOff && keyAfter === keyOff,
        JSON.stringify({ keyOff, keyOn, keyAfter }),
      );

      await layout.choose("unified");
      const followed = await pressedView(page);
      check(`control ${url} follows the gear`, followed === "unified", `(${followed})`);

      await press("Structural", "unified");
      await press("Unified", "split");
      await checkClean("Unified");
      await checkReload("Unified");

      // The round trip that leaves GitHub's own Layout as the last press chose it.
      await press("Structural", "unified");
      await press("Unified", "split");
      await press("Split", "unified");
      log(`control ${url} round trip: ok`);
    }
  });
  await ask(page, { op: "set", on: false });
  check("control painted from a press", paintedSomewhere);
  log("view control: ok");
}

/** The pairing pull request's table: its row count, gh-prism's rows and fillers, and 121's row. */
const pairingState = (page: Page) =>
  page.evaluate(() => {
    const cell = document.querySelector(
      'td.diff-text-cell[data-diff-side="left"][data-line-number="121"]',
    );
    const table = cell?.closest("table");
    if (!table) return undefined;
    const row = cell?.closest("tr");
    return {
      rows: table.querySelectorAll("tr").length,
      added: table.querySelectorAll("tr[data-gh-prism-added-row]").length,
      fillers: table.querySelectorAll("[data-gh-prism-filler]").length,
      numberedFillers: table.querySelectorAll("[data-gh-prism-filler][data-line-number]").length,
      paired: !!row?.querySelector('td[data-diff-side="right"][data-line-number="138"]'),
    };
  });

/**
 * The pairing pass, on the pairing pull request only: new line 138 sits opposite old line 121,
 * fillers carry no line number, the diff view control's Split segment restores GitHub's rows, and
 * an expanded hunk re-pairs the block once.
 */
async function pairing(page: Page, url: string): Promise<void> {
  const settle = async () => {
    await page
      .locator('td.diff-text-cell[data-diff-side="left"][data-line-number="121"]')
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(3000);
    return pairingState(page);
  };
  await ask(page, { op: "set", on: false });
  await load(page, url);
  const github = await settle();
  check("pairing github", !!github && !github.paired && github.added === 0, JSON.stringify(github));

  await segmentOf(page, "Structural").click();
  const on = await settle();
  check(
    "pairing on",
    !!on && on.paired && on.added === 1 && on.fillers > 0 && on.numberedFillers === 0,
    JSON.stringify(on),
  );

  await segmentOf(page, "Split").click();
  const off = await settle();
  check(
    "pairing off",
    !!off && off.added === 0 && off.fillers === 0 && off.rows === github?.rows,
    JSON.stringify({ off, githubRows: github?.rows }),
  );

  await segmentOf(page, "Structural").click();
  await settle();
  const expanded = await page.evaluate(() => {
    const table = document
      .querySelector('td[data-diff-side="left"][data-line-number="121"]')
      ?.closest("table");
    const button = table?.querySelector<HTMLButtonElement>('button[aria-label^="Expand file"]');
    button?.click();
    return button?.getAttribute("aria-label") ?? null;
  });
  const after = await settle();
  check(
    "pairing expanded",
    expanded !== null &&
      !!after &&
      after.paired &&
      after.added === 1 &&
      after.numberedFillers === 0 &&
      after.rows > (on?.rows ?? 0),
    JSON.stringify({ expanded, after }),
  );
  await ask(page, { op: "set", on: false });
  log("pairing: ok");
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-mode-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-mode-profile-"));
let context: BrowserContext | undefined;
try {
  scratchCopy(copy, { "entrypoints/bench-probe.content.ts": PROBE });
  context = await launch(browserName, buildCopy(copy, browserName), profile, statePath);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${SANDBOX}/pull/4`);
  if (await page.locator('meta[name="user-login"][content=""]').count())
    throw new Failure("signed in: FAILED the storage state does not sign GitHub in");
  log(
    `browser: ${browserName} ${context.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))}`,
  );
  await modeOff(page);
  await pairing(page, PAIRING_PR);
  await modeOn(page);
  const before = await unifiedTurnsOff(page);
  await viewControl(page);
  await load(page, PR4);
  const after = await gearLayout(page).read();
  check("layout as found", after === before, `(before: ${before}, after: ${after})`);
} catch (error) {
  log(error instanceof Failure ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
