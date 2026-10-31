/**
 * Adds Older and Newer links to a commit page's row naming its parent and SHA, which Shift+J and
 * Shift+K follow. Older goes to the first parent, which the row names; Newer waits on a read of
 * what follows, held off until it lands, so both links hold their place from the visit's start.
 */

import type { NextCommit } from "@/utils/github/next-commit";
import type { CommitHead } from "@/utils/github/pr-ref";
import { type FilesPage, findCommitHeader } from "../files-page";
import { el, icon, isEditable } from "../ui/dom";
import { keycap } from "../ui/keycap";
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
 * Adds Older and Newer after the copy button in `page`'s commit header row, with Shift+J and
 * Shift+K following them, until `signal` aborts. Older links to the commit's first parent, which
 * `sawParent` hears, or is held off on a root commit; Newer is held off until `next` lands, then
 * links to the commit that follows or says why there is none. Adds nothing on a page without the
 * row.
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

  // j moves down a list, and older commits sit lower in one.
  const previous = stepLink(
    doc,
    "gh-prism-commit-previous",
    "J",
    icon(doc, CHEVRON_LEFT, { class: "tw:text-fg-muted" }),
    keycap(doc, "J", { shift: true }),
    "Older",
  );
  const following = stepLink(
    doc,
    "gh-prism-commit-next",
    "K",
    "Newer",
    keycap(doc, "K", { shift: true }),
    icon(doc, CHEVRON_RIGHT, { class: "tw:text-fg-muted" }),
  );
  // Primer's ButtonGroup, but not isolated: isolation traps the tooltips under the content below.
  const steps = el(
    doc,
    "span",
    "gh-prism-commit-steps tw:inline-flex tw:ms-2",
    previous,
    following,
  );
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  if (header.parent) {
    point(previous, "Older", pathOf(header.parent), header.parent);
    sawParent(header.parent);
  } else holdOff(previous, "Older", "none, this is the first commit");
  holdOff(following, "Newer", "looking it up");
  void next.then((found) => {
    if (signal.aborted) return;
    if (found?.kind === "commit") point(following, "Newer", pathOf(found.sha), found.sha);
    else holdOff(following, "Newer", reasonFor(found));
  });

  followStepKeys(doc, signal, [previous, following]);
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

/**
 * Primer's small default Button inside its ButtonGroup, as a link holding `content`, which Shift
 * and `key` follow.
 */
function stepLink(
  doc: Document,
  name: string,
  key: string,
  ...content: (Node | string)[]
): HTMLAnchorElement {
  const link = el(
    doc,
    "a",
    "gh-prism-commit-step tw:relative tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:not-first:-ms-px tw:first:rounded-s-medium tw:last:rounded-e-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:bg-[var(--button-default-bgColor-rest)] tw:[box-shadow:var(--button-default-shadow-resting)] tw:text-[color:var(--button-default-fgColor-rest)] tw:[font-family:var(--fontStack-sansSerif)] tw:text-body-small tw:font-medium tw:no-underline tw:hover:z-1 tw:hover:no-underline tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:z-1 tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:z-1 tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    ...content,
  );
  link.classList.add(name);
  link.setAttribute("aria-keyshortcuts", `Shift+${key}`);
  return link;
}

/**
 * Has each of `links` followed, as a click does, by the key its `aria-keyshortcuts` names, until
 * `signal` aborts. Leaves alone a held-off link, a key typed into a field, a key pressed with
 * another modifier, and a held key's repeats.
 */
function followStepKeys(
  doc: Document,
  signal: AbortSignal,
  links: readonly HTMLAnchorElement[],
): void {
  const onKey = (event: KeyboardEvent) => {
    if (!event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const shortcut = `Shift+${event.key}`;
    const link = links.find((step) => step.getAttribute("aria-keyshortcuts") === shortcut);
    if (!link?.hasAttribute("href") || isEditable(event.target)) return;
    event.preventDefault();
    link.click();
  };

  doc.addEventListener("keydown", onKey, { capture: true, signal });
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
