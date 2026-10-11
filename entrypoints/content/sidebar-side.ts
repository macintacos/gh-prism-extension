/**
 * Docks the Files changed tab's file sidebar on the right or the left, with a switch beside
 * GitHub's file-tree toggle, and glides the sidebar when it switches sides, collapses, or expands.
 * The stylesheet moves GitHub's own pane and toggle, keyed on attributes on `<html>`: nothing
 * React renders is moved or mutated.
 */

import { el, icon } from "./dom";
import { findTreeToggle } from "./files-page";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sidebar-side.css?raw";

export type Side = "left" | "right";

/** Which side the sidebar docks on. One per tab, so the choice carries to the next page. */
export interface SideChoice {
  side: Side;
}

export interface SideOptions {
  readonly choice: SideChoice;
  /** Remembers a side the switch picked. */
  readonly save: (side: Side) => void;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): arrow-switch. */
const ARROW_SWITCH =
  "M5.22 14.78a.75.75 0 0 0 1.06-1.06L4.56 12h8.69a.75.75 0 0 0 0-1.5H4.56l1.72-1.72a.75.75 0 0 0-1.06-1.06l-3 3a.75.75 0 0 0 0 1.06l3 3Zm5.56-6.5a.75.75 0 1 1-1.06-1.06l1.72-1.72H2.75a.75.75 0 0 1 0-1.5h8.69L9.72 2.28a.75.75 0 0 1 1.06-1.06l3 3a.75.75 0 0 1 0 1.06l-3 3Z";

const LABEL: Record<Side, string> = {
  left: "Move file tree to the right",
  right: "Move file tree to the left",
};

const other = (side: Side): Side => (side === "left" ? "right" : "left");

/** What moves the sidebar; the stylesheet animates each its own way. */
type Glide = "switch" | "toggle";

const glides = (doc: Document): boolean =>
  !doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches &&
  Boolean(doc.startViewTransition);

/** Runs `change` as a view transition that glides the pane and diffs to where it leaves them. */
function glide(doc: Document, kind: Glide, change: () => void | Promise<void>): void {
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

/**
 * Glides the tree as GitHub's toggle collapses and expands it, rather than letting it jump, until
 * `signal` aborts. The click is held back and replayed inside the transition, so GitHub's handler
 * runs between its before and after snapshots.
 */
function glideTreeToggle(doc: Document, toggle: Element, signal: AbortSignal): void {
  let replaying = false;
  const replay = async (button: HTMLElement) => {
    replaying = true;
    button.click();
    replaying = false;
    // GitHub's React commits the collapse in a microtask after the click returns.
    await new Promise((resolve) => setTimeout(resolve));
  };
  toggle.addEventListener(
    "click",
    (event) => {
      if (replaying || !glides(doc) || !(event.target instanceof Element)) return;
      // The narrow layout's toggle opens an overlay instead.
      const button = event.target.closest<HTMLElement>(
        '[class*="RegularTreeToggle"], [aria-controls="diff_file_tree"]:not(.d-md-none)',
      );
      if (!button) return;
      event.stopPropagation();
      glide(doc, "toggle", () => replay(button));
    },
    { capture: true, signal },
  );
}

/**
 * Docks the sidebar on `choice.side` and adds the switch just after GitHub's tree toggle, until
 * `signal` aborts. A click docks it on the other side, records that in `choice`, and `save`s it.
 * Without the toggle, GitHub's layout is left alone, since there's nowhere to switch it back.
 */
export function dockSidebar(
  doc: Document,
  signal: AbortSignal,
  { choice, save }: SideOptions,
): void {
  const toggle = findTreeToggle(doc);
  if (!toggle) return;
  const root = doc.documentElement;
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  const button = el(doc, "button", "gh-prism-side-switch", icon(doc, ARROW_SWITCH, {}));
  button.type = "button";
  const dock = (side: Side) => {
    root.dataset.ghPrismSide = side;
    button.setAttribute("aria-label", LABEL[side]);
  };
  button.addEventListener("click", () => {
    choice.side = other(choice.side);
    glide(doc, "switch", () => dock(choice.side));
    save(choice.side);
  });

  // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier switch.
  for (const stale of doc.querySelectorAll(".gh-prism-side-switch")) stale.remove();
  dock(choice.side);
  toggle.after(button);
  glideTreeToggle(doc, toggle, signal);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    button.remove();
    style.remove();
    delete root.dataset.ghPrismSide;
  });
}
