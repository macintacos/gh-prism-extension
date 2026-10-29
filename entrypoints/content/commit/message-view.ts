/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, or in a sticky column beside the diffs on a wide window, with a switch to its
 * plain text. Its place is held in a loading state from the visit's start, so nothing moves when
 * the rendering lands. GitHub's box stays in the page, hidden and unchanged: it shows again on
 * abort, when the rendering fails, and as the plain text above the diffs; in the column, the plain
 * text is a copy of its contents.
 */

import type { CommitMessageView } from "@/utils/prefs";
import {
  type CommitMessage,
  type FilesPage,
  findCommitColumnRow,
  findCommitMessage,
} from "../files-page";
import { el, icon } from "../ui/dom";
import { type ColumnWidthChoice, columnSeparator, fitsColumn } from "./column-width";
import { renderCommitMessage, withinCaps } from "./message";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./message-view.css?inline";

/**
 * When to render, the tab's view choice for `showCommitMessage` to apply, and how to persist a
 * switch.
 */
export interface CommitMessageOptions {
  /**
   * Runs `task` once the sidebar's sections have drawn, or a second has passed without them,
   * and then once the browser is idle, so the message never holds up the sidebar or the diffs.
   */
  readonly afterSections: (task: () => void) => void;
  readonly choice: CommitMessageChoice;
  /** Remembers a view the switch picked. */
  readonly save: (view: CommitMessageView) => void;
  /** Remembers a width the column was set to. */
  readonly saveWidth: (width: number) => void;
  /** Remembers whether the reader hid this commit's message. */
  readonly saveHidden: (hidden: boolean) => void;
  readonly visit: CommitMessageVisit;
}

/**
 * Which view a commit's message shows, and how wide its column is; one per browser tab, shared by
 * every page in it, so a switch or a resize carries to the next commit.
 */
export interface CommitMessageChoice extends ColumnWidthChoice {
  view: CommitMessageView;
}

/**
 * What every show in one visit to a commit shares, so GitHub re-rendering the page mid-visit
 * neither starts the loading state over nor plays the rendering's entrance again.
 */
export interface CommitMessageVisit {
  /** When the visit began, on the page's `performance.now()` clock. */
  readonly since: number;
  /** The visit's rendering once made, or `"failed"` once it couldn't be. */
  rendered?: Node[] | "failed";
  /** Whether the reader hid this commit's message. */
  hidden: boolean;
}

/**
 * Stands in for a commit page's message box with its rendering, until `signal` aborts, opening in
 * `choice`'s view; its switch records each pick in `choice` and `save`s it. The message's place
 * shows a loading state at once, and the rendering fills it after `afterSections`. Its hide
 * control leaves a way back in the box's place, and records each change in `visit` and
 * `saveHidden`s it. GitHub's box stays as it is on any other page, for a message with only a
 * subject line or past the renderer's caps, while plain text is picked above the diffs, and from
 * the moment the rendering fails.
 */
export function showCommitMessage(
  page: FilesPage,
  signal: AbortSignal,
  { afterSections, choice, save, saveWidth, saveHidden, visit }: CommitMessageOptions,
): void {
  const message = findCommitMessage(page);
  // A subject line alone gains nothing from rendering.
  if (!message?.body || !withinCaps(message) || visit.rendered === "failed") return;
  const doc = page.sidebar.ownerDocument;
  const failed = new AbortController();
  const shown = AbortSignal.any([signal, failed.signal]);
  const elapsed = (doc.defaultView?.performance.now() ?? visit.since) - visit.since;

  const view = messageView(doc, message.box, { choice, save });
  const restore = restoreRow(doc);
  if (visit.rendered) view.fill(visit.rendered, "at once");
  else view.wait(elapsed);
  const place = mountMessage(
    page,
    { box: message.box, container: view.container, restore: restore.row },
    { choice, saveWidth, visit },
    shown,
  );

  const render = () => {
    if (shown.aborted || visit.rendered) return;
    const nodes = renderedOrWarn(doc, findCommitMessage(page) ?? message);
    visit.rendered = nodes ?? "failed";
    if (nodes) view.fill(nodes, "revealed");
    else failed.abort();
  };
  const setHidden = (hidden: boolean) => {
    const [leaving, arriving] = hidden
      ? [view.container, restore.button]
      : [restore.row, view.hide];
    const hadFocus = leaving.contains(doc.activeElement);
    visit.hidden = hidden;
    saveHidden(hidden);
    place();
    if (!hidden) render();
    if (hadFocus) arriving.focus({ preventScroll: true });
  };
  view.hide.addEventListener("click", () => setHidden(true));
  restore.button.addEventListener("click", () => setHidden(false));

  if (!visit.rendered && !visit.hidden) afterSections(render);
}

/** `message`'s rendering, or `undefined`, warning when the renderer throws. */
function renderedOrWarn(doc: Document, message: CommitMessage): Node[] | undefined {
  try {
    return renderCommitMessage(doc, message);
  } catch (error) {
    console.warn("gh-prism: couldn't render the commit message; leaving GitHub's as is", error);
    return undefined;
  }
}

/**
 * Mounts `container`, the message and its controls, in a sticky column at the left of `page`'s
 * layout row on a window with room for it, else just before `box`, or, while `visit` is hidden,
 * `restore` in `box`'s place, following GitHub's re-renders and the window's width, until `signal`
 * aborts. Returns how to place them again once `visit.hidden` changes.
 */
function mountMessage(
  page: FilesPage,
  { box, container, restore }: { box: Element; container: HTMLElement; restore: HTMLElement },
  {
    choice,
    saveWidth,
    visit,
  }: Pick<CommitMessageOptions, "choice" | "saveWidth"> & {
    visit: Pick<CommitMessageVisit, "hidden">;
  },
  signal: AbortSignal,
): () => void {
  const doc = page.sidebar.ownerDocument;
  const win = doc.defaultView;
  const slot = Object.assign(el(doc, "span", "gh-prism-commit-slot"), { hidden: true });
  const column = messageColumn(doc);
  const { separator, size } = columnSeparator(column, { choice, saveWidth });
  column.append(separator);
  // Found once: a new row means a new sidebar, and so a new visit; a row detached before then
  // falls back above the diffs.
  const row = findCommitColumnRow(page);
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  const unmount = () => {
    container.remove();
    slot.remove();
    column.remove();
    restore.remove();
  };
  const moveToRestore = (currentBox: Element) => {
    column.remove();
    container.remove();
    if (slot.nextElementSibling !== currentBox) currentBox.before(slot);
    if (restore.nextElementSibling !== slot) slot.before(restore);
  };
  const moveIntoColumn = (connectedRow: Element, currentBox: Element) => {
    restore.remove();
    if (column.parentElement !== connectedRow) connectedRow.prepend(column);
    if (container.parentElement !== column) column.prepend(container);
    if (slot.nextElementSibling !== currentBox) currentBox.before(slot);
    size();
  };
  const moveAboveDiffs = (currentBox: Element) => {
    column.remove();
    slot.remove();
    restore.remove();
    if (container.nextElementSibling !== currentBox) currentBox.before(container);
  };

  const follow = () => {
    const currentBox = findCommitMessage(page)?.box;
    if (!currentBox) unmount();
    else if (visit.hidden) moveToRestore(currentBox);
    else if (win && fitsColumn(win.innerWidth) && row?.isConnected) {
      moveIntoColumn(row, currentBox);
    } else moveAboveDiffs(currentBox);
  };

  follow();
  doc.head.append(style);

  const observer = new MutationObserver(follow);
  if (box.parentNode) observer.observe(box.parentNode, { childList: true });
  if (row) observer.observe(row, { childList: true });
  win?.addEventListener("resize", follow, { signal });

  signal.addEventListener("abort", () => {
    observer.disconnect();
    unmount();
    style.remove();
  });
  return follow;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): markdown. */
const MARKDOWN =
  "M14.85 3c.63 0 1.15.52 1.14 1.15v7.7c0 .63-.51 1.15-1.15 1.15H1.15C.52 13 0 12.48 0 11.84V4.15C0 3.52.52 3 1.15 3ZM9 11V5H7L5.5 7 4 5H2v6h2V8l1.5 1.92L7 8v3Zm2.99.5L14.5 8H13V5h-2v3H9.5Z";

const LABEL: Record<CommitMessageView, string> = {
  rendered: "Show plain text",
  plaintext: "Show rendered Markdown",
};

/** The message's container, its hide button, and how to fill its body. */
interface MessageView {
  readonly container: HTMLElement;
  readonly hide: HTMLButtonElement;
  /**
   * Shows a skeleton in a loading state, its fade-in and pulse `elapsed` ms along, so a skeleton
   * shown again mid-visit carries on where the last one was.
   */
  readonly wait: (elapsed: number) => void;
  /** Puts `nodes` in the body, fading them in where a skeleton stood when `"revealed"`. */
  readonly fill: (nodes: Node[], entrance: "revealed" | "at once") => void;
}

/**
 * An empty body beside a switch to plain text and a hide button, with a copy of `box`'s children that the column
 * shows as that plain text, returned with `data-view` already set to `choice.view` so a plain-text
 * reader never sees the rendering paint. Each click flips the view, records it in `choice`, and
 * `save`s it.
 */
function messageView(
  doc: Document,
  box: Element,
  { choice, save }: Pick<CommitMessageOptions, "choice" | "save">,
): MessageView {
  const button = iconButton(doc, "gh-prism-commit-view-switch", MARKDOWN);
  const hide = iconButton(doc, "gh-prism-commit-hide", EYE_CLOSED);
  hide.setAttribute("aria-label", "Hide commit message");
  const body = el(
    doc,
    "div",
    "gh-prism-commit-message-body markdown-body tw:flex-1 tw:min-w-0 tw:px-3 tw:py-2",
  );
  const container = el(
    doc,
    "div",
    "gh-prism-commit-message tw:flex tw:items-start tw:justify-end",
    body,
    // Copies the children, not the box: findCommitMessage matches the box's own class.
    el(
      doc,
      "div",
      "gh-prism-commit-message-plain tw:flex-1 tw:min-w-0 tw:px-3 tw:py-2",
      ...[...box.childNodes].map((node) => node.cloneNode(true)),
    ),
    button,
    hide,
  );

  const showView = (view: CommitMessageView) => {
    container.dataset.view = view;
    button.setAttribute("aria-label", LABEL[view]);
  };
  button.addEventListener("click", () => {
    choice.view = choice.view === "rendered" ? "plaintext" : "rendered";
    showView(choice.view);
    save(choice.view);
  });
  const wait = (elapsed: number) => {
    body.replaceChildren(skeleton(doc, elapsed));
    container.setAttribute("aria-busy", "true");
  };
  const fill = (nodes: Node[], entrance: "revealed" | "at once") => {
    const from = container.offsetHeight;
    body.replaceChildren(...nodes);
    container.removeAttribute("aria-busy");
    const still = doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (entrance === "revealed" && !still) reveal(container, body, from);
  };

  showView(choice.view);
  return { container, hide, wait, fill };
}

/** Bars standing in for the title and a paragraph until the rendering lands. */
function skeleton(doc: Document, elapsed: number): HTMLElement {
  const bars = el(
    doc,
    "div",
    "gh-prism-commit-skeleton",
    el(doc, "span", ""),
    el(doc, "span", ""),
    el(doc, "span", ""),
    el(doc, "span", ""),
  );
  bars.style.setProperty("--gh-prism-commit-elapsed", `${Math.round(elapsed)}ms`);
  return bars;
}

// The motion scale's spatial row, as the sections drop in after loading.
const SPATIAL = { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };

/** Fades `body` in where the skeleton stood, easing `container` from `from` px to its height. */
function reveal(container: HTMLElement, body: HTMLElement, from: number): void {
  body.animate({ opacity: [0, 1], transform: ["translateY(-6px)", "none"] }, SPATIAL);
  const to = container.offsetHeight;
  if (to !== from) {
    container.animate({ height: [`${from}px`, `${to}px`], overflow: ["clip", "clip"] }, SPATIAL);
  }
}

/** The sticky column, at the left of GitHub's layout row, holding the message on a wide window. */
function messageColumn(doc: Document): HTMLElement {
  const column = el(
    doc,
    "aside",
    "gh-prism-commit-column tw:sticky tw:top-0 tw:z-1 tw:-order-1 tw:h-screen tw:shrink-0 tw:self-start tw:border-e tw:border-border-default",
  );
  column.setAttribute("aria-label", "Commit message");
  return column;
}

/**
 * Primer's small invisible IconButton, unlabelled, drawing `d`; the switch and the hide button
 * share it, as the side switch does.
 */
function iconButton(doc: Document, name: string, d: string): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "gh-prism-commit-control tw:relative tw:grid tw:shrink-0 tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:mt-2 tw:mr-2 tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, d, {}),
  );
  button.classList.add(name);
  button.type = "button";
  return button;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): eye. */
const EYE =
  "M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.825.742-3.955 1.715-1.124.967-1.954 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): eye-closed. */
const EYE_CLOSED =
  "M.143 2.31a.75.75 0 0 1 1.047-.167l14.5 10.5a.75.75 0 1 1-.88 1.214l-2.248-1.628C11.346 13.19 9.792 14 8 14c-1.981 0-3.67-.992-4.933-2.078C1.797 10.832.88 9.577.43 8.9a1.619 1.619 0 0 1 0-1.797c.353-.533.995-1.42 1.868-2.305L.31 3.357A.75.75 0 0 1 .143 2.31Zm1.536 5.622A.12.12 0 0 0 1.657 8c0 .021.006.045.022.068.412.621 1.242 1.75 2.366 2.717C5.175 11.758 6.527 12.5 8 12.5c1.195 0 2.31-.488 3.29-1.191L9.063 9.695A2 2 0 0 1 6.058 7.52L3.529 5.688a14.207 14.207 0 0 0-1.85 2.244ZM8 3.5c-.516 0-1.017.09-1.499.251a.75.75 0 1 1-.473-1.423A6.207 6.207 0 0 1 8 2c1.981 0 3.67.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.11.166-.248.365-.41.587a.75.75 0 1 1-1.21-.887c.148-.201.272-.382.371-.53a.119.119 0 0 0 0-.137c-.412-.621-1.242-1.75-2.366-2.717C10.825 4.242 9.473 3.5 8 3.5Z";

/**
 * The row standing in GitHub's box's place while the message is hidden, holding Primer's small
 * invisible Button that shows it again.
 */
function restoreRow(doc: Document): { row: HTMLElement; button: HTMLButtonElement } {
  const button = el(
    doc,
    "button",
    "gh-prism-commit-show tw:inline-flex tw:items-center tw:gap-2 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-fgColor-rest)] tw:[font-family:inherit] tw:text-body-small tw:font-medium tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, EYE, {}),
    "Show commit message",
  );
  button.type = "button";
  // Ruled off as GitHub's box is, from the card's next row.
  const row = el(
    doc,
    "div",
    "gh-prism-commit-restore tw:flex tw:p-2 tw:border-b tw:border-border-default",
    button,
  );
  return { row, button };
}
