/** The popup a code-owner shield opens on the Conversation tab, listing that code owner's files. */

import { ownerFilter, type PrCodeOwners } from "@/utils/github/code-owners";
import { reviewerShieldOf, shieldOwner } from "../files-page";
import { el } from "../ui/dom";
import { place } from "../ui/place";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./reviewer-files.css?inline";

const ID = "gh-prism-reviewer-files";
// GitHub's hovercard closes 110–130 ms after the pointer leaves; wait longer, so the two never show
// together.
const OPEN_DELAY_MS = 200;
// Time to carry the pointer from the shield into the popup.
const CLOSE_DELAY_MS = 150;

interface OpenPopup {
  readonly shield: HTMLElement;
  readonly popover: HTMLElement;
  /** Removes the popup, its listeners, and the shield's description. */
  readonly dispose: () => void;
}

/**
 * Until `signal` aborts, opens a popup below a code-owner shield in a pull request's Reviewers
 * sidebar, 200 ms after the pointer rests on it or at once on focus, listing the changed files
 * that code owner owns, and describes the shield with it. Mounts a stylesheet in `doc`'s head.
 * Opens nothing when `readOwners` resolves `undefined` or the owner owns no changed file. Closes
 * 150 ms after the pointer leaves shield and popup, and at once on Escape, focus leaving the
 * shield, or a scroll outside it. Calls `readOwners` at most once, on the first hover or focus.
 */
export function showReviewerFiles(
  doc: Document,
  signal: AbortSignal,
  readOwners: () => Promise<PrCodeOwners | undefined>,
): void {
  let ownersRead: Promise<PrCodeOwners | undefined> | undefined;
  const readOwnersOnce = () => (ownersRead ??= readOwners());
  let open: OpenPopup | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  // Bumped by every open or cancel, so a read that settles late opens nothing stale.
  let attempt = 0;

  const shieldAt = (target: EventTarget | null) =>
    target instanceof Element ? reviewerShieldOf(target) : null;
  const inOpenPopup = (target: EventTarget | null) =>
    !!open &&
    target instanceof Node &&
    (open.shield.contains(target) || open.popover.contains(target));

  const cancelOpen = () => {
    clearTimeout(openTimer);
    attempt++;
  };
  const close = () => {
    clearTimeout(closeTimer);
    open?.dispose();
    open = undefined;
  };
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, CLOSE_DELAY_MS);
  };

  const openAfter = (shield: HTMLElement, delay: number) => {
    if (open?.shield === shield) return;
    cancelOpen();
    const thisAttempt = attempt;
    const read = readOwnersOnce();
    openTimer = setTimeout(async () => {
      const owners = await read;
      if (thisAttempt !== attempt || !owners) return;
      // ponytail: exact-token match, so a user shielded only through a team lists nothing;
      // upgrade by resolving team membership.
      const paths = [...owners.keys()].filter(ownerFilter(owners, shieldOwner(shield), []));
      if (paths.length === 0) return;
      close();
      open = show(shield, paths, close);
    }, delay);
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    cancelOpen();
    close();
    style.remove();
  });

  doc.addEventListener(
    "pointerover",
    ({ target, relatedTarget }) => {
      if (inOpenPopup(target)) {
        clearTimeout(closeTimer);
        return;
      }
      const shield = shieldAt(target);
      if (shield && !(relatedTarget instanceof Node && shield.contains(relatedTarget)))
        openAfter(shield, OPEN_DELAY_MS);
    },
    { signal },
  );
  doc.addEventListener(
    "pointerout",
    ({ target, relatedTarget }) => {
      const shield = shieldAt(target);
      if (shield && !(relatedTarget instanceof Node && shield.contains(relatedTarget)))
        cancelOpen();
      if (inOpenPopup(target) && !inOpenPopup(relatedTarget)) closeSoon();
    },
    { signal },
  );
  doc.addEventListener(
    "focusin",
    ({ target }) => {
      const shield = shieldAt(target);
      if (shield) openAfter(shield, 0);
    },
    { signal },
  );
  doc.addEventListener(
    "focusout",
    ({ target }) => {
      if (!shieldAt(target)) return;
      cancelOpen();
      if (open?.shield === target) close();
    },
    { signal },
  );
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      cancelOpen();
      close();
    },
    { signal },
  );
}

/**
 * Shows the popup listing `paths` below `shield` and names it as `shield`'s description, closing
 * through `close` on a scroll outside it.
 */
function show(shield: HTMLElement, paths: readonly string[], close: () => void): OpenPopup {
  const doc = shield.ownerDocument;
  const files = paths.length === 1 ? "1 file" : `${paths.length} files`;
  const popover = el(
    doc,
    "div",
    "gh-prism-reviewer-files tw:inset-auto tw:m-0 tw:w-max tw:max-w-[360px] tw:max-h-[min(320px,calc(100vh-16px))] tw:overflow-y-auto tw:p-4 tw:text-body-medium tw:leading-body-medium tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:border tw:border-border-default tw:rounded-medium tw:wrap-anywhere",
    el(doc, "p", "tw:mt-0 tw:mb-2 tw:font-semibold", `Code owner of ${files} in this pull request`),
    el(
      doc,
      "ul",
      "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1 tw:text-body-small tw:leading-body-small tw:font-mono",
      ...paths.map((path) => el(doc, "li", "", ...pathParts(doc, path))),
    ),
  );
  popover.id = ID;
  popover.popover = "manual";
  doc.body.append(popover);
  popover.showPopover();
  place(popover, shield.getBoundingClientRect());
  shield.setAttribute("aria-describedby", ID);

  const closed = new AbortController();
  // Capture: scroll events don't bubble.
  doc.addEventListener(
    "scroll",
    ({ target }) => {
      if (!(target instanceof Node && popover.contains(target))) close();
    },
    { capture: true, signal: closed.signal },
  );
  return {
    shield,
    popover,
    dispose: () => {
      closed.abort();
      popover.remove();
      shield.removeAttribute("aria-describedby");
    },
  };
}

/** `path` as a muted directory and its file name. */
function pathParts(doc: Document, path: string): (Node | string)[] {
  const nameStart = path.lastIndexOf("/") + 1;
  return nameStart === 0
    ? [path]
    : [el(doc, "span", "tw:text-fg-muted", path.slice(0, nameStart)), path.slice(nameStart)];
}
