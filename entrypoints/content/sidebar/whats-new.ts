/**
 * The sidebar's what's-new block: the installed version's release notes, collapsed under a header
 * the user can expand or dismiss.
 *
 * No sheet of its own: `sidebar/sections-view.css` `@source`s this file, so the block is styled
 * only inside the sections view.
 */

import { el, icon, X_ICON } from "../ui/dom";
import { markdownNodes } from "../ui/markdown";
import { chevron } from "./sections-view";

/** The version whose `notes` the block shows, and how to remember that the user dismissed it. */
export interface WhatsNew {
  readonly version: string;
  readonly notes: string;
  readonly dismiss: () => void;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): megaphone. */
const MEGAPHONE_ICON =
  "M3.25 9a.75.75 0 0 1 .75.75c0 2.142.456 3.828.733 4.653a.122.122 0 0 0 .05.064.212.212 0 0 0 .117.033h1.31c.085 0 .18-.042.258-.152a.45.45 0 0 0 .075-.366A16.743 16.743 0 0 1 6 9.75a.75.75 0 0 1 1.5 0c0 1.588.25 2.926.494 3.85.293 1.113-.504 2.4-1.783 2.4H4.9c-.686 0-1.35-.41-1.589-1.12A16.4 16.4 0 0 1 2.5 9.75.75.75 0 0 1 3.25 9ZM0 6a4 4 0 0 1 4-4h2.75a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-.75.75H4a4 4 0 0 1-4-4Zm4-2.5a2.5 2.5 0 1 0 0 5h2v-5ZM15.59.082A.75.75 0 0 1 16 .75v10.5a.75.75 0 0 1-1.189.608l-.002-.001h.001l-.014-.01a5.775 5.775 0 0 0-.422-.25 10.63 10.63 0 0 0-1.469-.64C11.576 10.484 9.536 10 6.75 10a.75.75 0 0 1 0-1.5c2.964 0 5.174.516 6.658 1.043.423.151.787.3 1.092.443V2.014c-.305.143-.669.292-1.092.443C11.924 2.984 9.713 3.5 6.75 3.5a.75.75 0 0 1 0-1.5c2.786 0 4.826-.484 6.155-.957.665-.236 1.154-.47 1.47-.64.144-.077.284-.161.421-.25l.014-.01a.75.75 0 0 1 .78-.061Z";

const releaseUrl = (version: string) =>
  `https://github.com/macintacos/gh-prism-extension/releases/tag/v${version}`;

/**
 * `whatsNew`'s block, collapsed: a header whose toggle shows and hides the notes, led by an icon
 * the stylesheet swaps for the chevron as a section's does, and a button that removes the block
 * and calls `dismiss`, and below the notes a link to the version's GitHub Release.
 */
export function whatsNewBlock(doc: Document, { version, notes, dismiss }: WhatsNew): HTMLElement {
  const glyph = el(
    doc,
    "span",
    "gh-prism-glyph tw:grid tw:shrink-0 tw:text-[color:var(--gh-prism-hue)]",
    icon(doc, MEGAPHONE_ICON, { class: "gh-prism-section-icon" }),
    chevron(doc),
  );
  const toggle = el(
    doc,
    "button",
    "gh-prism-whats-new-toggle tw:flex tw:items-center tw:gap-2 tw:w-full tw:h-9 tw:py-0 tw:px-3 tw:border-0 tw:rounded-medium tw:[background:none] tw:text-fg-default tw:[font:inherit] tw:text-start tw:cursor-pointer tw:hover:bg-[var(--control-transparent-bgColor-hover)] tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline",
    glyph,
    el(doc, "span", "tw:truncate", `What's new in v${version}`),
  );
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");

  const header = el(
    doc,
    "h3",
    "gh-prism-whats-new-header tw:flex-1 tw:min-w-0 tw:m-0 tw:text-body-medium tw:font-semibold",
    toggle,
  );
  header.id = "gh-prism-heading-whats-new";

  // Primer's invisible IconButton, at the header row's height.
  const close = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-9 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X_ICON, {}),
  );
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss what's new");

  const link = el(
    doc,
    "a",
    "tw:inline-block tw:mt-2 tw:text-[color:var(--fgColor-accent)] tw:font-medium",
    `View v${version} on GitHub`,
  );
  link.href = releaseUrl(version);
  link.target = "_blank";
  link.rel = "noreferrer";

  const notesPane = el(
    doc,
    "div",
    "tw:max-h-64 tw:overflow-y-auto tw:pt-0 tw:px-3 tw:pb-3 tw:text-body-small tw:leading-body-small tw:text-fg-default tw:[&_:is(p,ul,h4)]:mt-0 tw:[&_:is(p,ul,h4)]:mb-2 tw:[&_ul]:ps-5 tw:[&_h4]:text-body-small tw:[&_h4]:font-semibold",
    ...markdownNodes(doc, notes),
    link,
  );
  const body = el(doc, "div", "gh-prism-whats-new-body tw:overflow-clip", notesPane);
  body.id = "gh-prism-whats-new-body";
  body.inert = true;
  toggle.setAttribute("aria-controls", body.id);

  const block = el(
    doc,
    "section",
    "gh-prism-whats-new tw:rounded-medium tw:border tw:border-hue-edge tw:bg-[var(--gh-prism-tint)] tw:shadow-[var(--shadow-resting-small)]",
    el(doc, "div", "tw:flex tw:items-center", header, close),
    body,
  );
  block.setAttribute("aria-labelledby", header.id);
  block.style.setProperty("--gh-prism-hue", "var(--fgColor-success)");

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(expanded));
    body.inert = !expanded;
  });
  close.addEventListener("click", () => {
    if (block.inert) return;
    block.inert = true;
    block.parentElement?.querySelector<HTMLElement>(".gh-prism-section-toggle")?.focus();
    dismiss();
    // A timer, not transitionend: it also fires under reduced motion, where no transition runs.
    // Keep at the stylesheet's .gh-prism-whats-new transition duration.
    setTimeout(() => block.remove(), 160);
  });
  return block;
}
