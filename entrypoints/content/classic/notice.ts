/**
 * On a pull request's classic Files changed page, which gh-prism leaves alone, explains why and how
 * to get the new page: sign in, or turn on GitHub's preview. Dismissed, it leaves a button in
 * GitHub's toolbar that brings it back.
 */

import { type ClassicPage, isSignedIn } from "../files-page";
import { el, icon } from "../ui/dom";
import { SECTION_SPECTRUM } from "../ui/section-catalog";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./notice.css?inline";

/** Whether the notice is dismissed. One per tab, so the choice carries to the next page. */
export interface NoticeChoice {
  dismissed: boolean;
}

/** The tab's notice choice for `showClassicNotice` to apply, and how to persist a change. */
export interface NoticeOptions {
  readonly choice: NoticeChoice;
  /** Remembers whether the user dismissed the notice. */
  readonly save: (dismissed: boolean) => void;
}

const DOCS =
  "https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview";

const TITLE_ID = "gh-prism-notice-title";

/** gh-prism's mark: a prism and the bands it splits light into. */
const PRISM = "M5.5 2 10 14H1Z M8 4.5h7V6H8Z M9.25 7.5H15V9H9.25Z M10.5 10.5H15V12h-4.5Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): x. */
const X =
  "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z";

const prism = (doc: Document) => icon(doc, PRISM, { class: "tw:shrink-0" });

const strong = (doc: Document, text: string) => el(doc, "strong", "tw:font-semibold", text);

/** The title and what to do, signed out: sign in, then come back here. */
function signedOutCopy(doc: Document): [string, ...Node[]] {
  const signIn = el(
    doc,
    "a",
    "gh-prism-notice-action tw:inline-flex tw:items-center tw:h-[var(--control-medium-size,32px)] tw:mt-3 tw:px-3 tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:bg-[var(--button-default-bgColor-rest)] tw:text-[color:var(--button-default-fgColor-rest)] tw:text-body-medium tw:font-medium tw:no-underline tw:hover:bg-[var(--button-default-bgColor-hover)] tw:hover:no-underline tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2",
    "Sign in",
  );
  signIn.href = `/login?return_to=${encodeURIComponent(doc.location.href)}`;
  return [
    "Sign in to GitHub to use gh-prism",
    el(
      doc,
      "p",
      "tw:m-0 tw:mt-1 tw:text-fg-muted",
      "Signed out, GitHub shows this classic Files changed page, even on a public pull request. gh-prism runs only on the new one.",
    ),
    signIn,
  ];
}

/** The title and what to do, signed in: turn on GitHub's preview of the new page. */
function signedInCopy(doc: Document): [string, ...Node[]] {
  const docs = el(
    doc,
    "a",
    "tw:text-[color:var(--fgColor-accent)] tw:underline tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-1 tw:rounded-[2px]",
    "Feature preview in GitHub Docs",
  );
  docs.href = DOCS;
  const step = (...parts: (Node | string)[]) => el(doc, "li", "tw:pl-1", ...parts);
  return [
    "Turn on GitHub's new Files changed page to use gh-prism",
    el(
      doc,
      "p",
      "tw:m-0 tw:mt-1 tw:text-fg-muted",
      "GitHub shows you this classic page while its New Files Changed Experience preview is off, and gh-prism runs only on the new one.",
    ),
    el(
      doc,
      "ol",
      "tw:m-0 tw:mt-2 tw:pl-5 tw:list-decimal tw:marker:text-fg-muted",
      step("Click your profile picture in the upper-right corner."),
      step("Click ", strong(doc, "Feature preview"), "."),
      step("Choose ", strong(doc, "New Files Changed Experience"), "."),
      step("Click ", strong(doc, "Enable"), "."),
    ),
    el(doc, "p", "tw:m-0 tw:mt-2 tw:text-body-small tw:text-fg-muted", docs, "."),
  ];
}

/** The notice for a viewer `signedIn` or not, and its dismiss button. */
function noticeOf(doc: Document, signedIn: boolean) {
  const [title, ...body] = signedIn ? signedInCopy(doc) : signedOutCopy(doc);
  const heading = el(
    doc,
    "h2",
    "tw:m-0 tw:text-body-medium tw:leading-body-medium tw:font-semibold tw:text-fg-default",
    title,
  );
  heading.id = TITLE_ID;

  // Primer's small invisible IconButton.
  const dismiss = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:-mt-1 tw:-mr-1 tw:ml-auto tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X, {}),
  );
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss gh-prism's notice");

  const section = el(
    doc,
    "section",
    "gh-prism-notice tw:relative tw:mt-4 tw:mb-2 tw:overflow-hidden tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--borderColor-default)] tw:bg-[var(--bgColor-default)] tw:text-fg-default tw:text-body-medium tw:leading-body-medium tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2",
    el(
      doc,
      "div",
      "tw:flex tw:items-start tw:gap-3 tw:pt-[19px] tw:pb-4 tw:px-4",
      el(doc, "span", "tw:flex tw:h-5 tw:items-center tw:text-fg-muted", prism(doc)),
      el(doc, "div", "tw:flex-1 tw:min-w-0 tw:max-w-[72ch]", heading, ...body),
      dismiss,
    ),
  );
  section.setAttribute("aria-labelledby", TITLE_ID);
  section.tabIndex = -1;
  section.style.setProperty("--gh-prism-spectrum", SECTION_SPECTRUM);
  return { section, dismiss };
}

/** Primer's small invisible Button, with gh-prism's mark, that brings the notice back. */
function reopenButton(doc: Document): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "gh-prism-notice-reopen tw:items-center tw:gap-1.5 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:text-body-small tw:font-medium tw:whitespace-nowrap tw:[font-family:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-fg-default tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    prism(doc),
    "Why is gh-prism off?",
  );
  button.type = "button";
  return button;
}

/**
 * Shows the notice just above `page`'s toolbar, or, while `choice` has it dismissed, a button
 * beside the toolbar's review tools that brings it back, until `signal` aborts. Each switch
 * records the change in `choice`, `save`s it, and moves focus to what replaced the control.
 */
export function showClassicNotice(
  page: ClassicPage,
  signal: AbortSignal,
  { choice, save }: NoticeOptions,
): void {
  const doc = page.toolbar.ownerDocument;
  const { section, dismiss } = noticeOf(doc, isSignedIn(doc));
  const reopen = reopenButton(doc);
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  const show = (dismissed: boolean) => {
    section.hidden = dismissed;
    reopen.hidden = !dismissed;
  };
  const toggle = (dismissed: boolean, focus: HTMLElement) => {
    choice.dismissed = dismissed;
    show(dismissed);
    focus.focus();
    save(dismissed);
  };
  dismiss.addEventListener("click", () => toggle(true, reopen));
  reopen.addEventListener("click", () => {
    section.dataset.reopened = "";
    toggle(false, section);
  });

  // A DOM clone of the page, such as a restored snapshot, can carry an earlier notice.
  for (const stale of doc.querySelectorAll(".gh-prism-notice, .gh-prism-notice-reopen"))
    stale.remove();
  show(choice.dismissed);
  page.toolbar.before(section);
  page.reviewTools.before(reopen);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    section.remove();
    reopen.remove();
    style.remove();
  });
}
