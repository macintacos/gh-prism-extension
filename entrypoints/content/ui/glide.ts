/**
 * Runs a layout change as a view transition, so what moves glides to where the change leaves it.
 * Each feature's stylesheet animates its own kind, keyed on `data-gh-prism-glide` on `<html>`.
 */

/** What moves: the sidebar switching sides or collapsing, or the Conversation panel pinning. */
export type Glide = "switch" | "toggle" | "pin";

/** Whether a change on `doc` glides: not under reduced motion, nor without view transitions. */
export const glides = (doc: Document): boolean =>
  !doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches &&
  Boolean(doc.startViewTransition);

/** Runs `change` as a view transition of `kind`, or at once where changes don't glide. */
export function glide(doc: Document, kind: Glide, change: () => void | Promise<void>): void {
  if (!glides(doc)) {
    void change();
    return;
  }
  const root = doc.documentElement;
  // Named only while gliding: a view-transition-name makes GitHub's sticky pane a stacking context.
  root.dataset.ghPrismGlide = kind;
  const { finished } = doc.startViewTransition(change);
  void finished.finally(() => delete root.dataset.ghPrismGlide);
}
