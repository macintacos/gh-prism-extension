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

/**
 * Runs `change` as a view transition of `kind`, or at once where changes don't glide or another
 * glide is running: a second view transition would skip the first, and its end would strip the
 * first's names.
 */
export function glide(doc: Document, kind: Glide, change: () => void | Promise<void>): void {
  const root = doc.documentElement;
  if (!glides(doc) || root.dataset.ghPrismGlide !== undefined) {
    void change();
    return;
  }
  // Named only while gliding: a view-transition-name makes GitHub's sticky pane a stacking context.
  root.dataset.ghPrismGlide = kind;
  const { finished } = doc.startViewTransition(change);
  void finished.finally(() => delete root.dataset.ghPrismGlide);
}
