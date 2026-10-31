/**
 * The Conversation panel: a pull request's own Conversation tab, framed in an overlay on the left
 * edge of Files changed, and the toolbar button that opens it. The panel is one fixed `<aside>` in
 * `<body>`, never moved, because moving or re-creating an `<iframe>` reloads it.
 */

import { conversationFrameUrl } from "@/utils/github/conversation-frame";
import type { PrRef } from "@/utils/github/pr-ref";
import { type FilesPage, findFilesToolbar } from "../files-page";
import { el, icon, X_ICON } from "../ui/dom";
import { prismMark } from "../ui/mark";
import { CONVERSATION_ESCAPE, isFrameMessage } from "./frame-messages";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./panel.css?inline";

/** Whether the panel is open. One per tab, so an open panel carries to the next pull request. */
export interface ConversationChoice {
  open: boolean;
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

/** Octicons 19.15.0 (MIT, GitHub Inc.): comment-discussion. */
const COMMENT_DISCUSSION =
  "M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 1.06-1.06l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z";

// Primer's small invisible IconButton, as the sidebar's side switch draws it.
const ICON_BUTTON =
  "tw:relative tw:shrink-0 tw:inline-grid tw:place-content-center tw:size-[var(--control-small-size,28px)] tw:p-0 tw:[border:0] tw:rounded-medium tw:[background:none] tw:text-[color:var(--button-invisible-iconColor-rest)] tw:[font:inherit] tw:cursor-pointer tw:hover:bg-[var(--button-invisible-bgColor-hover)] tw:hover:text-[color:var(--button-invisible-iconColor-hover)] tw:active:bg-[var(--button-invisible-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2";

/** The panel's markup, before it holds a frame. */
interface PanelView {
  readonly aside: HTMLElement;
  readonly body: HTMLElement;
}

/**
 * The visit's Conversation panel for `pr`; mounted when first opened, removed when `visit` aborts.
 * It opens at once, without taking focus, when `choice` says the last one was left open.
 */
export function conversationPanel(
  doc: Document,
  options: {
    pr: PrRef;
    choice: ConversationChoice;
    fetch: typeof fetch;
    allowFraming: (pr: PrRef, policy: string, signal: AbortSignal) => Promise<boolean>;
    visit: AbortSignal;
  },
): ConversationPanel {
  const { pr, choice, visit } = options;
  let view: PanelView | undefined;
  let frame: HTMLIFrameElement | undefined;
  let button: HTMLElement | undefined;
  let open = false;

  const sync = () => button?.setAttribute("aria-expanded", String(open));

  function show(focus: boolean): void {
    view ??= mountPanel(doc, () => panel.close(), visit);
    frame ??= loadFrame(doc, view, options);
    open = choice.open = true;
    view.aside.hidden = false;
    sync();
    if (focus) view.aside.focus({ preventScroll: true });
  }

  function hide(): void {
    if (!view || !open) return;
    const heldFocus = view.aside.contains(doc.activeElement);
    open = choice.open = false;
    view.aside.hidden = true;
    sync();
    if (heldFocus) button?.focus();
  }

  const panel: ConversationPanel = {
    toggle: () => (open ? hide() : show(true)),
    close: hide,
    get open() {
      return open;
    },
    attach(next) {
      button = next;
      next.setAttribute("aria-controls", PANEL_ID);
      sync();
    },
  };

  // Mounted with the visit, so the button is styled before the panel first opens.
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  visit.addEventListener("abort", () => style.remove());

  dismissOnEscape(doc, () => open, hide, visit);
  dismissOnOutsidePointer(
    doc,
    (target) => target === button || !!view?.aside.contains(target),
    () => open,
    hide,
    visit,
  );
  followFrameMessages(doc, () => frame, hide, visit);
  if (choice.open) show(false);
  return panel;
}

/** Appends the panel's `<aside>`, hidden, until `visit` aborts. */
function mountPanel(doc: Document, close: () => void, visit: AbortSignal): PanelView {
  const closeButton = el(
    doc,
    "button",
    `gh-prism-conversation-close ${ICON_BUTTON}`,
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
    el(doc, "h2", "tw:m-0 tw:flex-1 tw:text-body-medium tw:font-semibold", "Conversation"),
    closeButton,
  );
  const body = el(doc, "div", "gh-prism-conversation-body");
  const aside = el(doc, "aside", "gh-prism-conversation", header, body);
  aside.id = PANEL_ID;
  aside.tabIndex = -1;
  aside.hidden = true;
  aside.setAttribute("aria-label", "Conversation");

  // A DOM clone, such as a restored snapshot, can carry an earlier visit's panel.
  doc.getElementById(PANEL_ID)?.remove();
  doc.body.append(aside);
  visit.addEventListener("abort", () => aside.remove());
  return { aside, body };
}

/**
 * Shows the skeleton, then frames `pr`'s Conversation once its live policy is fetched and the
 * framing rule is in, after the top page's `load` so the frame never holds Files changed's back.
 * Any failure shows the failure sentence instead, and no frame loads without its rule.
 */
function loadFrame(
  doc: Document,
  view: PanelView,
  { pr, fetch, allowFraming, visit }: Parameters<typeof conversationPanel>[1],
): HTMLIFrameElement {
  const url = conversationFrameUrl(pr);
  const frame = el(doc, "iframe", "gh-prism-conversation-frame");
  frame.title = "Conversation";
  view.aside.dataset.state = "loading";
  view.body.append(skeleton(doc), frame);

  const fail = () => {
    view.aside.dataset.state = "failed";
    view.body.replaceChildren(failure(doc, pr));
  };
  frame.addEventListener("load", () => {
    // Chrome's error page for a refused or failed frame is cross-origin.
    if (frame.contentDocument) view.aside.dataset.state = "loaded";
    else fail();
  });

  void (async () => {
    const response = await fetch(url, { method: "HEAD", signal: visit });
    const policy = response.ok ? response.headers.get("content-security-policy") : null;
    if (!policy || !(await allowFraming(pr, policy, visit))) return fail();
    await loaded(doc);
    if (!visit.aborted) frame.src = url;
  })().catch((error: unknown) => {
    if (visit.aborted) return;
    console.error("gh-prism: loading the Conversation panel failed", error);
    fail();
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
  link.href = `${ORIGIN}/${pr.owner}/${pr.repo}/pull/${pr.number}`;
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
      if (event.key === "Escape" && !event.defaultPrevented && isOpen()) close();
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
      if (
        !owns(event.target) &&
        !event.composedPath().some((node) => node instanceof Node && owns(node))
      )
        close();
    },
    { capture: true, signal },
  );
}

/**
 * Takes the frame's messages until `signal` aborts: a relayed Escape closes the panel, and a
 * leaving link loads in the page. Only the panel's own frame, from GitHub's origin, is heard.
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
      const source = frameOf()?.contentWindow;
      if (!source || event.source !== source || event.origin !== ORIGIN) return;
      if (!isFrameMessage(event.data)) return;
      if (event.data.type === CONVERSATION_ESCAPE) close();
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

  const button = el(
    doc,
    "button",
    `gh-prism-conversation-button ${ICON_BUTTON}`,
    icon(doc, COMMENT_DISCUSSION, {}),
  );
  button.type = "button";
  button.setAttribute("aria-label", "Conversation");
  button.addEventListener("click", () => panel.toggle());

  // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier button.
  for (const stale of doc.querySelectorAll(".gh-prism-conversation-button")) stale.remove();
  toolbar.prepend(button);
  panel.attach(button);
  signal.addEventListener("abort", () => button.remove());
}
