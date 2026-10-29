/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, which stays in the page, hidden, so it shows again unchanged on abort.
 * GitHub's box shows instead when the tab last picked plain text.
 */

import type { CommitMessageView } from "@/utils/prefs";
import { type CommitMessage, type FilesPage, findCommitMessage } from "../files-page";
import { el } from "../ui/dom";
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
  { afterSections, choice }: CommitMessageOptions,
): void {
  afterSections(() => {
    const message = findCommitMessage(page);
    if (signal.aborted || !message) return;
    const nodes = renderedOrWarn(page.sidebar.ownerDocument, message);
    if (nodes) standIn(page, message.box, nodes, signal, { choice });
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
  { choice }: Pick<CommitMessageOptions, "choice">,
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
  container.dataset.view = choice.view;
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
