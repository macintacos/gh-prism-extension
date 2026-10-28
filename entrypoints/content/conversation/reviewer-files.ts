/** The popup a reviewer's code-owner shield opens on the Conversation tab, listing their files. */

import { ownerFilter, type PrCodeOwners } from "@/utils/github/code-owners";
import { REVIEWER_SHIELD, shieldOwner } from "../files-page";
import { el } from "../ui/dom";
import { place } from "../ui/place";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./reviewer-files.css?inline";

const ID = "gh-prism-reviewer-files";
// Longer than GitHub's hovercard takes to close, so its card and this never show together.
const OPEN_DELAY_MS = 200;
// Time to carry the pointer from the shield into the popup.
const CLOSE_DELAY_MS = 150;

interface Open {
  readonly shield: Element;
  readonly popover: HTMLElement;
  readonly closed: AbortController;
}

/**
 * While a pull request's Conversation sidebar shows a code-owner shield hovered or focused, shows a
 * popup below it listing the changed files that reviewer owns, until `signal` aborts.
 */
export function showReviewerFiles(
  doc: Document,
  signal: AbortSignal,
  codeOwners: () => Promise<PrCodeOwners | undefined>,
): void {
  let open: Open | undefined;
  let opening: ReturnType<typeof setTimeout> | undefined;
  let closing: ReturnType<typeof setTimeout> | undefined;
  // Bumped by every open or cancel, so a read that settles late opens nothing stale.
  let attempt = 0;

  const shieldAt = (target: EventTarget | null) =>
    target instanceof Element ? target.closest(REVIEWER_SHIELD) : null;
  const inOpen = (target: EventTarget | null) =>
    !!open &&
    target instanceof Node &&
    (open.shield.contains(target) || open.popover.contains(target));

  const cancelOpen = () => {
    clearTimeout(opening);
    attempt++;
  };
  const close = () => {
    clearTimeout(closing);
    if (!open) return;
    open.closed.abort();
    open.popover.remove();
    open.shield.removeAttribute("aria-describedby");
    open = undefined;
  };
  const closeSoon = () => {
    clearTimeout(closing);
    closing = setTimeout(close, CLOSE_DELAY_MS);
  };

  const openAfter = (shield: Element, delay: number) => {
    cancelOpen();
    const mine = attempt;
    const read = codeOwners();
    opening = setTimeout(async () => {
      const owners = await read;
      if (mine !== attempt || !owners) return;
      // ponytail: exact-token match, so a user shielded only through a team lists nothing; upgrade by resolving team membership.
      const paths = [...owners.keys()].filter(ownerFilter(owners, shieldOwner(shield)));
      if (paths.length === 0) return;
      close();
      open = show(doc, shield, paths, close);
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
    ({ target }) => {
      if (inOpen(target)) return clearTimeout(closing);
      const shield = shieldAt(target);
      if (shield) openAfter(shield, OPEN_DELAY_MS);
    },
    { signal },
  );
  doc.addEventListener(
    "pointerout",
    ({ target, relatedTarget }) => {
      const shield = shieldAt(target);
      if (shield && !(relatedTarget instanceof Node && shield.contains(relatedTarget)))
        cancelOpen();
      if (inOpen(target) && !inOpen(relatedTarget)) closeSoon();
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

/** Shows the popup listing `paths` below `shield`, closing through `close` on a scroll outside it. */
function show(doc: Document, shield: Element, paths: readonly string[], close: () => void): Open {
  const files = paths.length === 1 ? "1 file" : `${paths.length} files`;
  const popover = el(
    doc,
    "div",
    "gh-prism-reviewer-files tw:inset-auto tw:m-0 tw:w-max tw:max-w-[360px] tw:max-h-[min(320px,calc(100vh-16px))] tw:overflow-y-auto tw:p-4 tw:text-body-medium tw:leading-body-medium tw:text-fg-default tw:bg-[var(--overlay-bgColor,var(--bgColor-default))] tw:border tw:border-border-default tw:rounded-medium tw:wrap-anywhere",
    el(doc, "p", "tw:m-0 tw:mb-2 tw:font-semibold", `Code owner of ${files} in this pull request`),
    el(
      doc,
      "ul",
      "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1 tw:text-body-small tw:leading-body-small tw:[font-family:var(--fontStack-monospace)]",
      ...paths.map((path) => el(doc, "li", "", ...pathParts(doc, path))),
    ),
  );
  popover.id = ID;
  popover.popover = "manual";
  doc.body.append(popover);
  popover.showPopover({ source: shield as HTMLElement });
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
  return { shield, popover, closed };
}

/** `path` as a muted directory and its file name. */
function pathParts(doc: Document, path: string): (Node | string)[] {
  const cut = path.lastIndexOf("/") + 1;
  return cut === 0
    ? [path]
    : [el(doc, "span", "tw:text-fg-muted", path.slice(0, cut)), path.slice(cut)];
}
