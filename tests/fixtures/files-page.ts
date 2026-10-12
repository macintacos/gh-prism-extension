import { findFilesPage } from "../../entrypoints/content/files-page";
// The `?raw` import is required: `readFileSync` throws under happy-dom.
import commitFixture from "./commit-page.html?raw";
import fixture from "./files-page.html?raw";

/** Replaces `document.body` with the Files changed markup. */
export function loadFixture(): void {
  document.body.innerHTML = fixture;
}

/** The fixture element with `id`; throws when the fixture lacks it. */
export function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`fixture has no #${id}`);
  return el;
}

/** Replaces `document.body` with a single commit's markup. */
export function loadCommitFixture(): void {
  document.body.innerHTML = commitFixture;
}

/** The fixture's diff list; throws when the fixture lacks it. */
export const diffList = (): Element => {
  const diffs = document.querySelector('[data-testid="diff-content"]');
  if (!diffs) throw new Error("fixture has no diff list");
  return diffs;
};

/** The Files changed markup `findFilesPage` finds in the document; throws when it finds none. */
export const foundPage = () => {
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture has no Files changed markup");
  return page;
};
