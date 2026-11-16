/** Makes each file header's bar toggle its diff, as its chevron does. */

import { type FilesPage, fileHeaderAt, onHeaderControl } from "../files-page";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./file-headers.css?inline";

/**
 * Tints a hovered file header's bar and forwards a click on its blank area to its chevron, until
 * `signal` aborts.
 */
export function showClickableHeaders(page: Pick<FilesPage, "diffs">, signal: AbortSignal): void {
  const doc = page.diffs.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => style.remove());

  page.diffs.addEventListener(
    "click",
    (event) => {
      const { target } = event;
      if (!(event instanceof MouseEvent)) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!(target instanceof Element)) return;
      const header = fileHeaderAt(target);
      if (!header || onHeaderControl(header, target)) return;
      // Refined GitHub's easy-toggle-files clicks the chevron for the same bar click.
      let clicked = false;
      const noteChevron = (chevronClick: Event) => {
        clicked ||=
          chevronClick.target instanceof Node && header.chevron.contains(chevronClick.target);
      };
      doc.addEventListener("click", noteChevron, { capture: true });
      // Deferred so GitHub sees the chevron's click outside this click's dispatch. A plain chevron
      // click, so mark-on-collapse.ts counts it as one.
      setTimeout(() => {
        doc.removeEventListener("click", noteChevron, { capture: true });
        if (!clicked) header.chevron.click();
      });
    },
    { signal },
  );
}
