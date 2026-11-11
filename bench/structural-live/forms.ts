/**
 * GitHub comment-form drivers that `bench/structural-live.ts` and `bench/structural-parity-live.ts`
 * share. Every form they open they cancel; none submits.
 */

import type { Locator, Page } from "@playwright/test";

/** How a bench records a check: `check` throws on failure, `notDriven` leaves it to a reviewer. */
export interface Report {
  check(name: string, ok: boolean, detail?: string): void;
  notDriven(name: string, why: string): void;
}

/** The button a hovered line shows to open a comment: a pull request's, then a commit's. */
export const ADD_COMMENT = 'button[data-add-comment-button], button[aria-label="Add comment"]';

/** Counts highlight ranges left on nodes no longer in the page. */
export type StaleRanges = (page: Page) => Promise<number>;

/** A code cell's number cell, the one before it in its row. */
export const numberOf = (cell: Locator) => cell.locator("xpath=preceding-sibling::td[1]");

export const selectedRows = (page: Page) =>
  page.evaluate(
    () =>
      new Set(
        [...document.querySelectorAll('td[data-selected="true"]')].map((td) => td.parentElement),
      ).size,
  );

/** Lets `observeDiffs`' 50 ms debounce and the painter's frame run. */
export const settle = (page: Page) => page.waitForTimeout(400);

export const background = (cell: Locator) =>
  cell.evaluate((td) => getComputedStyle(td).backgroundColor);

/** Opens the comment form on `cell`'s row, types, checks the painting survived, and cancels. */
export async function commentOn(
  page: Page,
  name: string,
  cell: Locator,
  { report, stale }: { report: Report; stale: StaleRanges },
): Promise<void> {
  await cell.hover();
  await page.locator(ADD_COMMENT).first().click();
  const box = page.getByPlaceholder("Leave a comment").first();
  await box.fill("parity");
  await settle(page);
  const left = await stale(page);
  report.check(name, (await box.isVisible()) && left === 0, `(form open, stale ${left})`);
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await settle(page);
  report.check(`${name} cancelled`, (await page.getByPlaceholder("Leave a comment").count()) === 0);
}

/** How a range of lines is selected: dragging across line numbers, or a click then a Shift-click. */
export type RangeGesture = "drag" | "shift-click";

async function selectRange(page: Page, from: Locator, to: Locator, gesture: RangeGesture) {
  if (gesture === "shift-click") {
    await from.click();
    await page.keyboard.down("Shift");
    await to.click();
    await page.keyboard.up("Shift");
    return true;
  }
  const [a, b] = [await from.boundingBox(), await to.boundingBox()];
  if (!a || !b) return false;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  return true;
}

/** Selects from the quiet row to the painted one by their line numbers, as a person does. */
export async function multiLine(
  page: Page,
  { painted, quiet, selected }: { painted: Locator; quiet: Locator; selected: string },
  {
    report,
    name = "8 multi-line range",
    gesture = "drag",
  }: {
    report: Report;
    name?: string;
    gesture?: RangeGesture;
  },
): Promise<void> {
  if (!(await selectRange(page, numberOf(quiet), numberOf(painted), gesture)))
    return report.check(name, false, "(no boxes)");
  await settle(page);
  const rows = await selectedRows(page);
  if (rows < 2) {
    report.notDriven(
      name,
      `${gesture === "drag" ? "dragging" : "a Shift-click"} across line numbers selected ${rows} row`,
    );
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
    report.check(
      name,
      allSelected && quietBackground === selected,
      `(${rows} rows, quiet ${quietBackground})`,
    );
  }
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  if (await cancel.count()) await cancel.first().click();
}
