/**
 * Live parity checklist for Structural mode in the built extension, on signed-in GitHub pages, in
 * one browser. Kept out of CI, Vitest and Playwright like the rest of `bench/`.
 *
 *   bun bench/structural-parity-live.ts <chromium|firefox> <storage-state path> [--trunk <built extension directory>]
 *
 * Prints one line per check, `<id> <name>: ok`, `: FAILED <what was seen>`, or
 * `: not driven (<reason>)`, ends with `parity: <N> ok, <F> failed, <M> not driven`, and exits 1
 * when F is not 0. Lines `L`, `M`, and `N` report a measurement, counted in no tally. Every form it
 * opens it cancels and nothing is submitted; a review it starts is discarded, the Layout, Viewed
 * toggles, and thread resolution it changes are put back in a `finally`, leaving reviews and
 * threads that predate the run alone. It stops before any check when `gh` is signed in to another
 * account than the storage state. On nodejs/node it only reads, scrolls, and loads diffs.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import {
  MOVED_ATTR,
  QUIET_ATTR,
  STRUCTURAL_ATTRS,
  TABLE_ATTR,
} from "../entrypoints/content/diffs/structural-attrs";
import { buildCopy, scratchCopy } from "./scratch-build";
import { ADD_COMMENT, commentOn, multiLine, numberOf, type Report } from "./structural-live/forms";
import {
  anchorOf,
  ask,
  type BrowserName,
  gearLayout,
  launch,
  NOTICE_SELECTOR,
  noticeBefore,
  offscreenDocuments,
  PROBE,
  segmentOf,
  shields,
  structuralTraces,
  type View,
} from "./structural-mode-live/harness";
import { withLayoutRestored } from "./structural-mode-live/layout";
import type { ProbePaint } from "./structural-mode-live/probe";

const USAGE =
  "usage: bun bench/structural-parity-live.ts <chromium|firefox> <storage-state path> [--trunk <built extension directory>]";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { trunk: { type: "string" } },
});
const [browserArg, stateArg] = positionals;
if ((browserArg !== "chromium" && browserArg !== "firefox") || !stateArg) {
  console.error(USAGE);
  process.exit(1);
}
const browserName: BrowserName = browserArg;
const statePath: string = stateArg;

const SANDBOX = "https://github.com/macintacos/gh-prism-sandbox";
const PR3 = `${SANDBOX}/pull/3/changes?diff=split`;
const PR4 = `${SANDBOX}/pull/4/changes?diff=split`;
const C1 = `${SANDBOX}/commit/8d807ee?diff=split`;
const C2 = `${SANDBOX}/commit/4630717?diff=split`;
const LINK =
  "https://github.com/macintacos/gh-prism-extension/commit/8583a3c?diff=split#diff-edd0d865ca45c6acf68d782edffe4d87e5bb1d07f5d5bf94623e2f45cb6caa39R480";
const OWN =
  "https://github.com/excessive-dev/gh-prism-codeowners-sandbox/pull/3/changes?diff=split";
const BIG = "https://github.com/nodejs/node/pull/66212/changes?diff=split";
// The largest changed file of BIG, past maxTextLength on both sides.
const BIG_TOO_LARGE = "deps/npm/test/lib/commands/ls.js";
const PR4_LEDGER = anchorOf("app/ledger.py");
const PR3_README = anchorOf("README.md");
const MARKED = STRUCTURAL_ATTRS.map((name) => `[${name}]`).join(", ");

// Keep in sync with structural-notices.ts's NOTICE_COPY, which imports a stylesheet Bun can't load.
const NOTICE_COPY = {
  unsupported: "Structural mode doesn't cover this file's language yet, so this is GitHub's diff.",
  "too-large": "This file is too large for Structural mode, so this is GitHub's diff.",
  mismatch:
    "Structural mode is in beta and its reading of this file doesn't match the page, so this is GitHub's diff; reload to try again.",
} as const;

const tally = { ok: 0, failed: 0, notDriven: 0 };
const log = (line: string) => console.log(line);

function record(id: string, name: string, ok: boolean, detail = ""): void {
  if (ok) tally.ok++;
  else tally.failed++;
  log(`${id} ${name}: ${ok ? "ok" : "FAILED"} ${detail}`.trimEnd());
}

function notDriven(id: string, name: string, why: string): void {
  tally.notDriven++;
  log(`${id} ${name}: not driven (${why})`);
}

/** Runs one check, recording a thrown error as its failure. */
async function run(id: string, name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    record(
      id,
      name,
      false,
      // The first lines of Playwright's call log name the step that timed out.
      (error instanceof Error ? error.message : String(error)).split("\n").slice(0, 4).join(" | "),
    );
  }
}

/** A `Report` for the shared form drivers, under check `id`. */
const reportFor = (id: string): Report => ({
  check: (name, ok, detail) => record(id, name, ok, detail),
  notDriven: (name, why) => notDriven(id, name, why),
});

const wait = (page: Page, ms = 2500) => page.waitForTimeout(ms);

/** Loads `url` and waits for its first diff table and GitHub's re-render after load. */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator("table[data-diff-anchor]").first().waitFor({ timeout: 60_000 });
  // On a lazily loading pull request the sorting line can appear only after the first wait.
  for (const settle of [0, 4000]) {
    await wait(page, settle);
    await page
      .getByText("Sorting files into sections")
      .waitFor({ state: "detached", timeout: 120_000 });
  }
}

/** Presses `view`'s segment and lets the mode settle. */
async function press(page: Page, view: View): Promise<void> {
  await segmentOf(page, view).click();
  await wait(page);
}

/** The page's highlight ranges: per file by diff anchor, and how many are stale or misplaced. */
interface Paint {
  readonly perRange: boolean;
  readonly byAnchor: Record<string, number>;
  readonly stale: number;
  readonly outsideChanged: number;
}

/**
 * The page's paint. In Firefox the probe reads only the ranges' total, which stands in for the
 * per-file counts under the file key `*`, with nothing known stale or outside a changed cell.
 */
const paintOf = async (page: Page): Promise<Paint> => {
  const probed = await ask<ProbePaint>(page, { op: "paint" });
  return probed.perRange
    ? probed
    : { perRange: false, byAnchor: { "*": probed.total }, stale: 0, outsideChanged: 0 };
};
const rangeCount = (paint: Paint) => Object.values(paint.byAnchor).reduce((a, b) => a + b, 0);
/** `anchor`'s ranges, or every range where only the total is known. */
const rangesOf = (paint: Paint, anchor: string) =>
  paint.perRange ? (paint.byAnchor[anchor] ?? 0) : rangeCount(paint);
const marks = (page: Page) => page.evaluate((m) => document.querySelectorAll(m).length, MARKED);

interface PaintState {
  readonly paint: Paint;
  readonly marks: number;
}
const paintState = async (page: Page): Promise<PaintState> => ({
  paint: await paintOf(page),
  marks: await marks(page),
});
const sameAnchors = (a: Paint, b: Paint) =>
  JSON.stringify(Object.entries(a.byAnchor).sort()) ===
  JSON.stringify(Object.entries(b.byAnchor).sort());
/** Whether `after` holds the same ranges per file and the same marks as `before`, none stale. */
const intact = (before: PaintState, after: PaintState) =>
  sameAnchors(before.paint, after.paint) && after.paint.stale === 0 && before.marks === after.marks;
const paintDetail = (s: PaintState) =>
  `(ranges ${rangeCount(s.paint)}${s.paint.perRange ? `, stale ${s.paint.stale}` : " in total"}, marks ${s.marks})`;

/**
 * What the page shows that Structural must leave alone: each diff table's markup without the
 * painter's attributes, the sidebar's text, the file order, each file header's controls, and the
 * accessibility tree of the first table. Ids GitHub and React generate per load are masked.
 */
async function signature(page: Page): Promise<string> {
  const dom = await page.evaluate((attrs) => {
    const references =
      /^(id|for|aria-labelledby|aria-describedby|aria-controls|popovertarget|anchor|data-hovercard-url)$/;
    const value = (name: string, raw: string) =>
      references.test(name)
        ? "…"
        : raw
            // GitHub adds an overlay's anchor-name only once the pointer has been near its button.
            .replace(/anchor-name:[^;]*;?\s*/g, "")
            .replace(/_r_\w+?_|:r\w+?:|«r\w+?»/g, "…")
            .trim();
    // Attributes sorted, since GitHub's render order differs between loads.
    const serialize = (node: Node): string => {
      if (!(node instanceof Element))
        return node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "") : "";
      const attributes = [...node.attributes]
        .filter((a) => !(attrs as readonly string[]).includes(a.name))
        .map((a) => [a.name, value(a.name, a.value)])
        .filter(([name, v]) => !(name === "style" && v === ""))
        .sort(([a = ""], [b = ""]) => a.localeCompare(b))
        .map(([name, v]) => `${name}="${v}"`)
        .join(" ");
      return `<${node.localName} ${attributes}>${[...node.childNodes].map(serialize).join("")}</${node.localName}>`;
    };
    const tables = [...document.querySelectorAll("table[data-diff-anchor]")].map(serialize);
    const sidebar =
      document.querySelector("#pr-file-tree, #diff_file_tree")?.parentElement?.textContent ?? "";
    const headers = [...document.querySelectorAll('[role="region"]')].map((region) =>
      [...(region.firstElementChild?.querySelectorAll("button, a") ?? [])]
        .map((c) => c.getAttribute("aria-label") ?? c.textContent?.trim())
        .join("|"),
    );
    return { tables, sidebar, headers };
  }, STRUCTURAL_ATTRS);
  const anchors = await page
    .locator("table[data-diff-anchor]")
    .evaluateAll((ts) => ts.map((t) => t.getAttribute("data-diff-anchor")));
  const aria = await page.locator("table[data-diff-anchor]").first().ariaSnapshot();
  return JSON.stringify({ ...dom, anchors, aria });
}

/** Where two signatures first differ, for a failure line. */
function firstDifference(a: string, b: string): string {
  let at = 0;
  while (at < a.length && a[at] === b[at]) at++;
  return `at ${at}: ${JSON.stringify(a.slice(Math.max(0, at - 60), at + 60))} vs ${JSON.stringify(b.slice(Math.max(0, at - 60), at + 60))}`;
}

/** The diffs' toolbar children's sizes, without the diff view control. */
const toolbarSizes = (page: Page) =>
  page.evaluate(() => {
    const toolbar = document.querySelector(
      'section[class*="toolbar__"]:has([class*="RegularTreeToggle"]), #diff-content-parent > * > :has([aria-controls="diff_file_tree"])',
    );
    return [...(toolbar?.querySelectorAll("button, [role='button'], h2, input") ?? [])]
      .filter((child) => !child.closest(".gh-prism-diff-view"))
      .map((child) => {
        const box = child.getBoundingClientRect();
        return `${child.getAttribute("aria-label") ?? child.textContent?.trim().slice(0, 20)}:${Math.round(box.width)}x${Math.round(box.height)}`;
      });
  });

/** A cell of `kind` in `anchor`'s painted table, by its line anchor: painted, quiet, or context. */
async function cellOf(
  page: Page,
  anchor: string,
  kind: "painted" | "quiet" | "context",
  side: "L" | "R",
): Promise<Locator | undefined> {
  const sideCell = `td.diff-text-cell${sideOf(side)}`;
  const lineAnchor = await page.evaluate(
    ({ anchor, kind, sideCell, quiet, moved }) => {
      const cells = document.querySelectorAll<HTMLElement>(
        `table[data-diff-anchor="${anchor}"] ${sideCell}[data-line-anchor]`,
      );
      const found = [...cells].find((td) => {
        const changed = td.querySelector("code.addition, code.deletion");
        const row = td.closest("tr");
        const isQuiet = row?.matches(`[${quiet}], :has([${quiet}])`) ?? false;
        const isMoved = row?.matches(`[${moved}], :has([${moved}])`) ?? false;
        if (kind === "context") return !changed && td.textContent?.trim();
        if (kind === "quiet") return changed && isQuiet && td.textContent?.trim();
        return changed && !isQuiet && !isMoved && td.textContent?.trim();
      });
      return found?.dataset.lineAnchor;
    },
    { anchor, kind, sideCell, quiet: QUIET_ATTR, moved: MOVED_ATTR },
  );
  return lineAnchor ? page.locator(`${sideCell}[data-line-anchor="${lineAnchor}"]`) : undefined;
}

/** A side's code cells: a pull request names the side, a commit only classes it. */
const sideOf = (side: "L" | "R") =>
  side === "L"
    ? ':is([data-diff-side="left"], .left-side-diff-cell)'
    : ':is([data-diff-side="right"], .right-side-diff-cell)';

/** Turns the stored preference off and puts the account's Layout back after `body`. */
async function withPageRestored(page: Page, body: () => Promise<void>): Promise<void> {
  await ask(page, { op: "set", on: false });
  await open(page, `${SANDBOX}/pull/4/changes`);
  const layout = gearLayout(page);
  await withLayoutRestored(layout, async (found) => {
    log(`layout found: ${found}`);
    await body();
  });
  await ask(page, { op: "set", on: false });
}

/** Each page's signature and toolbar sizes under the `trunk` build. */
async function trunkSignatures(
  trunk: string,
): Promise<Map<string, { sig: string; sizes: string[] }>> {
  const profile = mkdtempSync(join(tmpdir(), "gh-prism-parity-trunk-"));
  const context = await launch(browserName, trunk, profile, statePath);
  const seen = new Map<string, { sig: string; sizes: string[] }>();
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    for (const url of [PR3, C1]) {
      await open(page, url);
      seen.set(url, { sig: await signature(page), sizes: await toolbarSizes(page) });
    }
  } finally {
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
  return seen;
}

/** Both storage areas, without trunk's `intent.*` caches, which every visit rewrites. */
async function storageWithoutIntent(page: Page): Promise<string> {
  const areas = await ask<Record<string, Record<string, unknown>>>(page, { op: "storage" });
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(areas).map(([area, items]) => [
        area,
        Object.fromEntries(Object.entries(items).filter(([key]) => !key.startsWith("intent."))),
      ]),
    ),
  );
}

/** 0a: this checkout with the mode off against a build of trunk, on PR3 and C1. */
async function modeOffIsTrunk(page: Page, trunk: string | undefined): Promise<void> {
  if (!trunk) return notDriven("0a", "mode off is trunk", "no --trunk build given");
  const trunkByUrl = await trunkSignatures(trunk);
  await ask(page, { op: "set", on: false });
  const storageBefore = await storageWithoutIntent(page);
  for (const url of [PR3, C1]) {
    await run("0a", `mode off is trunk ${url}`, async () => {
      await open(page, url);
      const sig = await signature(page);
      const sizes = await toolbarSizes(page);
      const onTrunk = trunkByUrl.get(url);
      const traces = await structuralTraces(page);
      const paint = await paintOf(page);
      const offscreen = browserName === "chromium" ? await offscreenDocuments(page.context()) : 0;
      const sameSizes = JSON.stringify(sizes) === JSON.stringify(onTrunk?.sizes);
      record(
        "0a",
        `mode off is trunk ${url}`,
        sig === onTrunk?.sig &&
          sameSizes &&
          traces.attributes + traces.notices + traces.sheets === 0 &&
          rangeCount(paint) === 0 &&
          offscreen === 0,
        sig === onTrunk?.sig
          ? JSON.stringify({ sameSizes, sizes, trunk: onTrunk?.sizes, ...traces, offscreen })
          : `signature ${firstDifference(onTrunk?.sig ?? "", sig)}`,
      );
    });
  }
  const storageAfter = await storageWithoutIntent(page);
  record(
    "0a",
    "storage unchanged across the visit",
    storageAfter === storageBefore,
    storageAfter === storageBefore ? "" : firstDifference(storageBefore, storageAfter),
  );
}

async function betaTag(page: Page): Promise<void> {
  for (const url of [PR4, C1]) {
    await run("0b", `Beta tag ${url}`, async () => {
      await open(page, url);
      const segment = page.getByRole("button", { name: "Structural Beta", exact: true });
      const tag = segment.locator(".gh-prism-diff-view-tag");
      record(
        "0b",
        `Beta tag ${url}`,
        (await segment.count()) === 1 &&
          (await segment.isVisible()) &&
          (await tag.isVisible()) &&
          (await tag.innerText()).trim() === "Beta",
        `(${await segment.count()} segment)`,
      );
    });
  }
}

/** 0c, 14, and 17's signature half: Split against Structural, at the top of each page. */
async function splitAgainstStructural(page: Page): Promise<void> {
  for (const url of [PR3, PR4, C1, C2, OWN]) {
    await run("0c", `signature ${url}`, async () => {
      await open(page, url);
      const split = await signature(page);
      await press(page, "Structural");
      await wait(page, 2500);
      const structural = await signature(page);
      const paint = await paintOf(page);
      record(
        "0c",
        `signature ${url}`,
        split === structural,
        split === structural
          ? `(${rangeCount(paint)} ranges painted)`
          : firstDifference(split, structural),
      );
      await press(page, "Split");
    });
  }
}

/**
 * 1 and 19: line comment forms on `anchor`'s rows of a Structural page, each cancelled. Returns the
 * paint the forms started from, or `undefined` when nothing was painted.
 */
async function lineComments(
  page: Page,
  url: string,
  id: string,
  anchor: string,
): Promise<PaintState | undefined> {
  await open(page, url);
  await press(page, "Structural");
  await page.locator(`table[data-diff-anchor="${anchor}"]`).scrollIntoViewIfNeeded();
  await wait(page);
  const base = await paintState(page);
  if (rangeCount(base.paint) === 0) {
    record(id, "painted before the forms", false, paintDetail(base));
    return undefined;
  }

  for (const kind of ["painted", "quiet", "context"] as const) {
    for (const side of ["L", "R"] as const) {
      const name = `comment on a ${kind} row, ${side} side`;
      const cell = await cellOf(page, anchor, kind, side);
      if (!cell) {
        notDriven(id, name, `no ${kind} ${side} cell in the file`);
        continue;
      }
      await run(id, name, async () => {
        const cellBox = await cell.boundingBox();
        let formTop = Number.NaN;
        await commentOn(page, name, cell, {
          report: reportFor(id),
          stale: async (p) => {
            formTop =
              (await p.getByPlaceholder("Leave a comment").first().boundingBox())?.y ?? Number.NaN;
            const now = await paintState(p);
            return now.paint.stale + (intact(base, now) ? 0 : 1);
          },
        });
        const below = formTop - (cellBox?.y ?? 0);
        record(
          id,
          `${name} opens on the pressed line`,
          below > 0 && below < 400,
          `(form ${Math.round(below)}px below the cell)`,
        );
      });
    }
  }
  return base;
}

/** 2, 3, 4: a pull request's multi-line, suggestion, and file-level forms, each cancelled. */
async function pullRequestForms(page: Page, anchor: string, base: PaintState): Promise<void> {
  const painted = await cellOf(page, anchor, "painted", "R");
  const quiet =
    (await cellOf(page, anchor, "quiet", "R")) ?? (await cellOf(page, anchor, "context", "R"));
  if (!painted || !quiet) notDriven("2", "multi-line comment", "no painted and quiet pair");
  else
    await run("2", "multi-line comment", async () => {
      const selected = await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement("i"));
        probe.style.backgroundColor = "var(--bgColor-attention-muted)";
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      await multiLine(
        page,
        { painted, quiet, selected },
        { report: reportFor("2"), name: "multi-line selection", gesture: "shift-click" },
      );
      await numberOf(quiet).click();
      await page.keyboard.down("Shift");
      await numberOf(painted).click();
      await page.keyboard.up("Shift");
      await painted.hover();
      await page.locator(ADD_COMMENT).first().click();
      const form = page.getByPlaceholder("Leave a comment").first();
      await form.fill("parity");
      const label = await page.evaluate(() => {
        const box = document.querySelector('textarea[placeholder="Leave a comment"]');
        let node: Element | null | undefined = box;
        for (let up = 0; up < 14 && node; up++) node = node.parentElement;
        const text = (node?.textContent ?? "").replace(/\s+/g, " ");
        return /lines? [LR+-]?\d+[^.]{0,30}/.exec(text)?.[0] ?? text.slice(0, 200);
      });
      const now = await paintState(page);
      const lines = [quiet, painted].map(async (c) =>
        (await c.getAttribute("data-line-anchor"))?.replace(/^diff-[0-9a-f]+[LR]/, ""),
      );
      const [from, to] = await Promise.all(lines);
      record(
        "2",
        "multi-line comment names both lines",
        Boolean(from && to && label.includes(from) && label.includes(to)) && intact(base, now),
        `(${from} to ${to}; form says ${JSON.stringify(label.slice(0, 120))}; ${paintDetail(now)})`,
      );
      await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
      await wait(page, 800);
    });

  await run("3", "suggested change", async () => {
    const cell = await cellOf(page, anchor, "painted", "R");
    if (!cell) return notDriven("3", "suggested change", "no painted R cell");
    const text = (await cell.locator(".diff-text-inner").innerText()).trim();
    // GitHub offers a suggestion from the hovered line's More actions menu.
    // Check 2 leaves a range selected; one click on the number selects this line alone.
    await numberOf(cell).click();
    await cell.hover();
    await page.locator('table button[aria-label="More actions"]:visible').first().click();
    await page.getByText(/^Suggest change on line/).click();
    await wait(page, 800);
    const value = await page.getByPlaceholder("Leave a comment").first().inputValue();
    const now = await paintState(page);
    record(
      "3",
      "suggested change",
      value.includes("```suggestion") && value.includes(text) && intact(base, now),
      `(${JSON.stringify(value.slice(0, 80))}; ${paintDetail(now)})`,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await wait(page, 800);
  });
  notDriven("3", "batched suggestions", "needs submitted suggestions");

  await run("4", "file-level comment", async () => {
    const region = page.locator(`[role="region"][id="${anchor}"]`);
    // The header's comment toggle: the one control there with aria-expanded and no popup.
    await region
      .locator("[data-diff-header-wrapper] button[aria-expanded]:not([aria-haspopup])")
      .first()
      .click();
    const box = page.getByPlaceholder(/comment/i).first();
    await box.waitFor({ timeout: 5000 });
    const now = await paintState(page);
    record(
      "4",
      "file-level comment",
      (await box.isVisible()) && intact(base, now),
      paintDetail(now),
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await wait(page, 800);
  });
}

/** The ids of sandbox pull request `pull`'s pending reviews, as `gh`'s account sees them. */
const pendingReviewIds = (pull: number): string[] =>
  execFileSync(
    "gh",
    [
      "api",
      `repos/macintacos/gh-prism-sandbox/pulls/${pull}/reviews`,
      "--jq",
      '.[]|select(.state=="PENDING")|.id',
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

/** Deletes the pending reviews on `pull` not in `before`; returns the ids it deleted. */
function discardNewPendingReviews(pull: number, before: ReadonlySet<string>): string[] {
  const added = pendingReviewIds(pull).filter((id) => !before.has(id));
  for (const id of added)
    execFileSync(
      "gh",
      ["api", "-X", "DELETE", `repos/macintacos/gh-prism-sandbox/pulls/${pull}/reviews/${id}`],
      { stdio: "ignore" },
    );
  return added;
}

/** 5: a pending review on PR4, discarded. */
async function reviews(page: Page): Promise<void> {
  await run("5", "pending review", async () => {
    await open(page, PR4);
    await press(page, "Structural");
    await wait(page);
    const base = await paintState(page);
    const cell = await cellOf(page, PR4_LEDGER, "painted", "R");
    if (!cell) return notDriven("5", "pending review", "no painted R cell");
    const before = new Set(pendingReviewIds(4));
    let started = false;
    try {
      await cell.hover();
      await page.locator(ADD_COMMENT).first().click();
      await page.getByPlaceholder("Leave a comment").first().fill("parity check, discarded");
      await page.getByRole("button", { name: "Start a review" }).first().click();
      started = true;
      await wait(page, 3000);
      const pending = await page.getByText("Pending", { exact: true }).count();
      const now = await paintState(page);
      record(
        "5",
        "pending review",
        pending > 0 && intact(base, now),
        `(${pending} pending badge; ${paintDetail(now)})`,
      );
    } finally {
      // The page's Submit review dialog offers no discard, so the API discards it.
      const found = discardNewPendingReviews(4, before);
      const left = discardNewPendingReviews(4, before);
      record(
        "5",
        "review discarded",
        left.length === 0 && (!started || found.length >= 1),
        `(${found.length} new pending found, ${left.length} left, ${before.size} from before the run left alone)`,
      );
    }
  });
  notDriven("5", "discard from the page", "the Submit review dialog offers no discard");
  notDriven(
    "5",
    "submit as Comment, Approve, Request changes",
    "a submitted review cannot be removed",
  );
}

/** The ids of sandbox PR #3's resolved review threads. */
const resolvedPr3Threads = (): string[] =>
  execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      'query={repository(owner:"macintacos",name:"gh-prism-sandbox"){pullRequest(number:3){reviewThreads(first:50){nodes{id isResolved}}}}}',
      "--jq",
      ".data.repository.pullRequest.reviewThreads.nodes[]|select(.isResolved)|.id",
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

/** Unresolves sandbox PR #3's resolved threads not in `before`; returns how many. */
function unresolveNewPr3Threads(before: ReadonlySet<string>): number {
  const added = resolvedPr3Threads().filter((id) => !before.has(id));
  for (const id of added)
    execFileSync(
      "gh",
      [
        "api",
        "graphql",
        "-f",
        `query=mutation{unresolveReviewThread(input:{threadId:"${id}"}){thread{isResolved}}}`,
      ],
      { stdio: "ignore" },
    );
  return added.length;
}

/**
 * 6: PR3's review thread: reply cancelled, resolved, unresolved. PR3 holds no language Structural
 * paints, so these check the forms work and no paint appears, not that paint survives.
 */
async function threads(page: Page): Promise<void> {
  await run("6", "thread reply", async () => {
    await open(page, PR3);
    await press(page, "Structural");
    // GitHub hides this button from the accessibility tree, so a role query can't find it.
    const reply = page.locator("button:visible", { hasText: "Write a reply" }).first();
    await reply.scrollIntoViewIfNeeded();
    await wait(page);
    const unpainted = (s: PaintState) => rangeCount(s.paint) === 0 && s.marks === 0;
    await reply.click();
    const box = page.getByPlaceholder("Leave a comment").first();
    await box.fill("parity");
    const opened = await box.isVisible();
    const typing = await paintState(page);
    await box.fill("");
    await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
    await wait(page, 800);
    const cancelled = !(await box.isVisible());
    record(
      "6",
      "thread reply",
      opened && cancelled && unpainted(typing),
      `(opened ${opened}, cancelled ${cancelled}; page paints nothing: ${paintDetail(typing)})`,
    );

    const before = new Set(resolvedPr3Threads());
    try {
      await page.locator('[data-testid="unified-comment-resolve-button"]').first().click();
      await wait(page);
      const resolvedNow = resolvedPr3Threads().filter((id) => !before.has(id)).length;
      const after = await paintState(page);
      record(
        "6",
        "thread resolve",
        resolvedNow === 1 && unpainted(after),
        `(${resolvedNow} newly resolved; page paints nothing: ${paintDetail(after)})`,
      );
      notDriven(
        "6",
        "unresolve from the page",
        "a resolved thread leaves the diff with no Unresolve control; the API reopens it",
      );
    } finally {
      const reopened = unresolveNewPr3Threads(before);
      const restored =
        JSON.stringify(resolvedPr3Threads().sort()) === JSON.stringify([...before].sort());
      record(
        "6",
        "thread ends unresolved",
        restored,
        `(${reopened} reopened through the API, ${before.size} resolved before the run left alone)`,
      );
    }
  });
  notDriven("6", "minimize comments and Copilot actions", "they change or cost account state");
  notDriven("7", "outdated threads", "no outdated thread on any sandbox pull request");
}

/** 8: Viewed through GitHub's toggle, then gh-prism's sidebar box, each put back. */
async function viewed(page: Page): Promise<void> {
  await open(page, PR4);
  await press(page, "Structural");
  await wait(page);
  const start = await paintOf(page);
  const first = rangeCount(start);
  const fileRanges = async () => rangesOf(await paintOf(page), PR4_LEDGER);
  const initial = await fileRanges();
  // With only the total known, the file's ranges going shows as the total dropping.
  const gone = (collapsed: number) => (start.perRange ? collapsed === 0 : collapsed < initial);
  const toggle = page.locator(`[id="${PR4_LEDGER}"] button[aria-label$="Viewed"]`);
  const box = page.getByRole("checkbox", { name: "Viewed: ledger.py" });
  for (const [how, mark] of [
    ["GitHub's toggle", () => toggle.click()],
    ["gh-prism's sidebar box", () => box.click()],
  ] as const) {
    await run("8", `Viewed through ${how}`, async () => {
      let marked = false;
      try {
        await mark();
        marked = true;
        await wait(page);
        const collapsed = await fileRanges();
        const hidden = !(await page.locator(`table[data-diff-anchor="${PR4_LEDGER}"]`).isVisible());
        await mark();
        marked = false;
        await wait(page, 3500);
        const again = await fileRanges();
        record(
          "8",
          `Viewed through ${how}`,
          hidden && gone(collapsed) && again === initial && initial > 0,
          `(ranges ${initial} → ${collapsed} → ${again}, collapsed ${hidden}, page ${first})`,
        );
      } finally {
        if (marked) await mark();
      }
    });
  }
  notDriven("8", "unmark on change", "needs a push");
}

/** 9: each expander kind PR4's files offer. */
async function expandContext(page: Page): Promise<void> {
  await open(page, PR4);
  await press(page, "Structural");
  await wait(page);
  // The line expanders are aria-hidden, so they are found by their attributes; a gap between two
  // hunks gets one button that expands both ways.
  for (const [kind, selector] of [
    ["down", 'button[data-direction="down"]:not([class*="expand-up-and-down"])'],
    ["up", 'button[data-direction="up"]:not([class*="expand-up-and-down"])'],
    ["between", 'button[class*="expand-up-and-down"]'],
    ["all", 'button[aria-label^="Expand all lines"]'],
  ] as const) {
    const button = page.locator(`[role="region"] ${selector}`).first();
    if (!(await button.count())) {
      notDriven("9", `expand ${kind}`, "the file offers no such expander");
      continue;
    }
    await run("9", `expand ${kind}`, async () => {
      const base = await paintState(page);
      await button.click();
      await wait(page);
      const now = await paintState(page);
      const markedContext = await page.evaluate(
        (m) =>
          [...document.querySelectorAll(m)].filter(
            (n) => n.matches("tr") && !n.querySelector("code.addition, code.deletion"),
          ).length,
        MARKED,
      );
      record(
        "9",
        `expand ${kind}`,
        sameAnchors(base.paint, now.paint) &&
          now.paint.stale === 0 &&
          now.paint.outsideChanged === 0 &&
          markedContext === 0,
        `(${paintDetail(base)} → ${paintDetail(now)}, ranges outside changed ${now.paint.perRange ? now.paint.outsideChanged : "unread"}, marked context rows ${markedContext})`,
      );
    });
  }
}

/** 11: line links land in view, with the selected background mode off saw. */
async function lineLinks(page: Page): Promise<void> {
  const selectedBackground = async (p: Page) =>
    p.evaluate(() => {
      const td = document.querySelector('td[data-selected="true"]');
      return td ? getComputedStyle(td).backgroundColor : undefined;
    });
  const landed = async (url: string, on: boolean) => {
    await ask(page, { op: "set", on });
    const tab = await page.context().newPage();
    try {
      const hash = new URL(url).hash.slice(1);
      await tab.goto(url);
      const row = tab.locator(`td[data-line-anchor="${hash}"]`).first();
      await row.waitFor({ timeout: 30_000 });
      await wait(tab, 4000);
      return {
        inView: await row.evaluate((td) => {
          const box = td.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight;
        }),
        background: await selectedBackground(tab),
      };
    } finally {
      await tab.close();
    }
  };
  for (const side of ["R", "L"] as const) {
    await run("11", `line link ${side}`, async () => {
      await open(page, PR4);
      const cell = await page.evaluate(
        ({ anchor, side }) =>
          [
            ...document.querySelectorAll<HTMLElement>(
              `table[data-diff-anchor="${anchor}"] td.diff-text-cell`,
            ),
          ]
            .map((td) => td.dataset.lineAnchor ?? "")
            .find(
              (a) =>
                new RegExp(`${side}\\d+$`).test(a) &&
                document.querySelector(
                  `td[data-line-anchor="${a}"] code.addition, td[data-line-anchor="${a}"] code.deletion`,
                ),
            ),
        { anchor: PR4_LEDGER, side },
      );
      if (!cell) return notDriven("11", `line link ${side}`, "no changed line on that side");
      const url = `${SANDBOX}/pull/4/changes?diff=split#${cell}`;
      const off = await landed(url, false);
      const on = await landed(url, true);
      const sameBackground = off.background === on.background;
      record(
        "11",
        `line link ${side}`,
        on.inView && off.inView && sameBackground,
        JSON.stringify({ off, on }),
      );
      if (!off.background)
        log(`11 line link ${side}: no cell selected on load with the mode off either`);
    });
  }
  await run("11", "LINK ten times", async () => {
    let inView = 0;
    for (let n = 0; n < 10; n++) if ((await landed(LINK, true)).inView) inView++;
    record("11", "LINK ten times", inView === 10, `(${inView} of 10 in view)`);
  });
  await ask(page, { op: "set", on: false });
}

/** 12: Structural, Unified, Structural, Split, Structural on PR4 and C1. */
async function switchAway(page: Page): Promise<void> {
  for (const url of [PR4, C1]) {
    await run("12", `switch away and back ${url}`, async () => {
      await open(page, url);
      await press(page, "Structural");
      await wait(page);
      const first = rangeCount(await paintOf(page));
      const seen: string[] = [`structural ${first}`];
      let clean = true;
      for (const view of ["Unified", "Structural", "Split", "Structural"] as const) {
        await press(page, view);
        await wait(page);
        const count = rangeCount(await paintOf(page));
        const traces = await structuralTraces(page);
        seen.push(
          `${view.toLowerCase()} ${count}/${traces.attributes}/${traces.sheets}/${traces.notices}`,
        );
        if (view === "Structural") clean &&= count === first;
        else clean &&= count + traces.attributes + traces.sheets + traces.notices === 0;
      }
      record("12", `switch away and back ${url}`, clean && first > 0, `(${seen.join(", ")})`);
      await press(page, "Split");
    });
  }
}

/** 13: with whitespace hidden, every range sits in a cell GitHub marks changed. */
async function hideWhitespace(page: Page): Promise<void> {
  await run("13", "hide whitespace", async () => {
    await open(page, `${PR4}&w=1`);
    await press(page, "Structural");
    await wait(page);
    const paint = await paintOf(page);
    if (!paint.perRange)
      return notDriven("13", "hide whitespace", "this browser's probe reads only the range total");
    record(
      "13",
      "hide whitespace",
      rangeCount(paint) > 0 && paint.outsideChanged === 0,
      `(${rangeCount(paint)} ranges, ${paint.outsideChanged} outside changed cells)`,
    );
    await press(page, "Split");
  });
}

/** 15 and 16: copy, find, and grid keys read the same with the mode on as off. */
async function copyFindKeys(page: Page): Promise<void> {
  const read = async () => {
    const painted = await cellOf(page, PR4_LEDGER, "painted", "R");
    const other =
      (await cellOf(page, PR4_LEDGER, "quiet", "R")) ??
      (await cellOf(page, PR4_LEDGER, "context", "R"));
    if (!painted || !other) return undefined;
    const selection = await page.evaluate(
      ([a, b]) => {
        const from = document.querySelector(`td[data-line-anchor="${a}"]`);
        const to = document.querySelector(`td[data-line-anchor="${b}"]`);
        if (!from || !to) return "";
        const range = document.createRange();
        const [first, last] =
          from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING
            ? [from, to]
            : [to, from];
        range.setStartBefore(first);
        range.setEndAfter(last);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        const text = getSelection()?.toString() ?? "";
        getSelection()?.removeAllRanges();
        return text;
      },
      [
        await painted.getAttribute("data-line-anchor"),
        await other.getAttribute("data-line-anchor"),
      ],
    );
    const token = /[A-Za-z_]\w{3,}/.exec(await painted.innerText())?.[0] ?? "";
    const matches = await page.evaluate((token) => {
      const find = (
        window as unknown as { find(t: string, c: boolean, b: boolean, w: boolean): boolean }
      ).find;
      getSelection()?.removeAllRanges();
      let n = 0;
      while (n < 200 && find(token, true, false, false)) n++;
      getSelection()?.removeAllRanges();
      return n;
    }, token);
    return { selection, token, matches };
  };
  const readKeys = async () => {
    const painted = await cellOf(page, PR4_LEDGER, "painted", "R");
    if (!painted) return undefined;
    const keys: string[] = [];
    for (const key of ["ArrowDown", "ArrowRight"]) {
      await painted.evaluate((td) => {
        td.scrollIntoView({ block: "center" });
        (td as HTMLElement).focus();
      });
      await page.keyboard.press(key);
      keys.push(
        await page.evaluate(() => {
          const now = document.activeElement as HTMLElement | null;
          return now?.dataset.lineAnchor ?? `${now?.tagName}.${now?.className}`.slice(0, 60);
        }),
      );
    }
    return keys;
  };
  await run("15", "copy and find", async () => {
    await open(page, PR4);
    const off = await read();
    await press(page, "Structural");
    await wait(page);
    const on = await read();
    await press(page, "Split");
    if (!off || !on)
      return notDriven("15", "copy and find", "no painted and quiet pair on ledger.py");
    record(
      "15",
      "copy and find",
      off.selection === on.selection &&
        off.selection.length > 0 &&
        off.matches === on.matches &&
        off.matches > 0,
      `(selection ${off.selection.length}/${on.selection.length} chars, "${off.token}" ${off.matches}/${on.matches})`,
    );
  });
  await run("16", "grid keys", async () => {
    await open(page, PR4);
    const off = await readKeys();
    await press(page, "Structural");
    await wait(page);
    const on = await readKeys();
    await press(page, "Split");
    if (!off || !on) return notDriven("16", "grid keys", "no painted cell on ledger.py");
    record(
      "16",
      "grid keys",
      JSON.stringify(off) === JSON.stringify(on),
      JSON.stringify({ off, on }),
    );
  });
  notDriven("16", "screen reader reading", "needs a person with a screen reader");
}

/** A viewport line just below GitHub's sticky headers. */
const BELOW_STICKY_PX = 250;

/** The anchor of the file whose region spans the line below the sticky headers. */
const currentFile = (page: Page) =>
  page.evaluate((line) => {
    // Structural's notices add height, so scroll offsets differ by design and only the file is
    // compared.
    const regions = [...document.querySelectorAll<HTMLElement>('[role="region"][id^="diff-"]')];
    const at = regions.find((r) => {
      const box = r.getBoundingClientRect();
      return box.top <= line && box.bottom > line;
    });
    return at?.id.slice(0, 16) ?? "none";
  }, BELOW_STICKY_PX);

/**
 * Waits until the region of `anchor` stops moving, then names it if it sits in the viewport's top
 * half. A reveal can settle up to 150 px lower on a profile's first load of a page, in trunk as
 * well, so the file below the sticky headers is not a stable answer.
 */
async function revealed(page: Page, anchor: string): Promise<string> {
  const topOf = () =>
    page.evaluate((id) => document.getElementById(id)?.getBoundingClientRect().top ?? null, anchor);
  let last = await topOf();
  for (let tries = 0; tries < 40; tries++) {
    await page.waitForTimeout(300);
    const top = await topOf();
    if (top !== null && top === last) {
      const half = await page.evaluate(() => innerHeight / 2);
      return top >= 0 && top < half ? anchor.slice(0, 16) : `${anchor.slice(0, 16)} at ${top}px`;
    }
    last = top;
  }
  return `${anchor.slice(0, 16)} still moving`;
}

/** 17: j, k, and a sidebar reveal land on the same file with the mode on as off; OWN's shields. */
async function restOfPage(page: Page): Promise<void> {
  const walk = async () => {
    await page.evaluate(() => scrollTo(0, 0));
    await wait(page, 800);
    const landed: string[] = [];
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    for (const key of ["j", "j", "k"]) {
      await page.keyboard.press(key);
      await wait(page, 1200);
      landed.push(await currentFile(page));
    }
    await page.locator('[data-item-path="src/parser.rs"]').first().click();
    landed.push(await revealed(page, anchorOf("src/parser.rs")));
    return landed;
  };
  await run("17", "j, k, and reveal", async () => {
    await open(page, PR3);
    const off = await walk();
    // GitHub's j and k start from the file last revealed, so each walk starts on a fresh load.
    await open(page, PR3);
    await press(page, "Structural");
    const on = await walk();
    await press(page, "Split");
    record(
      "17",
      "j, k, and reveal",
      JSON.stringify(off) === JSON.stringify(on),
      JSON.stringify({ off, on }),
    );
  });
  await run("17", "OWN shields across switches", async () => {
    await open(page, OWN);
    const counts = [await shields(page)];
    for (const view of ["Split", "Structural", "Unified", "Split"] as const) {
      await press(page, view);
      counts.push(await shields(page));
    }
    record(
      "17",
      "OWN shields across switches",
      (counts[0] ?? 0) > 0 && counts.every((c) => c === counts[0]),
      `(${counts.join(", ")})`,
    );
  });
  notDriven("17", "github.dev and codespace keys", "they leave the page");
}

/** 18 and 21's PR3 half, and N: kinds GitHub draws without a table diff, and the notices. */
async function kindsAndNotices(page: Page): Promise<void> {
  await open(page, PR3);
  await press(page, "Structural");
  const unsupported = NOTICE_COPY.unsupported;
  await run("21", "PR3 notices", async () => {
    let wrong = 0;
    let mounted = 0;
    let mostInView = 0;
    const seen = new Set<string>();
    for (let step = 0; step < 40; step++) {
      const view = await page.evaluate(
        ({ notices }) =>
          [...document.querySelectorAll(notices)].map((n) => {
            const box = n.getBoundingClientRect();
            const table = n.nextElementSibling;
            return {
              text: n.textContent ?? "",
              before: table?.matches("table[data-diff-anchor]")
                ? table.getAttribute("data-diff-anchor")
                : null,
              inView: box.bottom > 0 && box.top < innerHeight,
            };
          }),
        { notices: NOTICE_SELECTOR },
      );
      for (const n of view) {
        if (n.text !== unsupported || !n.before) wrong++;
        if (n.before) seen.add(n.before);
      }
      mostInView = Math.max(mostInView, view.filter((n) => n.inView).length);
      mounted = Math.max(mounted, view.length);
      const y = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 700);
      await wait(page, 900);
      if ((await page.evaluate(() => scrollY)) === y) break;
    }
    record(
      "21",
      "PR3 notices",
      wrong === 0 && seen.size > 0,
      `(${seen.size} files noticed, ${wrong} wrong)`,
    );
    log(
      `N notice density: ${seen.size} notices over the page, ${mounted} mounted at once, at most ${mostInView} in one viewport`,
    );
  });

  await run("18", "rich diff", async () => {
    const region = page.locator(`[role="region"][id="${PR3_README}"]`);
    await region.scrollIntoViewIfNeeded();
    await region.getByRole("button", { name: "Display the rich diff" }).click();
    await wait(page);
    const inRich = await region.evaluate(
      (r, { notices, marked }) =>
        r.querySelectorAll(notices).length + r.querySelectorAll(marked).length,
      { notices: NOTICE_SELECTOR, marked: MARKED },
    );
    const ranges = rangesOf(await paintOf(page), PR3_README);
    record(
      "18",
      "rich diff",
      inRich + ranges === 0,
      `(${inRich} notices or marks, ${ranges} ranges)`,
    );
    await region.getByRole("button", { name: "Display the source diff" }).click();
    await wait(page);
    record(
      "18",
      "source diff notice again",
      (await noticeBefore(page, PR3_README)) === unsupported,
    );
  });

  await run("18", "renamed, added, deleted, binary", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    const kinds = await page.evaluate(
      ({ notices, marked }) =>
        [...document.querySelectorAll<HTMLElement>('[role="region"]')].map((region) => {
          const header = region.firstElementChild?.textContent ?? "";
          const table = region.querySelector("table[data-diff-anchor]");
          const kind = /→|renamed/i.test(header)
            ? "renamed"
            : /binary/i.test(region.textContent ?? "")
              ? "binary"
              : table && table.querySelector(":scope > colgroup")?.childElementCount !== 4
                ? "one-sided"
                : "modified";
          return {
            kind,
            id: region.id,
            notices: region.querySelectorAll(notices).length,
            marks: region.querySelectorAll(marked).length,
            table: Boolean(table),
          };
        }),
      { notices: NOTICE_SELECTOR, marked: MARKED },
    );
    const paint = await paintOf(page);
    const special = kinds.filter((k) => k.kind !== "modified");
    const bad = special.filter(
      (k) => k.marks + rangesOf(paint, k.id) > 0 || (k.kind !== "renamed" && k.notices > 0),
    );
    for (const kind of ["renamed", "one-sided", "binary"])
      if (!special.some((k) => k.kind === kind))
        notDriven("18", kind, "no such file mounted on PR3");
    record(
      "18",
      "renamed, added, deleted, binary",
      bad.length === 0,
      JSON.stringify(
        special.map((k) => `${k.kind}:${k.table ? "table" : "no table"}:${k.notices}n/${k.marks}m`),
      ),
    );
  });
  await press(page, "Split");
}

/**
 * Clicks `id`'s Load Diff button, re-finding it before each try: the virtualized list can unmount
 * the region between finding and clicking, so an unmounted region is scrolled back and retried.
 */
async function clickLoadDiff(page: Page, id: string): Promise<void> {
  const seen: string[] = [];
  const y = await page.evaluate(() => scrollY);
  for (let tries = 0; tries < 5; tries++) {
    await wait(page, 1500);
    const mounted = await page.evaluate((id) => {
      const button = [...(document.getElementById(id)?.querySelectorAll("button") ?? [])].find(
        (b) => b.textContent?.trim() === "Load Diff",
      );
      button?.scrollIntoView({ block: "center" });
      return Boolean(button);
    }, id);
    if (!mounted) {
      seen.push("unmounted");
      await page.evaluate((top) => scrollTo(0, top), y);
      continue;
    }
    try {
      await page
        .locator(`[role="region"][id="${id}"] button`, { hasText: "Load Diff" })
        .click({ timeout: 5000 });
      return;
    } catch (error) {
      seen.push((error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "");
    }
  }
  throw new Error(`Load Diff on ${id} never clicked: ${seen.join(" | ")}`);
}

/** 10, 21's BIG half, L, and M: nodejs/node#66212, read and scrolled only. */
async function bigPage(page: Page): Promise<void> {
  await run("L", "loading line", async () => {
    await open(page, BIG);
    let seenLoading = false;
    await segmentOf(page, "Structural").click();
    const until = Date.now() + 5000;
    while (Date.now() < until && !seenLoading) {
      seenLoading = (await page.locator(".gh-prism-structural-loading").count()) > 0;
      await page.waitForTimeout(50);
    }
    log(`L loading line: ${seenLoading ? "seen" : "not seen"}`);
  });

  await run("10", "load diff", async () => {
    // An added or removed file loads a one-sided table, which Structural leaves alone, so the
    // check presses on until a load mounts a split table.
    const skipped: string[] = [];
    for (let tries = 0; tries < 80 && skipped.length < 30; tries++) {
      // The diff list is virtualized and re-renders while it scrolls, so the button is found
      // and scrolled to in the page, then clicked inside its region.
      const id = await page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Load Diff",
        );
        button?.scrollIntoView({ block: "center" });
        return button?.closest('[role="region"]')?.id;
      });
      if (!id) {
        await page.mouse.wheel(0, 3000);
        await wait(page, 1000);
        continue;
      }
      await clickLoadDiff(page, id);
      const table = page.locator(`table[data-diff-anchor="${id}"]`);
      await table.waitFor({ timeout: 30_000 });
      await table.scrollIntoViewIfNeeded();
      await wait(page, 5000);
      const { split, painted } = await table.evaluate(
        (t, attr) => ({
          split: t.querySelector(":scope > colgroup")?.childElementCount === 4,
          painted: t.hasAttribute(attr),
        }),
        TABLE_ATTR,
      );
      const notice = id ? await noticeBefore(page, id) : null;
      if (!split) {
        skipped.push(`${id} one-sided, painted ${painted}, notice ${Boolean(notice)}`);
        continue;
      }
      const outcome = painted
        ? "painted"
        : notice === NOTICE_COPY.unsupported
          ? "unsupported notice"
          : notice === NOTICE_COPY["too-large"]
            ? "too-large notice"
            : undefined;
      return record(
        "10",
        "load diff",
        outcome !== undefined,
        `${outcome ?? ""} (${id}: notice ${JSON.stringify(notice)}; before it ${skipped.length} one-sided loads, none painted or noticed: ${skipped.every((s) => s.endsWith("painted false, notice false"))})`,
      );
    }
    notDriven("10", "load diff", `${skipped.length} loads mounted only one-sided tables`);
  });

  await run("21", "BIG too-large notice", async () => {
    const anchor = anchorOf(BIG_TOO_LARGE);
    const region = page.locator(`[role="region"][id="${anchor}"]`);
    // The sidebar's tree is virtualized on a page this size, and Firefox never mounts the file from
    // its hash, with no extension either, so the list is scrolled until its region mounts.
    await page.evaluate(() => scrollTo(0, 0));
    // The file sits about 360,000 px down, so the walk ends only where scrolling does.
    for (let y = -1; !(await region.count()); ) {
      const now = await page.evaluate(() => scrollY);
      if (now === y) break;
      y = now;
      await page.mouse.wheel(0, 1500);
      await wait(page, 400);
    }
    await region.waitFor({ state: "attached", timeout: 10_000 });
    await region.evaluate((r) => r.scrollIntoView({ block: "start" }));
    await wait(page, 1500);
    const load = region.getByRole("button", { name: "Load Diff" });
    if (await load.count()) await load.first().click();
    const table = page.locator(`table[data-diff-anchor="${anchor}"]`);
    await table.waitFor({ timeout: 30_000 });
    await table.scrollIntoViewIfNeeded();
    await wait(page, 6000);
    const notice = await noticeBefore(page, anchor);
    record(
      "21",
      "BIG too-large notice",
      notice === NOTICE_COPY["too-large"],
      `(${JSON.stringify(notice)})`,
    );
  });

  await run("M", "mismatch on BIG", async () => {
    await page.evaluate(() => scrollTo(0, 0));
    let mismatched = new Set<string>();
    const seen = new Set<string>();
    for (let step = 0; step < 400; step++) {
      const now = await page.evaluate(
        ({ attr, notices, copy }) => ({
          painted: [...document.querySelectorAll(`table[${attr}]`)].map(
            (t) => t.getAttribute("data-diff-anchor") ?? "",
          ),
          mismatched: [...document.querySelectorAll(notices)]
            .filter((n) => n.textContent === copy)
            .map((n) => n.nextElementSibling?.getAttribute("data-diff-anchor") ?? ""),
        }),
        { attr: TABLE_ATTR, notices: NOTICE_SELECTOR, copy: NOTICE_COPY.mismatch },
      );
      for (const a of now.painted) seen.add(a);
      mismatched = new Set([...mismatched, ...now.mismatched]);
      for (const a of now.mismatched) seen.add(a);
      const y = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 1500);
      await wait(page, 600);
      if ((await page.evaluate(() => scrollY)) === y) break;
    }
    log(`M mismatch: ${mismatched.size} of ${seen.size}`);
  });
  await press(page, "Split");
}

/** F: a focused moved line keeps GitHub's focus ring and its dashed outline. */
async function movedFocus(page: Page): Promise<void> {
  for (const url of [PR4, C1, C2]) {
    await open(page, url);
    await press(page, "Structural");
    for (let step = 0; step < 6; step++) {
      if (await page.locator(`[${MOVED_ATTR}]`).count()) break;
      await page.mouse.wheel(0, 700);
      await wait(page, 1200);
    }
    const found = await page.evaluate(
      ({ moved }) => {
        const movedCell = document.querySelector<HTMLElement>(
          `[${moved}] td.diff-text-cell, td.diff-text-cell[${moved}]`,
        );
        const plain = [...document.querySelectorAll<HTMLElement>("td.diff-text-cell")].find(
          (td) => !td.closest(`[${moved}]`) && td.querySelector("code.addition, code.deletion"),
        );
        if (!movedCell || !plain) return undefined;
        const ring = (td: HTMLElement) => {
          td.focus();
          const before = getComputedStyle(td, "::before");
          return {
            border: `${before.borderTopStyle} ${before.borderTopWidth} ${before.borderTopColor}`,
            outline: getComputedStyle(td).outlineStyle,
          };
        };
        return { moved: ring(movedCell), plain: ring(plain) };
      },
      { moved: MOVED_ATTR },
    );
    await press(page, "Split");
    if (!found) continue;
    return record(
      "F",
      `moved line focus ${url}`,
      found.moved.border === found.plain.border && found.moved.outline === "dashed",
      JSON.stringify(found),
    );
  }
  notDriven("F", "moved line focus", "no page marks a moved line");
}

/** R: from Unified, Structural then sidebar reveals never reload the page. */
async function noReloadOnReveal(page: Page): Promise<void> {
  await run("R", "reveal without reload", async () => {
    await open(page, PR3);
    await press(page, "Unified");
    await press(page, "Structural");
    // A reload drops the marker; the sidebar's hash changes are navigations too, so they're not counted.
    await page.evaluate(() => Object.assign(window, { parityMarker: true }));
    const paths = await page
      .locator("[data-item-path]")
      .evaluateAll((rows) =>
        rows.map((r) => r.getAttribute("data-item-path") ?? "").filter((p) => /\.\w+$/.test(p)),
      );
    let revealed = 0;
    const tries = Array.from({ length: 10 }, (_, n) => paths[n % paths.length] ?? "");
    for (const path of tries) {
      await page.locator(`[data-item-path="${path}"]`).first().click();
      await wait(page, 1500);
      const inView = await page.evaluate((anchor) => {
        const region = document.getElementById(anchor);
        const box = region?.getBoundingClientRect();
        return Boolean(box && box.top < innerHeight && box.bottom > 0);
      }, anchorOf(path));
      if (inView) revealed++;
    }
    const marker = await page.evaluate(() => "parityMarker" in window);
    record(
      "R",
      "reveal without reload",
      marker && revealed === tries.length,
      `(${revealed} of ${tries.length} revealed, marker ${marker})`,
    );
    await press(page, "Split");
  });
}

const copy = mkdtempSync(join(tmpdir(), "gh-prism-parity-copy-"));
const profile = mkdtempSync(join(tmpdir(), "gh-prism-parity-profile-"));
let context: BrowserContext | undefined;
try {
  scratchCopy(copy, { "entrypoints/bench-probe.content.ts": PROBE });
  const build = buildCopy(copy, browserName);
  context = await launch(browserName, build, profile, statePath);
  const page = context.pages()[0] ?? (await context.newPage());
  // A form with text asks before discarding it; accepting discards, it never submits.
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto(`${SANDBOX}/pull/4`);
  const pageLogin = await page.locator('meta[name="user-login"]').getAttribute("content");
  if (!pageLogin) throw new Error("the storage state does not sign GitHub in");
  // The cleanup acts through `gh`, so it must see the reviews and threads the page makes.
  const ghLogin = execFileSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
  }).trim();
  if (ghLogin !== pageLogin)
    throw new Error(`gh is signed in as ${ghLogin}, the storage state as ${pageLogin}`);
  log(
    `browser: ${browserName} ${context.browser()?.version() ?? (await page.evaluate(() => navigator.userAgent))}`,
  );

  await modeOffIsTrunk(page, values.trunk);
  log("20 mode off: as 0a, with pass 1 of bench/structural-mode-live.ts");
  await withPageRestored(page, async () => {
    await betaTag(page);
    await splitAgainstStructural(page);
    log("14 syntax highlighting: as 0c");
    const pr4 = await lineComments(page, PR4, "1", PR4_LEDGER);
    if (pr4) await pullRequestForms(page, PR4_LEDGER, pr4);
    await lineComments(page, C1, "19", anchorOf("src/client/types.gen.ts"));
    await reviews(page);
    await threads(page);
    await viewed(page);
    await expandContext(page);
    await lineLinks(page);
    await switchAway(page);
    await hideWhitespace(page);
    await copyFindKeys(page);
    await restOfPage(page);
    await kindsAndNotices(page);
    await movedFocus(page);
    await noReloadOnReveal(page);
    await bigPage(page);
  });
} catch (error) {
  record("run", "harness", false, error instanceof Error ? error.message : String(error));
} finally {
  await context?.close();
  rmSync(copy, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
log(`parity: ${tally.ok} ok, ${tally.failed} failed, ${tally.notDriven} not driven`);
if (tally.failed) process.exitCode = 1;
