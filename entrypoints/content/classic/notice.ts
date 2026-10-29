/**
 * On a pull request's classic Files changed page, which gh-prism leaves alone, explains in a
 * dialog why and how to get the new page: sign in, or turn on GitHub's preview. A button in
 * GitHub's toolbar opens it again.
 */

import { type ClassicPage, isSignedIn } from "../files-page";
import { el, icon, X_ICON } from "../ui/dom";
import { PRISM_GLYPH, prismMark } from "../ui/mark";
import { SECTION_SPECTRUM } from "../ui/section-catalog";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./notice.css?inline";

/** Whether the notice is dismissed. One per tab, so the choice carries to the next page. */
export interface NoticeChoice {
  dismissed: boolean;
}

/** The tab's notice choice for `showClassicNotice` to apply, and how to persist a dismissal. */
export interface NoticeOptions {
  readonly choice: NoticeChoice;
  /** Remembers that the user dismissed the notice. */
  readonly save: () => void;
}

const DOCS =
  "https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview";

const TITLE_ID = "gh-prism-classic-notice-title";

// Primer's medium Button, default and primary.
const BUTTON =
  "tw:inline-flex tw:items-center tw:h-[var(--control-medium-size,32px)] tw:px-3 tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:bg-[var(--button-default-bgColor-rest)] tw:text-[color:var(--button-default-fgColor-rest)] tw:text-body-medium tw:font-medium tw:[font-family:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2";
const PRIMARY =
  "tw:inline-flex tw:items-center tw:h-[var(--control-medium-size,32px)] tw:px-3 tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-primary-borderColor-rest)] tw:bg-[var(--button-primary-bgColor-rest)] tw:text-[color:var(--button-primary-fgColor-rest)] tw:text-body-medium tw:font-medium tw:no-underline tw:hover:bg-[var(--button-primary-bgColor-hover)] tw:hover:no-underline tw:active:bg-[var(--button-primary-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2";

const prism = (doc: Document) => icon(doc, PRISM_GLYPH, { class: "tw:shrink-0" });

const strong = (doc: Document, text: string) => el(doc, "strong", "tw:font-semibold", text);

/** A footer button that closes the dialog it sits in. */
function closer(doc: Document, label: string): HTMLButtonElement {
  const button = el(doc, "button", BUTTON, label);
  button.type = "button";
  button.addEventListener("click", () => button.closest("dialog")?.close());
  return button;
}

/** The title, the body, and the footer's actions, signed out: sign in, then come back here. */
function signedOutCopy(doc: Document): [string, Node[], Node[]] {
  const signIn = el(doc, "a", PRIMARY, "Sign in");
  signIn.href = `/login?return_to=${encodeURIComponent(doc.location.href)}`;
  return [
    "Sign in to GitHub to use gh-prism",
    [
      el(
        doc,
        "p",
        "tw:m-0 tw:text-fg-muted",
        "Signed out, GitHub shows this classic Files changed page, even on a public pull request. gh-prism runs only on the new one.",
      ),
    ],
    [closer(doc, "Not now"), signIn],
  ];
}

/** The title, the body, and the footer's actions, signed in: turn on GitHub's preview. */
function signedInCopy(doc: Document): [string, Node[], Node[]] {
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
    [
      el(
        doc,
        "p",
        "tw:m-0 tw:text-fg-muted",
        "GitHub shows you this classic page while its New Files Changed Experience preview is off, and gh-prism runs only on the new one.",
      ),
      el(
        doc,
        "ol",
        "tw:m-0 tw:mt-3 tw:pl-5 tw:list-decimal tw:marker:text-fg-muted",
        step("Click your profile picture in the upper-right corner."),
        step("Click ", strong(doc, "Feature preview"), "."),
        step("Choose ", strong(doc, "New Files Changed Experience"), "."),
        step("Click ", strong(doc, "Enable"), "."),
      ),
      el(doc, "p", "tw:m-0 tw:mt-3 tw:text-body-small tw:text-fg-muted", docs, "."),
    ],
    [closer(doc, "Got it")],
  ];
}

/** Primer's Dialog, for a viewer `signedIn` or not, closing on Esc or a click outside it. */
function noticeDialog(doc: Document, signedIn: boolean): HTMLDialogElement {
  const [title, body, actions] = signedIn ? signedInCopy(doc) : signedOutCopy(doc);
  const heading = el(
    doc,
    "h2",
    "tw:flex-1 tw:m-0 tw:py-1.5 tw:px-2 tw:text-body-medium tw:leading-body-medium tw:font-semibold",
    title,
  );
  heading.id = TITLE_ID;

  // Primer's medium invisible IconButton.
  const close = el(
    doc,
    "button",
    "tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-[var(--control-medium-size,32px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X_ICON, {}),
  );
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => close.closest("dialog")?.close());

  const dialog = el(
    doc,
    "dialog",
    "gh-prism-classic-notice tw:w-[480px] tw:min-w-[296px] tw:max-w-[calc(100dvw-64px)] tw:max-h-[calc(100dvh-64px)] tw:p-0 tw:[border:0] tw:rounded-[var(--borderRadius-large,12px)] tw:bg-[var(--overlay-bgColor)] tw:[box-shadow:var(--shadow-floating-small)] tw:text-fg-default tw:text-body-medium tw:leading-body-medium",
    el(
      doc,
      "div",
      "tw:flex tw:items-start tw:pt-[11px] tw:pb-2 tw:px-2 tw:[box-shadow:0_1px_0_var(--borderColor-default)]",
      heading,
      close,
    ),
    el(doc, "div", "tw:p-4", ...body),
    el(
      doc,
      "div",
      "gh-prism-classic-notice-footer tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:p-4",
      prismMark(doc),
      ...actions,
    ),
  );
  dialog.setAttribute("aria-labelledby", TITLE_ID);
  dialog.setAttribute("closedby", "any");
  dialog.style.setProperty("--gh-prism-spectrum", SECTION_SPECTRUM);
  return dialog;
}

/** Primer's small invisible Button, with gh-prism's mark, that opens the notice. */
function openButton(doc: Document): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "gh-prism-classic-notice-button tw:inline-flex tw:items-center tw:gap-1.5 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-fg-muted tw:text-body-small tw:font-medium tw:whitespace-nowrap tw:[font-family:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-fg-default tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    prism(doc),
    "Why is gh-prism off?",
  );
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  return button;
}

/**
 * Puts a button that opens the notice beside `page`'s review tools, and opens it while `choice`
 * isn't dismissed, until `signal` aborts. Each close records the dismissal in `choice`, `save`s
 * it, and moves focus to the button.
 */
export function showClassicNotice(
  page: ClassicPage,
  signal: AbortSignal,
  { choice, save }: NoticeOptions,
): void {
  const doc = page.toolbar.ownerDocument;
  const dialog = noticeDialog(doc, isSignedIn(doc));
  const button = openButton(doc);
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  button.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => {
    choice.dismissed = true;
    button.focus();
    save();
  });

  // A DOM clone of the page, such as a restored snapshot, can carry an earlier notice.
  for (const stale of doc.querySelectorAll(
    ".gh-prism-classic-notice, .gh-prism-classic-notice-button",
  ))
    stale.remove();
  page.reviewTools.before(button);
  doc.head.append(style);
  doc.body.append(dialog);
  if (!choice.dismissed) dialog.showModal();
  signal.addEventListener("abort", () => {
    dialog.remove();
    button.remove();
    style.remove();
  });
}
