/**
 * Click to comment's browser harness: `e2e/click-to-comment.e2e.ts` bundles this through
 * `bench/bundle.ts` with the structural painter's harness and injects it into a fixture page. Not
 * `*.e2e.ts`, so Playwright doesn't collect it.
 */
import "./structural-page";
import { clickToCommentItem } from "../entrypoints/content/diffs/click-to-comment";
import type { FilesPage } from "../entrypoints/content/files-page";

declare global {
  interface Window {
    /** Turns click to comment on over the page's `#diffs`, its gate open. */
    clickToComment(): void;
  }
}

window.clickToComment = () => {
  const diffs = document.querySelector("#diffs");
  if (!diffs) throw new Error("no #diffs");
  const page = { sidebar: document.body, tree: document.body, diffs } as unknown as FilesPage;
  const item = clickToCommentItem(page, new AbortController().signal, {
    choice: { on: true },
    save: () => {},
  });
  item.follow("open");
};
