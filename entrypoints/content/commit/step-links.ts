/**
 * Adds Previous and Next links to a commit page's row naming its parent and SHA. Previous goes to
 * the first parent, which the row names; Next waits on a read of what follows, held off until it
 * lands, so both links hold their place from the visit's start.
 */

import type { NextCommit } from "@/utils/github/next-commit";
import type { CommitHead } from "@/utils/github/pr-ref";
import { type FilesPage, findCommitHeader } from "../files-page";
import { el, icon } from "../ui/dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./step-links.css?inline";

/** The commit a page shows, what follows it, and who hears its parent. */
export interface StepLinksOptions {
  /** The commit the page shows, whose repository the links stay in. */
  readonly commit: CommitHead;
  /** What follows the commit, once read; `undefined` once the read fails. */
  readonly next: Promise<NextCommit | undefined>;
  /** Hears the SHA of the commit's first parent, when it has one. */
  readonly sawParent: (parent: string) => void;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): chevron-left. */
const CHEVRON_LEFT =
  "M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): chevron-right. */
const CHEVRON_RIGHT =
  "M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z";

/**
 * Adds Previous and Next after the copy button in `page`'s commit header row, until `signal`
 * aborts. Previous links to the commit's first parent, which `sawParent` hears, or is held off on a
 * root commit; Next is held off until `next` lands, then links to the commit that follows or says
 * why there is none. Adds nothing on a page without the row.
 */
export function showStepLinks(
  page: FilesPage,
  signal: AbortSignal,
  { commit, next, sawParent }: StepLinksOptions,
): void {
  const header = findCommitHeader(page);
  if (!header) return;
  const doc = page.sidebar.ownerDocument;
  const pathOf = (sha: string) => `/${commit.owner}/${commit.repo}/commit/${sha}`;

  const previous = stepLink(
    doc,
    "gh-prism-commit-previous",
    icon(doc, CHEVRON_LEFT, {}),
    "Previous",
  );
  const following = stepLink(doc, "gh-prism-commit-next", "Next", icon(doc, CHEVRON_RIGHT, {}));
  const steps = el(
    doc,
    "span",
    "gh-prism-commit-steps tw:inline-flex tw:items-center tw:gap-1 tw:ms-2",
    previous,
    following,
  );
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  if (header.parent) {
    point(previous, "Previous", pathOf(header.parent), header.parent);
    sawParent(header.parent);
  } else holdOff(previous, "Previous", "none, this is the first commit");
  holdOff(following, "Next", "looking it up");
  void next.then((found) => {
    if (signal.aborted) return;
    if (found?.kind === "commit") point(following, "Next", pathOf(found.sha), found.sha);
    else holdOff(following, "Next", reasonFor(found));
  });

  header.row.append(steps);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    steps.remove();
    style.remove();
  });
}

/** Why nothing follows a commit, given what the read found. */
const reasonFor = (found: Exclude<NextCommit, { kind: "commit" }> | undefined): string =>
  found?.kind === "newest" ? `none, this is the newest on ${found.branch}` : "none found";

/** Primer's small invisible Button, as a link holding `content`, an icon and its label. */
function stepLink(doc: Document, name: string, ...content: (Node | string)[]): HTMLAnchorElement {
  const link = el(
    doc,
    "a",
    "gh-prism-commit-step tw:relative tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:rounded-medium tw:text-[color:var(--button-invisible-fgColor-rest)] tw:[font-family:var(--fontStack-sansSerif)] tw:text-body-small tw:font-medium tw:no-underline tw:hover:no-underline tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    ...content,
  );
  link.classList.add(name);
  return link;
}

/** Links `link` to `path`, naming where it goes by `sha`'s short form. */
function point(link: HTMLAnchorElement, label: string, path: string, sha: string): void {
  link.setAttribute("href", path);
  for (const attribute of ["role", "aria-disabled", "tabindex"]) link.removeAttribute(attribute);
  link.setAttribute("aria-label", `${label} commit: ${sha.slice(0, 7)}`);
}

/** Holds `link` off with `reason`, still focusable, so a keyboard reaches its tooltip. */
function holdOff(link: HTMLAnchorElement, label: string, reason: string): void {
  link.removeAttribute("href");
  link.setAttribute("role", "link");
  link.setAttribute("aria-disabled", "true");
  link.tabIndex = 0;
  link.setAttribute("aria-label", `${label} commit: ${reason}`);
}
