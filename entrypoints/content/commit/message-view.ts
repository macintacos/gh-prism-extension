/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, which stays in the page, hidden, so it shows again unchanged on abort.
 * GitHub's box shows instead when the tab last picked plain text.
 */

import type { CommitMessageView } from "@/utils/prefs";
import { type CommitMessage, type FilesPage, findCommitMessage } from "../files-page";
import { el, icon } from "../ui/dom";
import { renderCommitMessage } from "./message";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./message-view.css?inline";

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
 * Stands in for a commit page's message box with its rendering, until `signal` aborts. GitHub's
 * box stays as it is on any other page, or when the message can't be rendered.
 */
export function showCommitMessage(
  page: FilesPage,
  signal: AbortSignal,
  { afterSections, choice, save }: CommitMessageOptions,
): void {
  afterSections(() => {
    const message = findCommitMessage(page);
    if (signal.aborted || !message) return;
    const nodes = renderedOrWarn(page.sidebar.ownerDocument, message);
    if (nodes) standIn(page, message.box, nodes, signal, { choice, save });
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

/**
 * Mounts `nodes` just before `page`'s message box, following GitHub's re-renders of it, until
 * `signal` aborts.
 */
function standIn(
  page: FilesPage,
  box: Element,
  nodes: Node[],
  signal: AbortSignal,
  { choice, save }: Pick<CommitMessageOptions, "choice" | "save">,
): void {
  const doc = page.sidebar.ownerDocument;
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
  );
  container.append(viewSwitch(doc, container, { choice, save }));
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  const follow = () => {
    const currentBox = findCommitMessage(page)?.box;
    if (!currentBox) container.remove();
    else if (container.nextElementSibling !== currentBox) currentBox.before(container);
  };

  follow();
  doc.head.append(style);
  const observer = new MutationObserver(follow);
  if (box.parentNode) observer.observe(box.parentNode, { childList: true });
  signal.addEventListener("abort", () => {
    observer.disconnect();
    container.remove();
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

/** The switch between `container`'s rendering and GitHub's box, showing `choice`'s view. */
function viewSwitch(
  doc: Document,
  container: HTMLElement,
  { choice, save }: Pick<CommitMessageOptions, "choice" | "save">,
): HTMLButtonElement {
  // Primer's small invisible IconButton, as the side switch is.
  const button = el(
    doc,
    "button",
    "gh-prism-commit-view-switch tw:relative tw:grid tw:shrink-0 tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:mt-2 tw:mr-2 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, MARKDOWN, {}),
  );
  button.type = "button";
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
  return button;
}
