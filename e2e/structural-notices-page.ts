/**
 * The structural notices' browser harness: `e2e/structural-notices.e2e.ts` bundles this through
 * `bench/bundle.ts` and injects it into a fixture page, where it runs the real notices as
 * `window.notices`. Not `*.e2e.ts`, so Playwright doesn't collect it.
 */
import { showStructuralNotices } from "../entrypoints/content/diffs/structural-notices";
import { sectionsOf } from "../tests/fixtures/diff-tables";

export interface NoticesHarness {
  /** Shows the "failed" notice on every file mounted under the page's `#diffs`. */
  start(): void;
}

declare global {
  interface Window {
    notices: NoticesHarness;
  }
}

window.notices = {
  start() {
    const diffs = document.querySelector("#diffs");
    if (!diffs) throw new Error("no #diffs");
    const view = showStructuralNotices(diffs, new AbortController().signal, () => "failed");
    view.sections?.(sectionsOf(diffs), new Set());
  },
};
