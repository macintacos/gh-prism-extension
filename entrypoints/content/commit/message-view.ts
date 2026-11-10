/**
 * Shows a commit page's message rendered as GitHub-flavored Markdown in place of GitHub's
 * preformatted box, or in a sticky column beside the diffs on a wide window, with a switch to its
 * plain text. Its place is held in a loading state from the visit's start, so nothing moves when
 * the rendering lands. A toggle in the diffs' toolbar hides it and shows it again, sliding it out
 * of and into its place. GitHub's box stays in the page, hidden and unchanged: it shows again on
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
import { type ColumnWidthChoice, columnSeparator, fitsColumn } from "../ui/column-width";
import { el, icon } from "../ui/dom";
import { prismMark } from "../ui/mark";
import { renderCommitMessage, withinCaps } from "./message";
import { showMessageToggle } from "./message-toggle";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./message-view.css?inline";
import { badgeSubject } from "./subject-badge";

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
 * shows a loading state at once, and the rendering fills it after `afterSections`. A toggle
 * starting the diffs' toolbar, which Shift+\ presses, hides the message and shows it again, and
 * records each change in `visit` and `saveHidden`s it. GitHub's box stays as it is on any other
 * page, for a message with only a subject line, whose title gains only its conventional commit
 * badge, or past the renderer's caps, while plain text is picked above the diffs, and from the
 * moment the rendering fails.
 */
export function showCommitMessage(
  page: FilesPage,
  signal: AbortSignal,
  options: CommitMessageOptions,
): void {
  const message = findCommitMessage(page);
  if (message) {
    standIn(page, message, signal, options);
    return;
  }
  // GitHub may commit the card after the page; the skeleton's moment has passed by then.
  options.afterSections(() => {
    const late = findCommitMessage(page);
    if (late && !signal.aborted) {
      standIn(page, late, signal, { ...options, afterSections: (task) => task() });
    }
  });
}

function standIn(
  page: FilesPage,
  message: CommitMessage,
  signal: AbortSignal,
  { afterSections, choice, save, saveWidth, saveHidden, visit }: CommitMessageOptions,
): void {
  // A subject line alone gains nothing from rendering.
  if (!message.body) {
    badgeSubject(page, signal);
    return;
  }
  if (!withinCaps(message) || visit.rendered === "failed") return;
  const doc = page.sidebar.ownerDocument;
  const failed = new AbortController();
  const shown = AbortSignal.any([signal, failed.signal]);
  const elapsed = (doc.defaultView?.performance.now() ?? visit.since) - visit.since;

  const view = messageView(doc, message.box, { choice, save });
  const toggle = showMessageToggle(page, shown, view.container.id);
  // Without the toggle nothing could bring a hidden message back, so it shows.
  const hidden = () => visit.hidden && toggle !== undefined;
  if (visit.rendered) view.fill(visit.rendered, "at once");
  else view.wait(elapsed, bodyLines(message.body));
  const place = mountMessage(
    page,
    { box: message.box, container: view.container },
    { choice, saveWidth, hidden },
    shown,
  );

  const render = (entrance: "revealed" | "at once") => {
    if (shown.aborted || visit.rendered || hidden()) return;
    const nodes = renderedOrWarn(doc, findCommitMessage(page) ?? message);
    visit.rendered = nodes ?? "failed";
    if (nodes) view.fill(nodes, entrance);
    else failed.abort();
  };
  const flip = () => {
    const heldFocus = place.holdsFocus();
    visit.hidden = !visit.hidden;
    saveHidden(visit.hidden);
    showExpanded();
    // Rendered before it slides in, so one motion brings it back.
    render("at once");
    if (shown.aborted) return;
    place.slide();
    if (heldFocus) toggle?.focus({ focusVisible: false });
  };
  const showExpanded = () => toggle?.setAttribute("aria-expanded", String(!hidden()));

  showExpanded();
  toggle?.addEventListener("click", flip);

  if (!visit.rendered && !hidden()) afterSections(() => render("revealed"));
}

/** How many of `body`'s lines hold text, up to the skeleton's three. */
const bodyLines = (body: Element): number =>
  Math.min(3, (body.textContent ?? "").split("\n").filter((line) => line.trim()).length);

/** `message`'s rendering, or `undefined`, warning when the renderer throws. */
function renderedOrWarn(doc: Document, message: CommitMessage): Node[] | undefined {
  try {
    return renderCommitMessage(doc, message);
  } catch (error) {
    console.warn("gh-prism: couldn't render the commit message; leaving GitHub's as is", error);
    return undefined;
  }
}

/** Where `mountMessage` put a commit's message, for its toggle to move. */
interface MessagePlace {
  /**
   * Places the message as `hidden` now says, sliding it out of or into its place: the column off
   * the row's start edge and back, the diffs moving with it; above the diffs, folding shut and
   * open. A slide still running turns around. Under reduced motion it takes its place at once.
   */
  readonly slide: () => void;
  /** Whether focus is on the message, its controls, or the column's separator. */
  readonly holdsFocus: () => boolean;
}

/**
 * Mounts `container`, the message and its controls, in a sticky column at the left of `page`'s
 * layout row on a window with room for it, else just before `box`, or nowhere while `hidden`,
 * following GitHub's re-renders and the window's width, until `signal` aborts.
 */
function mountMessage(
  page: FilesPage,
  { box, container }: { box: Element; container: HTMLElement },
  {
    choice,
    saveWidth,
    hidden,
  }: Pick<CommitMessageOptions, "choice" | "saveWidth"> & { hidden: () => boolean },
  signal: AbortSignal,
): MessagePlace {
  const doc = page.sidebar.ownerDocument;
  const win = doc.defaultView;
  const slot = Object.assign(el(doc, "span", "gh-prism-commit-slot"), { hidden: true });
  const column = messageColumn(doc);
  const { separator, size } = columnSeparator(column, {
    choice,
    saveWidth,
    label: "Resize commit message",
  });
  column.append(separator);
  const mark = prismMark(doc);
  // Holds the controls row's buttons at its end, as its justify-end did alone.
  mark.classList.add("tw:me-auto");
  // Found once: a new row means a new sidebar, and so a new visit; a row detached before then
  // falls back above the diffs.
  const row = findCommitColumnRow(page);
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  // The slide out of or into place still running; the message stays mounted until it ends.
  let slides: Animation[] = [];

  const unmount = () => {
    container.remove();
    slot.remove();
    column.remove();
  };
  const moveAway = (currentBox: Element) => {
    column.remove();
    mark.remove();
    container.remove();
    if (slot.nextElementSibling !== currentBox) currentBox.before(slot);
  };
  const moveIntoColumn = (connectedRow: Element, currentBox: Element) => {
    if (column.parentElement !== connectedRow) connectedRow.prepend(column);
    if (container.parentElement !== column) column.prepend(container);
    if (!mark.isConnected) container.querySelector(".gh-prism-commit-controls")?.prepend(mark);
    if (slot.nextElementSibling !== currentBox) currentBox.before(slot);
    size();
  };
  const moveAboveDiffs = (currentBox: Element) => {
    column.remove();
    mark.remove();
    slot.remove();
    if (container.nextElementSibling !== currentBox) currentBox.before(container);
  };

  const follow = () => {
    const currentBox = findCommitMessage(page)?.box;
    if (!currentBox) unmount();
    else if (hidden() && slides.length === 0) moveAway(currentBox);
    else if (win && fitsColumn(win.innerWidth) && row?.isConnected) {
      moveIntoColumn(row, currentBox);
    } else moveAboveDiffs(currentBox);
  };
  const settle = () => {
    const ended = slides;
    slides = [];
    if (!signal.aborted) follow();
    // Each held its last frame until the message took its place.
    for (const slid of ended) slid.cancel();
  };
  const slide = () => {
    if (slides.length > 0) {
      for (const running of slides) running.reverse();
      return;
    }
    if (!win || reducesMotion(doc)) {
      follow();
      return;
    }

    const to = hidden() ? "out" : "in";
    if (to === "in") follow();
    const currentBox = findCommitMessage(page)?.box;
    slides = column.isConnected
      ? [slideColumn(column, to)]
      : [container, currentBox].filter(isShown(win)).map((part) => fold(win, part, to));
    void Promise.all(slides.map((running) => running.finished)).then(settle, settle);
  };

  follow();
  doc.head.append(style);

  const observer = new MutationObserver(follow);
  if (box.parentNode) observer.observe(box.parentNode, { childList: true });
  if (row) observer.observe(row, { childList: true });
  win?.addEventListener("resize", follow, { signal });

  signal.addEventListener("abort", () => {
    observer.disconnect();
    for (const running of slides) running.cancel();
    unmount();
    style.remove();
  });
  return {
    slide,
    holdsFocus: () => column.contains(doc.activeElement) || container.contains(doc.activeElement),
  };
}

const reducesMotion = (doc: Document): boolean =>
  doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;

const isShown =
  (win: Window) =>
  (part: Element | undefined): part is Element =>
    part !== undefined && win.getComputedStyle(part).display !== "none";

// The motion scale's spatial row, as the sections drop in after loading and the Conversation
// panel opens, and its closing row.
const SPATIAL = { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
const CLOSING = { duration: 160, easing: "ease-out" };

/** A slide's timing: quicker out than in, holding its last frame until the caller cancels it. */
const slideTiming = (to: "in" | "out"): KeyframeAnimationOptions => ({
  ...(to === "in" ? SPATIAL : CLOSING),
  fill: "both",
});

/**
 * Slides `column` off its row's start edge, or back on, at its full width, so its text never
 * rewraps and the row's other panes move with its edge.
 */
function slideColumn(column: HTMLElement, to: "in" | "out"): Animation {
  const on = { marginInlineStart: "0px" };
  const off = { marginInlineStart: `-${column.getBoundingClientRect().width}px` };
  return column.animate(to === "in" ? [off, on] : [on, off], slideTiming(to));
}

/** Folds `part`, a block above the diffs, shut or open, so what follows it moves with its edge. */
function fold(win: Window, part: Element, to: "in" | "out"): Animation {
  const { paddingTop, paddingBottom, borderTopWidth, borderBottomWidth } =
    win.getComputedStyle(part);
  const held = { boxSizing: "border-box", minHeight: "0px", overflow: "clip" };
  const open = {
    ...held,
    height: `${part.getBoundingClientRect().height}px`,
    paddingTop,
    paddingBottom,
    borderTopWidth,
    borderBottomWidth,
  };
  const shut = {
    ...held,
    height: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
  };
  return part.animate(to === "in" ? [shut, open] : [open, shut], slideTiming(to));
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): markdown. */
const MARKDOWN =
  "M14.85 3c.63 0 1.15.52 1.14 1.15v7.7c0 .63-.51 1.15-1.15 1.15H1.15C.52 13 0 12.48 0 11.84V4.15C0 3.52.52 3 1.15 3ZM9 11V5H7L5.5 7 4 5H2v6h2V8l1.5 1.92L7 8v3Zm2.99.5L14.5 8H13V5h-2v3H9.5Z";

const LABEL: Record<CommitMessageView, string> = {
  rendered: "Show plain text",
  plaintext: "Show Markdown",
};

/** The message's container, and how to fill its body. */
interface MessageView {
  readonly container: HTMLElement;
  /**
   * Shows a skeleton of a title and `lines` lines in a loading state, its fade-in and pulse
   * `elapsed` ms along, so a skeleton shown again mid-visit carries on where the last one was.
   */
  readonly wait: (elapsed: number, lines: number) => void;
  /** Puts `nodes` in the body, fading them in where a skeleton stood when `"revealed"`. */
  readonly fill: (nodes: Node[], entrance: "revealed" | "at once") => void;
}

/**
 * An empty body under a switch to plain text, with a copy of `box`'s children
 * that the column shows as that plain text, returned with `data-view` already set to `choice.view`
 * so a plain-text reader never sees the rendering paint. Each click of the switch flips the view,
 * records it in `choice`, and `save`s it.
 */
function messageView(
  doc: Document,
  box: Element,
  { choice, save }: Pick<CommitMessageOptions, "choice" | "save">,
): MessageView {
  const mark = icon(doc, MARKDOWN, {});
  const button = textButton(doc, "gh-prism-commit-view-switch");
  const body = el(doc, "div", "gh-prism-commit-message-body markdown-body");
  const container = el(
    doc,
    "div",
    "gh-prism-commit-message tw:flow-root tw:px-3 tw:py-2",
    el(
      doc,
      "div",
      "gh-prism-commit-controls tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1",
      button,
    ),
    body,
    // Copies the children, not the box: findCommitMessage matches the box's own class.
    el(
      doc,
      "div",
      "gh-prism-commit-message-plain",
      ...[...box.childNodes].map((node) => node.cloneNode(true)),
    ),
  );

  container.id = "gh-prism-commit-message";

  const showView = (view: CommitMessageView) => {
    container.dataset.view = view;
    button.replaceChildren(mark, LABEL[view]);
  };
  button.addEventListener("click", () => {
    choice.view = choice.view === "rendered" ? "plaintext" : "rendered";
    showView(choice.view);
    save(choice.view);
  });
  const wait = (elapsed: number, lines: number) => {
    body.replaceChildren(skeleton(doc, elapsed, lines));
    body.setAttribute("aria-busy", "true");
  };
  const fill = (nodes: Node[], entrance: "revealed" | "at once") => {
    const from = container.offsetHeight;
    body.replaceChildren(...nodes);
    body.removeAttribute("aria-busy");
    if (entrance === "revealed" && !reducesMotion(doc)) reveal(container, body, from);
  };

  showView(choice.view);
  return { container, wait, fill };
}

/** Bars standing in for the title and `lines` lines of the body until the rendering lands. */
function skeleton(doc: Document, elapsed: number, lines: number): HTMLElement {
  const bars = el(
    doc,
    "div",
    "gh-prism-commit-skeleton",
    ...Array.from({ length: 1 + lines }, () => el(doc, "span", "")),
  );
  bars.style.setProperty("--gh-prism-commit-elapsed", `${Math.round(elapsed)}ms`);
  return bars;
}

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

/** Primer's small invisible Button, for the switch's icon and label. */
function textButton(doc: Document, name: string): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "gh-prism-commit-button tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-fgColor-rest)] tw:[font-family:inherit] tw:text-body-small tw:font-medium tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
  );
  button.classList.add(name);
  button.type = "button";
  return button;
}
