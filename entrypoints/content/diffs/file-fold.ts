/**
 * Folds a file's diff shut into its header as its chevron collapses it, and open out of the header
 * as the chevron expands it, with the chevron turning along.
 */

import {
  expandButtonOf,
  expandedDiff,
  type FilesPage,
  fileHeaderAt,
  findDiff,
} from "../files-page";
import { foldFrames } from "../ui/fold";

// The motion scale's "State, opening" and "State, closing" rows.
const OPENING: KeyframeAnimationOptions = {
  duration: 240,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};
const CLOSING: KeyframeAnimationOptions = { duration: 160, easing: "ease-out", fill: "both" };

// Turned a quarter back, chevron-down points where chevron-right does.
const DOWN: Keyframe = { transform: "none" };
const RIGHT: Keyframe = { transform: "rotate(-90deg)" };

/**
 * Folds each file of `page` as a click on its chevron collapses or expands it, until `signal`
 * aborts. GitHub drops a collapsing diff at once, so the click reaches GitHub only once the diff
 * has folded shut; a second click meanwhile turns the fold around and keeps the file open.
 */
export function foldFiles(page: FilesPage, signal: AbortSignal): void {
  const win = page.diffs.ownerDocument.defaultView;
  if (!win) return;
  // Each closing fold's animations, by its file's diff, until the fold ends.
  const closing = new Map<Element, readonly Animation[]>();
  let passing = false;

  const onClick = (event: Event) => {
    const chevron = passing ? undefined : chevronClicked(event);
    if (!chevron || win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const diff = findDiff(page, chevron.link);
    if (!diff) return;

    const folding = closing.get(diff);
    if (folding) {
      event.stopPropagation();
      for (const animation of folding) animation.reverse();
      return;
    }
    if (expandButtonOf(diff)) {
      win.requestAnimationFrame(() => foldOpen(win, diff, chevron.button));
      return;
    }

    const fold = foldShut(win, diff, chevron.button);
    if (!fold) return;
    event.stopPropagation();
    closing.set(diff, fold);
    const end = () => {
      closing.delete(diff);
      // Turned around, the fold ends where it began, and the file stays open.
      if (fold.every((animation) => animation.playbackRate > 0) && !signal.aborted) {
        passing = true;
        chevron.button.click();
        passing = false;
      }
      for (const animation of fold) animation.cancel();
    };
    void Promise.all(fold.map((animation) => animation.finished)).then(end, () =>
      closing.delete(diff),
    );
  };

  page.diffs.addEventListener("click", onClick, { capture: true, signal });
}

/** The chevron `event` clicked, with its file's path link, unless Alt asks GitHub for every file. */
function chevronClicked(
  event: Event,
): { button: HTMLButtonElement; link: HTMLAnchorElement } | undefined {
  if (event instanceof MouseEvent && event.altKey) return undefined;
  const { target } = event;
  if (!(target instanceof Element)) return undefined;
  const header = fileHeaderAt(target);
  return header?.chevron.contains(target)
    ? { button: header.chevron, link: header.link }
    : undefined;
}

/** Starts shutting `diff`'s body up into its header, its chevron turning closed. */
function foldShut(win: Window, diff: Element, chevron: Element): Animation[] | undefined {
  const header = diff.firstElementChild;
  const body = expandedDiff(diff)?.lastElementChild;
  if (!header || !body) return undefined;

  const turn = chevron.querySelector("svg")?.animate([DOWN, RIGHT], CLOSING);
  return [body.animate(shutFrames(win, header, body), CLOSING), ...(turn ? [turn] : [])];
}

/**
 * Keyframes that shut `body` up into `header`: a fold, so what follows rises with its edge; or,
 * while the header is stuck over the body, a clip up to the header, since a fold would carry the
 * header off with it. GitHub then scrolls the header back to where it stuck.
 */
function shutFrames(win: Window, header: Element, body: Element): Keyframe[] {
  const { top, height } = body.getBoundingClientRect();
  const headerBottom = header.getBoundingClientRect().bottom;
  if (top >= headerBottom - 1) {
    const { open, shut } = foldFrames(win, body, onScreenHeight(win, body));
    return [open, shut];
  }
  const clipBelow = (edge: number) => `inset(0 0 ${Math.max(0, top + height - edge)}px 0)`;
  return [{ clipPath: clipBelow(win.innerHeight) }, { clipPath: clipBelow(headerBottom) }];
}

/** Folds open the body GitHub gave `diff` as it expanded, its new chevron turning open. */
function foldOpen(win: Window, diff: Element, chevron: Element): void {
  const body = expandedDiff(diff)?.lastElementChild;
  if (!body) return;
  const { open, shut } = foldFrames(win, body, onScreenHeight(win, body));
  body.animate([shut, open], OPENING);
  chevron.querySelector("svg")?.animate([RIGHT, DOWN], OPENING);
}

/** How much of `part` the window shows below its top: all a fold needs to move. */
function onScreenHeight(win: Window, part: Element): number {
  const { top, height } = part.getBoundingClientRect();
  return Math.min(height, Math.max(0, win.innerHeight - top));
}
