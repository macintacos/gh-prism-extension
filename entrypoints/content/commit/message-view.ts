/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, or in a sticky column beside the diffs on a wide window, with a switch to its
 * plain text. GitHub's box stays in the page, hidden and unchanged: it shows again on abort, and as
 * the plain text above the diffs; in the column, the plain text is a copy of its contents.
 */

import type { CommitMessageView } from "@/utils/prefs";
import {
  type CommitMessage,
  type FilesPage,
  findCommitColumnRow,
  findCommitMessage,
} from "../files-page";
import { el, icon } from "../ui/dom";
import { renderCommitMessage } from "./message";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./message-view.css?inline";

/**
 * When to render, the tab's view choice for `showCommitMessage` to apply, and how to persist a
 * switch.
 */
export interface CommitMessageOptions {
  /**
   * Runs `task` once the sidebar's sections have drawn, or a second has passed without them,
   * and then once the browser is idle, so the message never holds up the sidebar or the diffs.
   */
  readonly afterSections: (task: () => void) => void;
  readonly choice: CommitMessageChoice;
  /** Remembers a view the switch picked. */
  readonly save: (view: CommitMessageView) => void;
}

/**
 * Which view a commit's message shows; one per browser tab, shared by every page in it, so a
 * switch carries to the next commit.
 */
export interface CommitMessageChoice {
  view: CommitMessageView;
}

/**
 * Stands in for a commit page's message box with its rendering, until `signal` aborts, opening in
 * `choice`'s view; its switch records each pick in `choice` and `save`s it. GitHub's box stays as
 * it is on any other page, for a message with only a subject line, when the message can't be
 * rendered, or while plain text is picked above the diffs.
 */
export function showCommitMessage(
  page: FilesPage,
  signal: AbortSignal,
  { afterSections, choice, save }: CommitMessageOptions,
): void {
  afterSections(() => {
    const message = findCommitMessage(page);
    // A subject line alone gains nothing from rendering.
    if (signal.aborted || !message?.body) return;
    const doc = page.sidebar.ownerDocument;
    const nodes = renderedOrWarn(doc, message);
    if (nodes) {
      const view = messageView(doc, nodes, { box: message.box, choice, save });
      mountMessage(page, message.box, view, signal);
    }
  });
}

/** `message`'s rendering, or `undefined`, warning when the renderer throws. */
function renderedOrWarn(doc: Document, message: CommitMessage): Node[] | undefined {
  try {
    return renderCommitMessage(doc, message);
  } catch (error) {
    console.warn("gh-prism: couldn't render the commit message; leaving GitHub's as is", error);
    return undefined;
  }
}

// GitHub docks its file tree beside the diffs from 1012px; the column's 320px (tw:w-80) comes on
// top, so the diffs never get less width than GitHub gives them there.
const COLUMN_QUERY = "(min-width: 1332px)";

/**
 * Mounts `container`, the message and its switch, in a sticky column at the left of `page`'s
 * layout row on a wide window, else just before `page`'s message box, following GitHub's
 * re-renders and the window's width, until `signal` aborts.
 */
function mountMessage(
  page: FilesPage,
  box: Element,
  container: HTMLElement,
  signal: AbortSignal,
): void {
  const doc = page.sidebar.ownerDocument;
  const slot = Object.assign(el(doc, "span", "gh-prism-commit-slot"), { hidden: true });
  const column = messageColumn(doc);
  const wide = doc.defaultView?.matchMedia(COLUMN_QUERY);
  // Found once: a new row means a new sidebar, and so a new visit; a row detached before then
  // falls back above the diffs.
  const row = findCommitColumnRow(page);
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  const unmount = () => {
    container.remove();
    slot.remove();
    column.remove();
  };
  const moveIntoColumn = (connectedRow: Element, currentBox: Element) => {
    if (column.parentElement !== connectedRow) connectedRow.prepend(column);
    if (container.parentElement !== column) column.append(container);
    if (slot.nextElementSibling !== currentBox) currentBox.before(slot);
  };
  const moveAboveDiffs = (currentBox: Element) => {
    column.remove();
    slot.remove();
    if (container.nextElementSibling !== currentBox) currentBox.before(container);
  };

  const follow = () => {
    const currentBox = findCommitMessage(page)?.box;
    if (!currentBox) unmount();
    else if (wide?.matches && row?.isConnected) moveIntoColumn(row, currentBox);
    else moveAboveDiffs(currentBox);
  };

  follow();
  doc.head.append(style);

  const observer = new MutationObserver(follow);
  if (box.parentNode) observer.observe(box.parentNode, { childList: true });
  if (row) observer.observe(row, { childList: true });
  wide?.addEventListener("change", follow);

  signal.addEventListener("abort", () => {
    observer.disconnect();
    // Removed by hand: happy-dom's MediaQueryList ignores a { signal } option.
    wide?.removeEventListener("change", follow);
    unmount();
    style.remove();
  });
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): markdown. */
const MARKDOWN =
  "M14.85 3c.63 0 1.15.52 1.14 1.15v7.7c0 .63-.51 1.15-1.15 1.15H1.15C.52 13 0 12.48 0 11.84V4.15C0 3.52.52 3 1.15 3ZM9 11V5H7L5.5 7 4 5H2v6h2V8l1.5 1.92L7 8v3Zm2.99.5L14.5 8H13V5h-2v3H9.5Z";

const LABEL: Record<CommitMessageView, string> = {
  rendered: "Show plain text",
  plaintext: "Show rendered Markdown",
};

/**
 * `nodes` beside a switch to plain text, with a copy of `box`'s children that the column shows as
 * that plain text, returned with `data-view` already set to `choice.view` so a plain-text reader
 * never sees the rendering paint. Each click flips the view, records it in `choice`, and `save`s
 * it.
 */
function messageView(
  doc: Document,
  nodes: Node[],
  { box, choice, save }: Pick<CommitMessageOptions, "choice" | "save"> & { box: Element },
): HTMLElement {
  const button = viewSwitch(doc);
  const container = el(
    doc,
    "div",
    "gh-prism-commit-message tw:flex tw:items-start tw:justify-end",
    el(
      doc,
      "div",
      "gh-prism-commit-message-body markdown-body tw:flex-1 tw:min-w-0 tw:px-3 tw:py-2",
      ...nodes,
    ),
    // Copies the children, not the box: findCommitMessage matches the box's own class.
    el(
      doc,
      "div",
      "gh-prism-commit-message-plain tw:flex-1 tw:min-w-0 tw:px-3 tw:py-2",
      ...[...box.childNodes].map((node) => node.cloneNode(true)),
    ),
    button,
  );
  const showView = (view: CommitMessageView) => {
    container.dataset.view = view;
    button.setAttribute("aria-label", LABEL[view]);
  };
  button.addEventListener("click", () => {
    choice.view = choice.view === "rendered" ? "plaintext" : "rendered";
    showView(choice.view);
    save(choice.view);
  });

  showView(choice.view);
  return container;
}

/** The sticky column, at the left of GitHub's layout row, holding the message on a wide window. */
function messageColumn(doc: Document): HTMLElement {
  const column = el(
    doc,
    "aside",
    "gh-prism-commit-column tw:sticky tw:top-0 tw:-order-1 tw:h-screen tw:w-80 tw:shrink-0 tw:self-start tw:overflow-y-auto tw:border-e tw:border-border-default",
  );
  column.setAttribute("aria-label", "Commit message");
  return column;
}

/** The unlabelled button that switches between the rendering and the plain text. */
function viewSwitch(doc: Document): HTMLButtonElement {
  // Primer's small invisible IconButton, as the side switch is.
  const button = el(
    doc,
    "button",
    "gh-prism-commit-view-switch tw:relative tw:grid tw:shrink-0 tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:mt-2 tw:mr-2 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, MARKDOWN, {}),
  );
  button.type = "button";
  return button;
}
