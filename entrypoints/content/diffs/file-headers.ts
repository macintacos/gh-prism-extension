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
    ({ target }) => {
      if (!(target instanceof Element)) return;
      const header = fileHeaderAt(target);
      if (!header || onHeaderControl(header, target)) return;
      // Deferred so GitHub sees the chevron's click outside this click's dispatch.
      setTimeout(() => header.chevron.click());
    },
    { signal },
  );
}
