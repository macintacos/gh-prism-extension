/**
 * The Conversation panel: a pull request's own Conversation tab, framed in an overlay on the left
 * edge of Files changed, and the toolbar button that opens it. The panel is one fixed `<aside>` in
 * `<body>`, never moved, because moving or re-creating an `<iframe>` reloads it.
 */

import { conversationFrameUrl, conversationUrl } from "@/utils/github/conversation-frame";
import type { PrRef } from "@/utils/github/pr-ref";
import { type FilesPage, findFilesToolbar } from "../files-page";
import {
  type ColumnWidthChoice,
  columnSeparator,
  fitsColumn,
  widestColumn,
} from "../ui/column-width";
import { el, icon, isEditable, X_ICON } from "../ui/dom";
import { keycap } from "../ui/keycap";
import { prismMark } from "../ui/mark";
import { toggleKeyInit, toggleKeyOf } from "../ui/toggle-keys";
import { CONVERSATION_ESCAPE, CONVERSATION_KEY, isFrameMessage } from "./frame-messages";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./panel.css?inline";

/**
 * Whether the panel is open and pinned, and its width, pinned or over the page. One per tab, so
 * an open panel carries to the next pull request.
 */
export interface ConversationChoice extends ColumnWidthChoice {
  open: boolean;
  pinned: boolean;
}

/** A visit's Conversation panel, as `conversationPanel` builds it. */
export interface ConversationPanel {
  /** Opens or closes the panel for the reviewer, moving focus into it or back to the button. */
  toggle(): void;
  close(): void;
  readonly open: boolean;
  /** Makes `button` the panel's control, keeping its `aria-expanded` in step. */
  attach(button: HTMLElement): void;
}

const PANEL_ID = "gh-prism-conversation";
const ORIGIN = "https://github.com";
// The pinned column's width, read by panel.css's padding on <html>, which makes its room. The
// overlay never sets it.
const WIDTH_PROPERTY = "--gh-prism-conversation-width";
// The strip of page left beside the widest overlay, to click outside it.
const OVERLAY_GUTTER = 48;
// GitHub docks a pull request's tree while its diff viewer's content box, inside 32px of padding
// a side, is 1012px wide.
const DOCKED_FROM = 1012 + 2 * 32;

/** The window's width less a classic scrollbar, which GitHub's diff viewer never gets. */
const pageWidth = (win: Window | null): number =>
  win ? win.document.documentElement.clientWidth || win.innerWidth : 0;

/** Whether `win` has room for the pinned panel beside GitHub's docked layout. */
export const fitsPinned = (win: Window | null): boolean => fitsColumn(pageWidth(win), DOCKED_FROM);

/** Octicons (MIT, GitHub Inc.): pin. */
const PIN =
  "m11.294.984 3.722 3.722a1.75 1.75 0 0 1-.504 2.826l-1.327.613a3.09 3.09 0 0 0-1.707 2.084l-.584 2.454c-.317 1.332-1.972 1.8-2.94.832L5.75 11.311 1.78 15.28a.749.749 0 1 1-1.06-1.06l3.969-3.97-2.204-2.204c-.968-.968-.5-2.623.832-2.94l2.454-.584a3.08 3.08 0 0 0 2.084-1.707l.613-1.327a1.75 1.75 0 0 1 2.826-.504M6.283 9.723l2.732 2.731a.25.25 0 0 0 .42-.119l.584-2.454a4.59 4.59 0 0 1 2.537-3.098l1.328-.613a.25.25 0 0 0 .072-.404l-3.722-3.722a.25.25 0 0 0-.404.072l-.613 1.328a4.58 4.58 0 0 1-3.098 2.537l-2.454.584a.25.25 0 0 0-.119.42l2.731 2.732Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): comment-discussion. */
const COMMENT_DISCUSSION =
  "M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 1.06-1.06l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): checklist. */
const CHECKLIST =
  "M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13.274 9.537v-.001l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425 4.026-3.932a.75.75 0 1 1 1.048 1.074ZM4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75Z";

/** Octicons 19.15.0 (MIT, GitHub Inc.): people. */
const PEOPLE =
  "M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z";

// The framed Conversation's merge-box checks, its sidebar of reviewers, labels, and the rest, and
// the timeline the sidebar sits beside or below. Listed in panel.css's GitHub hooks.
const FRAME_CHECKS = '[data-testid="mergebox-partial"] section[aria-label="Checks"]';
const FRAME_SIDEBAR = "#partial-discussion-sidebar";
const FRAME_TIMELINE = ".js-discussion";

/** What `conversationPanel` frames, and how it reaches storage and the framing rule. */
export interface ConversationPanelOptions {
  pr: PrRef;
  choice: ConversationChoice;
  fetch: typeof fetch;
  allowFraming: (pr: PrRef, policy: string, signal: AbortSignal) => Promise<boolean>;
  /** Remembers whether the reader pinned the panel. */
  savePinned: (pinned: boolean) => void;
  /** Remembers a width the panel was set to. */
  saveWidth: (width: number) => void;
  visit: AbortSignal;
}

/** Closed, over the page, or pinned as a column beside it. */
type Mode = "closed" | "overlay" | "column";

/** The panel's markup, before it holds a frame. */
interface PanelView {
  readonly aside: HTMLElement;
  readonly body: HTMLElement;
  readonly pin: HTMLElement;
  /** Jumps the frame to the checks, shown while it has them. */
  readonly checks: HTMLElement;
  /** Jumps the frame to its sidebar, shown while that sits below the timeline. */
  readonly sidebar: HTMLElement;
  readonly separator: HTMLElement;
  /** Sizes the panel to the choice's width, and the page's room for it when pinned. */
  readonly size: () => void;
}

/**
 * The visit's Conversation panel for `pr`; mounted when first opened, removed when `visit` aborts.
 * It opens at once, without taking focus, when `choice` says the last one was left open.
 */
export function conversationPanel(
  doc: Document,
  options: ConversationPanelOptions,
): ConversationPanel {
  const { choice, savePinned, saveWidth, visit } = options;
  const root = doc.documentElement;
  let view: PanelView | undefined;
  let frame: HTMLIFrameElement | undefined;
  let button: HTMLElement | undefined;
  let pressedButton: HTMLElement | undefined;
  let open = false;

  const syncExpanded = () => button?.setAttribute("aria-expanded", String(open));
  const fits = () => fitsPinned(doc.defaultView);
  /** How the panel should be drawn, as `open`, the choice, and the window allow. */
  const mode = (): Mode => (!open ? "closed" : choice.pinned && fits() ? "column" : "overlay");
  let drawn: Mode = "closed";
  let slide: Animation | undefined;

  function layout(): void {
    if (!view) return;
    slide?.finish();
    drawn = mode();
    view.aside.hidden = drawn === "closed";
    view.pin.hidden = !fits();
    view.pin.setAttribute("aria-pressed", String(choice.pinned));
    if (drawn === "column") root.dataset.ghPrismConversation = "pinned";
    else unpinPage(root);
    if (drawn !== "closed") view.size();
  }

  /** Runs `layout`, sliding the page alongside the panel when it moves. */
  function relayout(): void {
    const moves = (drawn === "column") !== (mode() === "column");
    const from = root.style.getPropertyValue(WIDTH_PROPERTY) || "0px";
    layout();
    if (!moves || doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = root.style.getPropertyValue(WIDTH_PROPERTY) || "0px";
    // Keep in sync with the panel's own translate in panel.css, so the two move as one.
    const timing =
      drawn === "closed"
        ? { duration: 160, easing: "ease-out" }
        : { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" };
    slide = root.animate?.([{ paddingInlineStart: from }, { paddingInlineStart: to }], timing);
  }

  /** Mounts the panel and its frame once, and marks it open, before it's laid out. */
  function reveal(): PanelView {
    view ??= mountPanel(
      doc,
      {
        close: () => panel.close(),
        togglePin,
        isColumn: () => drawn === "column",
        choice,
        saveWidth,
      },
      visit,
    );
    frame ??= loadFrame(doc, view, options);
    open = choice.open = true;
    syncExpanded();
    return view;
  }

  /** Opens the panel for the reviewer, gliding the page and moving focus into it. */
  function openForReviewer(): void {
    const shown = reveal();
    relayout();
    shown.aside.focus({ preventScroll: true });
  }

  /** Opens the panel as the last visit left it, leaving focus where it is. */
  function restore(): void {
    reveal();
    layout();
  }

  function hide(): void {
    if (!view || !open) return;
    const heldFocus = view.aside.contains(doc.activeElement);
    open = choice.open = false;
    relayout();
    syncExpanded();
    if (heldFocus) button?.focus();
  }

  function togglePin(): void {
    choice.pinned = !choice.pinned;
    savePinned(choice.pinned);
    relayout();
  }

  /** Closes the overlay; a pinned panel stays until its own close or the toolbar button. */
  const dismiss = () => {
    if (drawn !== "column") hide();
  };

  const panel: ConversationPanel = {
    toggle: () => (open ? hide() : openForReviewer()),
    close: hide,
    get open() {
      return open;
    },
    attach(next) {
      button = next;
      // Hydrating the toolbar on a press can swap the button mid-press, and then no click fires.
      next.addEventListener("pointerdown", () => (pressedButton = next));
      next.addEventListener("pointerup", () => {
        if (pressedButton && !pressedButton.isConnected) panel.toggle();
      });
      next.setAttribute("aria-controls", PANEL_ID);
      syncExpanded();
    },
  };

  // Mounted with the visit, so the button is styled before the panel first opens.
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  visit.addEventListener("abort", () => style.remove());

  visit.addEventListener("abort", () => unpinPage(root));
  doc.defaultView?.addEventListener("resize", layout, { signal: visit });

  dismissOnEscape(doc, () => open, dismiss, visit);
  dismissOnOutsidePointer(
    doc,
    (target) => target === button || !!view?.aside.contains(target),
    () => open,
    dismiss,
    visit,
  );
  // After each button's own pointerup, so a press released elsewhere is forgotten.
  const forgetPress = () => (pressedButton = undefined);
  doc.addEventListener("pointerup", forgetPress, { signal: visit });
  doc.addEventListener("pointercancel", forgetPress, { signal: visit });
  followFrameMessages(doc, () => frame, dismiss, visit);
  doc.addEventListener(
    "keydown",
    (event) => {
      if (toggleKeyOf(event) !== "Shift+\\") return;
      event.preventDefault();
      panel.toggle();
    },
    { capture: true, signal: visit },
  );
  if (choice.open) restore();
  return panel;
}

/** Lets the page back from a pinned panel's column. */
function unpinPage(root: HTMLElement): void {
  delete root.dataset.ghPrismConversation;
  root.style.removeProperty(WIDTH_PROPERTY);
}

/** Appends the panel's `<aside>`, hidden, until `visit` aborts. */
function mountPanel(
  doc: Document,
  {
    close,
    togglePin,
    isColumn,
    choice,
    saveWidth,
  }: {
    close: () => void;
    togglePin: () => void;
    /** Whether the panel is drawn as the pinned column rather than the overlay. */
    isColumn: () => boolean;
    choice: ColumnWidthChoice;
    saveWidth: (width: number) => void;
  },
  visit: AbortSignal,
): PanelView {
  const pin = hideableIconButton(doc, "gh-prism-conversation-pin", "Pin Conversation", PIN);
  pin.addEventListener("click", togglePin);

  const checks = hideableIconButton(
    doc,
    "gh-prism-conversation-checks",
    "Jump to checks",
    CHECKLIST,
  );
  const sidebar = hideableIconButton(
    doc,
    "gh-prism-conversation-sidebar",
    "Jump to reviewers, labels, and projects",
    PEOPLE,
  );
  checks.hidden = sidebar.hidden = true;

  const closeButton = el(
    doc,
    "button",
    "gh-prism-conversation-close tw:relative tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, X_ICON, {}),
  );
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close Conversation");
  closeButton.addEventListener("click", close);

  const header = el(
    doc,
    "header",
    "gh-prism-conversation-header tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2",
    prismMark(doc),
    el(
      doc,
      "h2",
      "tw:m-0 tw:min-w-0 tw:flex-1 tw:truncate tw:text-body-medium tw:font-semibold",
      "Conversation",
    ),
    checks,
    sidebar,
    pin,
    closeButton,
  );
  const body = el(doc, "div", "gh-prism-conversation-body");
  const aside = el(doc, "aside", "gh-prism-conversation", header, body);
  const { separator, size } = columnSeparator(aside, {
    choice,
    saveWidth,
    label: "Resize Conversation",
    onSize: (width) => {
      if (isColumn()) doc.documentElement.style.setProperty(WIDTH_PROPERTY, `${width}px`);
    },
    widest: (viewport) =>
      isColumn()
        ? widestColumn(pageWidth(doc.defaultView), DOCKED_FROM)
        : viewport - OVERLAY_GUTTER,
  });
  aside.append(separator);
  aside.id = PANEL_ID;
  aside.tabIndex = -1;
  aside.hidden = true;
  aside.setAttribute("aria-label", "Conversation");

  // A DOM clone, such as a restored snapshot, can carry an earlier visit's panel.
  doc.getElementById(PANEL_ID)?.remove();
  doc.body.append(aside);
  visit.addEventListener("abort", () => aside.remove());
  return { aside, body, pin, checks, sidebar, separator, size };
}

/**
 * Primer's small invisible IconButton, as the sidebar's side switch draws it, named by `label`.
 * panel.css displays it, so the `hidden` attribute still hides it.
 */
function hideableIconButton(
  doc: Document,
  className: string,
  label: string,
  path: string,
): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    `${className} gh-prism-conversation-tool tw:relative tw:shrink-0 tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2`,
    icon(doc, path, {}),
  );
  button.type = "button";
  button.setAttribute("aria-label", label);
  return button;
}

/**
 * Shows each jump control while its section is in `frame`'s loaded Conversation, the sidebar's
 * only while it sits below the timeline, following the frame's DOM and width until `visit` aborts.
 */
function followJumpTargets(view: PanelView, frame: HTMLIFrameElement, visit: AbortSignal): void {
  const framed = frame.contentDocument;
  if (!framed) return;
  const sync = () => {
    view.checks.hidden = !framed.querySelector(FRAME_CHECKS);
    const sidebar = framed.querySelector(FRAME_SIDEBAR);
    const timeline = framed.querySelector(FRAME_TIMELINE);
    view.sidebar.hidden =
      !sidebar ||
      !timeline ||
      sidebar.getBoundingClientRect().left >= timeline.getBoundingClientRect().right;
  };

  // GitHub's Conversation mutates often, so mutations share one layout read per frame.
  let queued = false;
  const syncNextFrame = () => {
    if (queued) return;
    queued = true;
    frame.contentWindow?.requestAnimationFrame(() => {
      queued = false;
      sync();
    });
  };

  sync();
  const observer = new MutationObserver(syncNextFrame);
  observer.observe(framed, { childList: true, subtree: true });
  visit.addEventListener("abort", () => observer.disconnect());
  frame.contentWindow?.addEventListener("resize", sync, { signal: visit });
}

/** Scrolls `frame` to put the top of its `selector` at the frame's top, smoothly if motion's on. */
function jumpTo(frame: HTMLIFrameElement, selector: string): void {
  const target = frame.contentDocument?.querySelector(selector);
  const win = frame.contentWindow;
  if (!target || !win) return;
  const still = frame.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  win.scrollTo({
    top: target.getBoundingClientRect().top + win.scrollY,
    behavior: still ? "instant" : "smooth",
  });
}

/**
 * Shows the skeleton, then frames `pr`'s Conversation once its live policy is fetched and the
 * framing rule is in, after the top page's `load` so the frame never holds Files changed's back.
 * Any failure shows the failure sentence instead, and no frame loads without its rule.
 */
function loadFrame(
  doc: Document,
  view: PanelView,
  { pr, fetch, allowFraming, visit }: ConversationPanelOptions,
): HTMLIFrameElement {
  const url = conversationFrameUrl(pr);
  const frame = el(doc, "iframe", "gh-prism-conversation-frame");
  frame.title = "Conversation";
  view.aside.dataset.state = "loading";
  view.body.append(skeleton(doc), frame);
  view.checks.addEventListener("click", () => jumpTo(frame, FRAME_CHECKS));
  view.sidebar.addEventListener("click", () => jumpTo(frame, FRAME_SIDEBAR));

  const showFailure = () => {
    view.aside.dataset.state = "failed";
    view.checks.hidden = true;
    view.sidebar.hidden = true;
    view.body.replaceChildren(failure(doc, pr));
  };
  // Whether a load has succeeded since the frame was last pointed at `url`, so a refused load
  // re-points it once, and a refused re-point fails rather than looping.
  let loadedSincePoint = false;
  frame.addEventListener("load", () => {
    if (!frame.hasAttribute("src")) return;
    // Chrome's error page for a refused or failed frame is cross-origin.
    if (frame.contentDocument) {
      loadedSincePoint = true;
      view.aside.dataset.state = "loaded";
      followJumpTargets(view, frame, visit);
    } else if (loadedSincePoint) {
      // Left the marked URL, so the framing rule no longer matched.
      loadedSincePoint = false;
      frame.src = url;
    } else showFailure();
  });

  void (async () => {
    const response = await fetch(url, { method: "HEAD", signal: visit });
    const policy = response.ok ? response.headers.get("content-security-policy") : null;
    if (!policy || !(await allowFraming(pr, policy, visit))) return showFailure();
    await loaded(doc);
    if (!visit.aborted) frame.src = url;
  })().catch((error: unknown) => {
    if (visit.aborted) return;
    console.error("gh-prism: loading the Conversation panel failed", error);
    showFailure();
  });
  return frame;
}

/** Settles once `doc` has fired `load`. */
const loaded = (doc: Document): Promise<void> =>
  doc.readyState === "complete"
    ? Promise.resolve()
    : new Promise((resolve) =>
        doc.defaultView?.addEventListener("load", () => resolve(), { once: true }),
      );

/** Bars shaped like a Conversation's description: a title, then a paragraph's lines. */
function skeleton(doc: Document): HTMLElement {
  const bars = Array.from({ length: 4 }, () => doc.createElement("span"));
  const node = el(doc, "div", "gh-prism-conversation-skeleton", ...bars);
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** The one sentence the panel shows when the Conversation won't load, linking to its tab. */
function failure(doc: Document, pr: PrRef): HTMLElement {
  const link = el(doc, "a", "", "Open the Conversation tab");
  link.href = conversationUrl(pr);
  return el(
    doc,
    "p",
    "gh-prism-conversation-failure tw:m-0 tw:p-4 tw:text-body-small tw:text-fg-muted",
    "The Conversation didn't load here. ",
    link,
    ".",
  );
}

/** Closes an open overlay on an Escape the page leaves unhandled, until `signal` aborts. */
function dismissOnEscape(
  doc: Document,
  isOpen: () => boolean,
  close: () => void,
  signal: AbortSignal,
): void {
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.defaultPrevented || isEditable(event.target)) return;
      if (isOpen()) close();
    },
    { signal },
  );
}

/**
 * Closes an open overlay on a pointerdown outside what `owns`, until `signal` aborts. A click in
 * the frame never reaches this document, so it never counts as outside.
 */
function dismissOnOutsidePointer(
  doc: Document,
  owns: (target: Node) => boolean,
  isOpen: () => boolean,
  close: () => void,
  signal: AbortSignal,
): void {
  doc.addEventListener(
    "pointerdown",
    (event) => {
      if (!isOpen() || !(event.target instanceof Node)) return;
      if (!event.composedPath().some((node) => node instanceof Node && owns(node))) close();
    },
    { capture: true, signal },
  );
}

/**
 * Takes the frame's messages until `signal` aborts: a relayed Escape closes the panel, a relayed
 * toggle key is pressed on the page, and a leaving link loads in the page. Only the panel's own
 * frame, from GitHub's origin, is heard.
 */
function followFrameMessages(
  doc: Document,
  frameOf: () => HTMLIFrameElement | undefined,
  close: () => void,
  signal: AbortSignal,
): void {
  doc.defaultView?.addEventListener(
    "message",
    (event) => {
      const frameWindow = frameOf()?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || event.origin !== ORIGIN) return;
      if (!isFrameMessage(event.data)) return;
      if (event.data.type === CONVERSATION_ESCAPE) close();
      // Pressed again on the page, for whichever of its handlers takes the key.
      else if (event.data.type === CONVERSATION_KEY)
        doc.body.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, ...toggleKeyInit(event.data.key) }),
        );
      else follow(doc, event.data.href);
    },
    { signal },
  );
}

/** Loads `href` in the page through a link, so GitHub's router can take it without a reload. */
function follow(doc: Document, href: string): void {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const link = el(doc, "a", "");
  link.href = url.href;
  doc.body.append(link);
  link.click();
  link.remove();
}

/**
 * The toolbar's Conversation button for `panel`, first in the toolbar row, removed when `signal`
 * aborts. Without the row, there's nowhere to put it.
 */
export function showConversationButton(
  page: FilesPage,
  signal: AbortSignal,
  panel: ConversationPanel,
): void {
  const toolbar = findFilesToolbar(page);
  if (!toolbar) return;
  const doc = toolbar.ownerDocument;

  // Primer's small default Button, like "All commits" beside it: the icon, then the keycap.
  const button = el(
    doc,
    "button",
    "gh-prism-conversation-button tw:relative tw:shrink-0 tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:rounded-medium tw:bg-[var(--button-default-bgColor-rest)] tw:[box-shadow:var(--button-default-shadow-resting)] tw:text-[color:var(--button-default-fgColor-rest)] tw:[font-family:var(--fontStack-sansSerif)] tw:text-body-small tw:font-medium tw:cursor-pointer tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, COMMENT_DISCUSSION, { class: "tw:text-fg-muted" }),
    keycap(doc, "\\", { shift: true }),
  );
  button.type = "button";
  button.setAttribute("aria-label", "Conversation");
  button.setAttribute("aria-keyshortcuts", "Shift+\\");
  button.addEventListener("click", () => panel.toggle());

  // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier button.
  for (const stale of doc.querySelectorAll(".gh-prism-conversation-button")) stale.remove();
  toolbar.prepend(button);
  panel.attach(button);
  signal.addEventListener("abort", () => button.remove());
}
