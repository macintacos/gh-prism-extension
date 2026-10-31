import { el } from "./dom";

/**
 * A keycap reading `key`, after a ⇧ when `shift`, hidden from assistive technology, which hears
 * the control's `aria-keyshortcuts` instead. Its touch-screen rule is in `keycap.css`, which the
 * control's sheet imports.
 */
export function keycap(doc: Document, key: string, { shift }: { shift: boolean }): HTMLElement {
  // GitHub's monospace stack draws ⇧ at half the letter's height; its sans stack, at full height.
  const prefix = shift ? [el(doc, "span", "tw:[font-family:var(--fontStack-sansSerif)]", "⇧")] : [];
  // GitHub's own kbd rule, which Markdown's <kbd> takes too, draws the keycap.
  const cap = el(doc, "kbd", "gh-prism-key tw:text-inherit", ...prefix, key);
  cap.setAttribute("aria-hidden", "true");
  return cap;
}
