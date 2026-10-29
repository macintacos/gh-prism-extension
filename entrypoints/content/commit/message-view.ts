/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, which stays in the page, hidden, so it shows again unchanged on abort.
 */

import { type FilesPage, findCommitMessage } from "../files-page";
import { el } from "../ui/dom";
import { renderCommitMessage } from "./message";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./message-view.css?inline";

export interface CommitMessageOptions {
  /** Runs `task` once the browser is idle, so the message never holds up the sidebar or the diffs. */
  readonly idle: (task: () => void) => void;
}

/**
 * Stands in for a commit page's message box with its rendering, until `signal` aborts. GitHub's
 * box stays as it is on any other page, or when the message can't be rendered.
 */
export function showCommitMessage(
  page: FilesPage,
  signal: AbortSignal,
  { idle }: CommitMessageOptions,
): void {
  idle(() => {
    const message = findCommitMessage(page);
    if (signal.aborted || !message) return;
    const doc = page.sidebar.ownerDocument;
    let nodes: Node[] | undefined;
    try {
      nodes = renderCommitMessage(doc, message);
    } catch (error) {
      console.warn("gh-prism: couldn't render the commit message; leaving GitHub's as is", error);
      return;
    }
    if (!nodes) return;

    const container = el(
      doc,
      "div",
      "gh-prism-commit-message markdown-body tw:px-3 tw:py-2",
      ...nodes,
    );
    const style = Object.assign(doc.createElement("style"), { textContent: css });
    const follow = () => {
      const box = findCommitMessage(page)?.box;
      if (!box) container.remove();
      else if (container.nextElementSibling !== box) box.before(container);
    };
    follow();
    doc.head.append(style);
    const observer = new MutationObserver(follow);
    if (message.box.parentNode) observer.observe(message.box.parentNode, { childList: true });
    signal.addEventListener("abort", () => {
      observer.disconnect();
      container.remove();
      style.remove();
    });
  });
}
