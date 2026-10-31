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
import { glide, glides } from "../ui/glide";
import { keycap } from "../ui/keycap";
import { toggleKeyOf } from "../ui/toggle-keys";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./side.css?inline";

export type { Side };

/** Which side the sidebar docks on. One per tab, so the choice carries to the next page. */
export interface SideChoice {
  side: Side;
}

/** The tab's side choice for `dockSidebar` to apply, and how to persist a switch. */
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

/**
 * Clicks the shown one of GitHub's tree toggles on `\`, as a reviewer's click would, so the
 * glide and GitHub's handler both run, until `signal` aborts. Names the key on each toggle, an
 * attribute React doesn't own.
 */
function followTreeKey(page: FilesPage, toggle: Element, signal: AbortSignal): void {
  const doc = page.sidebar.ownerDocument;
  const buttons = () => [...toggle.querySelectorAll<HTMLElement>("button")];
  for (const button of buttons()) button.setAttribute("aria-keyshortcuts", "\\");

  doc.addEventListener(
    "keydown",
    (event) => {
      if (toggleKeyOf(event) !== "\\") return;
      // The regular toggle first: the narrow layout hides it and shows its overlay toggle instead.
      const shown = buttons()
        .sort(
          (a, b) =>
            Number(b.matches(page.kind.treeToggleButton)) -
            Number(a.matches(page.kind.treeToggleButton)),
        )
        .find((button) => getComputedStyle(button).display !== "none");
      if (!shown) return;
      event.preventDefault();
      // GitHub then focuses its toggle by script, which inherits this focus's lack of a ring.
      shown.focus({ focusVisible: false });
      shown.click();
    },
    { capture: true, signal },
  );
  signal.addEventListener("abort", () => {
    for (const button of buttons()) button.removeAttribute("aria-keyshortcuts");
  });
}

/** Whether a Primer start pane's divider sits at the pane's left, where only docking right puts it. */
function dividerLeads(handle: Element): boolean {
  const wrapper = startPaneOf(handle);
  if (!wrapper) return false;
  const { left, width } = wrapper.getBoundingClientRect();
  return handle.getBoundingClientRect().left < left + width / 2;
}

/** A copy of `event`, the pointer reflected about `origin` on the x axis. */
const mirroredMove = (event: PointerEvent, origin: number): PointerEvent =>
  new PointerEvent("pointermove", {
    bubbles: true,
    cancelable: true,
    pointerId: event.pointerId,
    buttons: event.buttons,
    clientX: 2 * origin - event.clientX,
    clientY: event.clientY,
  });

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
      replaying = true;
      if (!event.target.dispatchEvent(mirroredMove(event, origin))) event.preventDefault();
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

  // Primer's small invisible IconButton, like GitHub's tree toggle beside it.
  const button = el(
    doc,
    "button",
    "gh-prism-side-switch tw:relative tw:shrink-0 tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, ARROW_SWITCH, {}),
  );
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

  const cap = keycap(doc, "\\", { shift: false });
  cap.classList.add("gh-prism-tree-key");

  // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier switch.
  for (const stale of doc.querySelectorAll(".gh-prism-side-switch, .gh-prism-tree-key"))
    stale.remove();
  dock(choice.side);
  toggle.after(cap, button);
  glideTreeToggle(page, toggle, signal);
  followTreeKey(page, toggle, signal);
  mirrorPaneDrag(doc, signal);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    button.remove();
    cap.remove();
    style.remove();
    delete root.dataset.ghPrismSide;
  });
}
