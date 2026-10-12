import { findFilesPage, readChangedFiles } from "../../entrypoints/content/files-page";
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

/** The pull request fixture's diff list; throws when the fixture lacks it. */
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

/** The commit fixture's diff anchor for `bin/caret-launcher`. */
export const LAUNCHER_DIFF =
  "diff-90df21c5f2396574b17d2f1696a2e63cee454ee37910c7b254a81d44449cdaa4";

/** The native row link for the changed file at `path`; throws when there is none. */
export const linkTo = (path: string): HTMLAnchorElement => {
  const found = readChangedFiles(document).find((f) => f.path === path);
  if (!found) throw new Error(`no changed file ${path}`);
  return found.link;
};
