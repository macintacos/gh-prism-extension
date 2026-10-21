import { vi } from "vitest";
import { showSections } from "../../entrypoints/content/sidebar/sections-view";
import type { IntentResult, Placement } from "../../utils/intent/read";
import { byId } from "./files-page";
import { landedWith } from "./intent";
import { afterDebounce, treeHost } from "./visit";

/**
 * Makes happy-dom's ShadowRoot.activeElement, which throws when focus sits in another shadow
 * root, return null, which is exactly the answer then.
 */
export function patchShadowActiveElement(): void {
  const shadowActiveElement = Object.getOwnPropertyDescriptor(
    ShadowRoot.prototype,
    "activeElement",
  );
  Object.defineProperty(ShadowRoot.prototype, "activeElement", {
    configurable: true,
    get(this: ShadowRoot) {
      try {
        return shadowActiveElement?.get?.call(this) ?? null;
      } catch {
        return null;
      }
    },
  });
}

/**
 * Tells the mounted sidebar which files GitHub shows as Viewed. The test file must mock
 * `showSections` with a spy.
 */
export const viewed = (...paths: string[]) => {
  const sidebar = vi.mocked(showSections).mock.results.at(-1)?.value;
  if (!sidebar) throw new Error("no sidebar mounted");
  sidebar.viewed(new Set(paths));
};

/** Tells the mounted sidebar which files are on screen. The test file must mock `showSections`. */
export const onScreen = (...paths: string[]): void => {
  const sidebar = vi.mocked(showSections).mock.results.at(-1)?.value;
  if (!sidebar) throw new Error("no sidebar mounted");
  sidebar.onScreen(new Set(paths));
};

/** Whether the sidebar lights `element`: a hairline piece or a top-level row's edge. */
export const lit = (element: Element): boolean =>
  getComputedStyle(element).getPropertyValue("--gh-prism-lit").trim() === "1";

/** Where `rowIn` and its kin look for Docs & Comments' comment-lines sub-section. */
export const COMMENT_LINES = "comment-lines";

/** Docs & Comments' comment-lines sub-section, or `null` when the sidebar shows none. */
export const commentLinesRoot = () =>
  document.querySelector<HTMLElement>(
    '.gh-prism-section[data-section="docs"] .gh-prism-comment-lines',
  );

/** The tree host of `listing`, a section's key or `COMMENT_LINES`; throws when there is none. */
export function hostOf(listing: string): HTMLElement {
  if (listing !== COMMENT_LINES) return treeHost(listing);
  const host = commentLinesRoot()?.querySelector<HTMLElement>(".gh-prism-tree");
  if (!host) throw new Error("no comment-lines tree");
  return host;
}

export const rowsOf = (listing: string) => [
  ...(hostOf(listing).shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
];

export function rowIn(listing: string, path: string): HTMLElement {
  const found = rowsOf(listing).find((row) => row.dataset.itemPath === path);
  if (!found) throw new Error(`${listing} has no row for ${path}`);
  return found;
}

export const partsOf = (listing: string, path: string) => [
  ...rowIn(listing, path).querySelectorAll<HTMLElement>(
    '[data-item-section="decoration"] > span > span',
  ),
];

export const partTexts = (listing: string, path: string) =>
  partsOf(listing, path).map((part) => part.textContent);

export const decorationTitle = (listing: string, path: string) =>
  rowIn(listing, path)
    .querySelector('[data-item-section="decoration"] > span')
    ?.getAttribute("title") ?? "";

export const nativeLink = (path: string) => {
  const link = byId(path).querySelector('a[href^="#diff-"]');
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no native link for ${path}`);
  return link;
};

/** Clicks `target` as a user would: the event crosses out of the tree's shadow root. */
export const clickAt = (target: Element, init: MouseEventInit = {}) => {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

/**
 * Presses `key` on `target` as a browser does: a button whose keydown goes unhandled clicks,
 * on keydown for Enter and on keyup for Space.
 */
export function press(target: Element, key: "Enter" | " " | "End"): void {
  const init = { key, bubbles: true, cancelable: true, composed: true };
  const activates =
    target.dispatchEvent(new KeyboardEvent("keydown", init)) && target instanceof HTMLButtonElement;
  if (activates && key === "Enter") clickAt(target, { detail: 0 });
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  if (activates && key === " ") clickAt(target, { detail: 0 });
}

/** Sets `path`'s native comment count to `count`, as GitHub does, and waits out the debounce. */
export async function setCommentCount(path: string, count: number): Promise<void> {
  const native = byId(path);
  const counter = native.querySelector(".octicon-comment + div");
  if (!counter) throw new Error(`fixture has no comment count for ${path}`);
  counter.textContent = String(count);
  native.setAttribute("aria-label", `${path.split("/").at(-1)} has ${count} comments`);
  await afterDebounce();
}

export function sectionToggle(section: string): HTMLButtonElement {
  const toggle = document.querySelector(`.gh-prism-section[data-section="${section}"] h3 button`);
  if (!(toggle instanceof HTMLButtonElement)) throw new Error(`${section} has no header button`);
  return toggle;
}

/** What `section`'s header button shows and hides. */
export function filesOf(section: string): HTMLElement {
  const files = document.getElementById(sectionToggle(section).getAttribute("aria-controls") ?? "");
  if (!files) throw new Error(`${section}'s header button controls nothing`);
  return files;
}

export function commentLinesToggle(): HTMLButtonElement {
  const toggle = commentLinesRoot()?.querySelector("h4 button");
  if (!(toggle instanceof HTMLButtonElement))
    throw new Error("no comment-lines sub-section header button");
  return toggle;
}

/** The count in `toggle`'s header: the file count, or `N/M` once a file is viewed. */
export const countIn = (toggle: Element) => {
  const counter = toggle.querySelector(".gh-prism-counter");
  return (counter?.querySelector('[aria-hidden="true"]') ?? counter)?.textContent;
};

/** engine.rs and parser.rs, whole in Implementation, with +3 −1 and +2 −0 comment lines. */
export const withCommentLines = (): IntentResult =>
  landedWith(
    new Map(),
    new Map([
      ["src/engine.rs", { added: 9, removed: 3 }],
      ["src/parser.rs", { added: 4, removed: 0 }],
    ]),
    new Map([
      ["src/engine.rs", { added: 3, removed: 1 }],
      ["src/parser.rs", { added: 2, removed: 0 }],
    ]),
  );

/** render.rs split between implementation, with `implementationHunks`, and docs. */
export const renderSplitPlacements = (
  implementationHunks: readonly ({ first: number; last: number } | undefined)[],
): ReadonlyMap<string, Placement> =>
  new Map([
    [
      "src/render.rs",
      {
        kind: "split",
        shares: [
          {
            section: "implementation",
            hunks: implementationHunks,
            lines: { added: 5, removed: 1 },
          },
          {
            section: "docs",
            hunks: [undefined, { first: 22, last: 28 }],
            lines: { added: 3, removed: 1 },
          },
        ],
      },
    ],
  ]);

export const renderSplit = (
  implementationHunks: readonly ({ first: number; last: number } | undefined)[],
): IntentResult => landedWith(renderSplitPlacements(implementationHunks));
