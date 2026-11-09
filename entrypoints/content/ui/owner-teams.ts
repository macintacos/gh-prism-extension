/**
 * "N teams": a button counting the teams that make someone a code owner, which opens their
 * identities as a small card in the top layer. Its styles live in `ui/owner-identity.css`, which
 * every host of owner identities already imports.
 */

import { codeOwnerOf } from "@/utils/github/code-owners";
import { el, icon, TRIANGLE_DOWN_ICON } from "./dom";
import { CLOSE_DELAY_MS, OPEN_DELAY_MS } from "./hover-intent";
import { type OwnerIdentities, ownerIdentity } from "./owner-identity";
import { place } from "./place";

/**
 * A button counting `teams` that opens their identities, drawn by `identities`, as a card: on the
 * hover card's timing, at once on keyboard focus, and pinned open by a click. The card lives
 * inside the button's host, the nearest dialog or popover, so it goes with it, and pointer or
 * focus inside it counts as inside the host.
 */
export function ownerTeams(
  doc: Document,
  teams: readonly string[],
  identities: OwnerIdentities,
): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "gh-prism-owner-teams",
    el(doc, "span", "gh-prism-owner-name", `${teams.length} teams`),
    icon(doc, TRIANGLE_DOWN_ICON, {}),
  );
  button.type = "button";
  const list = teamsList(doc, teams, identities);
  button.setAttribute("aria-controls", list.id);
  followDisclosure(button, list);
  return button;
}

/** `teams`' identities, one per line, as a hidden manual popover. */
function teamsList(
  doc: Document,
  teams: readonly string[],
  identities: OwnerIdentities,
): HTMLElement {
  const list = el(
    doc,
    "ul",
    "gh-prism-owner-teams-list",
    ...teams.map((team) => el(doc, "li", "", ownerIdentity(doc, codeOwnerOf(team), identities))),
  );
  // A host holds one "N teams", so its teams make a unique id.
  list.id = `gh-prism-owner-teams-${teams.join("-").replace(/[^\w-]/g, "-")}`;
  list.popover = "manual";
  return list;
}

/**
 * Opens `list` below `button` 200 ms after the pointer rests on it, at once on keyboard focus or a
 * click; a click pins it open, and a click on a pinned list closes it. It closes 150 ms after the
 * pointer leaves both, at once when focus leaves both, on a scroll outside it, and on Escape,
 * which goes no further.
 */
function followDisclosure(button: HTMLButtonElement, list: HTMLElement): void {
  const doc = button.ownerDocument;
  button.setAttribute("aria-expanded", "false");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scrolls: AbortController | undefined;
  let pinned = false;
  // A pointer press or a handback focuses the button without meaning to open it.
  let quietFocus = false;
  const isOpen = () => button.getAttribute("aria-expanded") === "true";
  const inside = (target: EventTarget | null) =>
    target instanceof Node && (button.contains(target) || list.contains(target));

  const open = () => {
    clearTimeout(timer);
    if (isOpen() || !button.isConnected) return;
    (button.closest("dialog, [popover]") ?? doc.body).append(list);
    list.showPopover({ source: button });
    place(list, button.getBoundingClientRect());
    button.setAttribute("aria-expanded", "true");
    scrolls = new AbortController();
    // Capture: scroll events don't bubble.
    doc.addEventListener(
      "scroll",
      ({ target }) => {
        if (!(target instanceof Node && list.contains(target))) close();
      },
      { capture: true, signal: scrolls.signal },
    );
  };
  const close = () => {
    clearTimeout(timer);
    scrolls?.abort();
    pinned = false;
    if (!isOpen()) return;
    // Hidden while it holds focus, it would drop focus to the body, closing a popup around it.
    if (list.contains(doc.activeElement)) {
      quietFocus = true;
      button.focus({ preventScroll: true });
      quietFocus = false;
    }
    if (list.isConnected) list.hidePopover();
    button.setAttribute("aria-expanded", "false");
  };
  const after = (delay: number, act: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(act, delay);
  };

  button.addEventListener("pointerdown", () => (quietFocus = true));
  button.addEventListener("focus", () => {
    if (!quietFocus) open();
    quietFocus = false;
  });
  button.addEventListener("click", () => {
    quietFocus = false;
    if (pinned) return close();
    open();
    pinned = true;
  });
  const parts: HTMLElement[] = [button, list];
  for (const part of parts) {
    part.addEventListener("pointerover", ({ relatedTarget }) => {
      if (inside(relatedTarget)) return;
      if (isOpen()) clearTimeout(timer);
      else if (part === button) after(OPEN_DELAY_MS, open);
    });
    part.addEventListener("pointerout", ({ relatedTarget }) => {
      if (inside(relatedTarget)) return;
      if (isOpen()) after(CLOSE_DELAY_MS, close);
      else clearTimeout(timer);
    });
    part.addEventListener("focusout", ({ relatedTarget }) => {
      if (!inside(relatedTarget)) close();
    });
    part.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isOpen()) return;
      // Ahead of the popup's and the dialog's own Escape.
      event.preventDefault();
      event.stopPropagation();
      close();
    });
  }
}
