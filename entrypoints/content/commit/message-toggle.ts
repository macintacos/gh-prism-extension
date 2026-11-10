/**
 * The button that starts the diffs' toolbar on a commit's page and hides and shows the commit's
 * message, and the Shift+\ that presses it. `message-view.ts` mounts it and listens for its click.
 */

import { type FilesPage, findFilesToolbar } from "../files-page";
import { shiftBackslashButton } from "../ui/key-button";
import { toggleKeyOf } from "../ui/toggle-keys";

/** Octicons 19.15.0 (MIT, GitHub Inc.): git-commit. */
const GIT_COMMIT =
  "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z";

/**
 * The toggle for the message whose element has the id `controls`, first in `page`'s toolbar row
 * until `signal` aborts, or `undefined` without the row, where there's nowhere to put it. Shift+\
 * clicks it, as a reader's click would, after moving focus to it without a ring.
 */
export function showMessageToggle(
  page: FilesPage,
  signal: AbortSignal,
  controls: string,
): HTMLButtonElement | undefined {
  const toolbar = findFilesToolbar(page);
  if (!toolbar) return undefined;
  const doc = toolbar.ownerDocument;

  const button = shiftBackslashButton(doc, {
    className: "gh-prism-commit-toggle",
    label: "Commit message",
    path: GIT_COMMIT,
  });
  button.setAttribute("aria-controls", controls);

  doc.addEventListener(
    "keydown",
    (event) => {
      if (toggleKeyOf(event) !== "Shift+\\") return;
      event.preventDefault();
      button.focus({ focusVisible: false });
      button.click();
    },
    { capture: true, signal },
  );

  // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier toggle.
  for (const stale of doc.querySelectorAll(".gh-prism-commit-toggle")) stale.remove();
  toolbar.prepend(button);
  signal.addEventListener("abort", () => button.remove());
  return button;
}
