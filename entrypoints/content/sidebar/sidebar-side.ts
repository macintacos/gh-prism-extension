/**
 * Docks the Files changed tab's file sidebar on the right or the left, with a switch beside
 * GitHub's file-tree toggle, and glides the sidebar when it switches sides, collapses, or expands.
 * The stylesheet moves GitHub's own pane and toggle, keyed on attributes on `<html>`: nothing
 * React renders is moved or mutated.
 */

import type { Side } from "@/utils/prefs";
import {
  dragHandleOf,
  type FilesPage,
  findTreeToggle,
  startPaneOf,
  treeToggleButtonOf,
} from "../files-page";
import { el, icon } from "../ui/dom";
// ?raw, not a plain CSS import: on WXT 0.21.4 that crashes `wxt build` (Vite's CSS-modules cache).
import css from "./sidebar-side.css?raw";

export type { Side };

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
function glideTreeToggle(page: FilesPage, toggle: Element, signal: AbortSignal): void {
  const doc = page.sidebar.ownerDocument;
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
      const button = treeToggleButtonOf(page, event.target);
      if (!button) return;
      event.stopPropagation();
      glide(doc, "toggle", () => replay(button));
    },
    { capture: true, signal },
  );
}

/** Whether a Primer start pane's divider sits at the pane's left, where only docking right puts it. */
function dividerLeads(handle: Element): boolean {
  const wrapper = startPaneOf(handle);
  if (!wrapper) return false;
  const { left, width } = wrapper.getBoundingClientRect();
  return handle.getBoundingClientRect().left < left + width / 2;
}

/**
 * Mirrors drags on a pane divider that docking right moved to the pane's left, until `signal`
 * aborts. Primer widens a start pane as the pointer moves right of where the drag began, and
 * GitHub's tree stays a start pane on either side, so each move is replayed reflected about that
 * point.
 */
function mirrorPaneDrag(doc: Document, signal: AbortSignal): void {
  const view = doc.defaultView;
  if (!view) return;
  let origin: number | undefined;
  let replaying = false;
  view.addEventListener(
    "pointerdown",
    (event) => {
      const handle = event.target instanceof Element && dragHandleOf(event.target);
      origin = handle && dividerLeads(handle) ? event.clientX : undefined;
    },
    { capture: true, signal },
  );
  view.addEventListener(
    "pointermove",
    (event) => {
      if (replaying || origin === undefined || !event.buttons || !event.target) return;
      event.stopImmediatePropagation();
      const mirrored = new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: event.pointerId,
        buttons: event.buttons,
        clientX: 2 * origin - event.clientX,
        clientY: event.clientY,
      });
      replaying = true;
      if (!event.target.dispatchEvent(mirrored)) event.preventDefault();
      replaying = false;
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
  page: FilesPage,
  signal: AbortSignal,
  { choice, save }: SideOptions,
): void {
  const toggle = findTreeToggle(page);
  if (!toggle) return;
  const doc = page.sidebar.ownerDocument;
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
  glideTreeToggle(page, toggle, signal);
  mirrorPaneDrag(doc, signal);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    button.remove();
    style.remove();
    delete root.dataset.ghPrismSide;
  });
}
