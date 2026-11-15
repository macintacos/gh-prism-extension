/**
 * The unwrapped diffs' browser harness: `e2e/wrap-lines.e2e.ts` bundles this through
 * `bench/bundle.ts` and injects it into a fixture page, with the structural painter's and notices'
 * harnesses. Not `*.e2e.ts`, so Playwright doesn't collect it.
 */
import "./structural-page";
import "./structural-notices-page";
import { followSideScroll } from "../entrypoints/content/diffs/side-scroll";
import css from "../entrypoints/content/diffs/wrap-lines.css?inline";

declare global {
  interface Window {
    /** Mounts `wrap-lines.css` unwrapped and follows the page's `#diffs` sideways scroll. */
    unwrapDiffs(): void;
  }
}

window.unwrapDiffs = () => {
  const diffs = document.querySelector<HTMLElement>("#diffs");
  if (!diffs) throw new Error("no #diffs");
  document.head.append(Object.assign(document.createElement("style"), { textContent: css }));
  document.documentElement.dataset.ghPrismWrap = "off";
  followSideScroll({ diffs }, new AbortController().signal);
};
