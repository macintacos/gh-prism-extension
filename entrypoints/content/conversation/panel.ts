/**
 * The Conversation panel: a pull request's own Conversation tab, framed in an overlay on the left
 * edge of Files changed, and the toolbar button that opens it. The panel is one fixed `<aside>` in
 * `<body>`, never moved, because moving or re-creating an `<iframe>` reloads it.
 */

import { conversationFrameUrl } from "@/utils/github/conversation-frame";
import type { PrRef } from "@/utils/github/pr-ref";
import { type FilesPage, findFilesToolbar } from "../files-page";
import { type ColumnWidthChoice, columnSeparator, fitsColumn } from "../ui/column-width";
import { el, icon, X_ICON } from "../ui/dom";
import { glide } from "../ui/glide";
import { prismMark } from "../ui/mark";
import { CONVERSATION_ESCAPE, isFrameMessage } from "./frame-messages";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./panel.css?inline";

/**
 * Whether the panel is open and pinned, and its pinned width. One per tab, so an open panel
 * carries to the next pull request.
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
// Read by panel.css's padding on <html>, which makes the pinned panel's room.
const WIDTH_PROPERTY = "--gh-prism-conversation-width";

/** Octicons (MIT, GitHub Inc.): pin. */
const PIN =
  "m11.294.984 3.722 3.722a1.75 1.75 0 0 1-.504 2.826l-1.327.613a3.09 3.09 0 0 0-1.707 2.084l-.584 2.454c-.317 1.332-1.972 1.8-2.94.832L5.75 11.311 1.78 15.28a.749.749 0 1 1-1.06-1.06l3.969-3.97-2.204-2.204c-.968-.968-.5-2.623.832-2.94l2.454-.584a3.08 3.08 0 0 0 2.084-1.707l.613-1.327a1.75 1.75 0 0 1 2.826-.504M6.283 9.723l2.732 2.731a.25.25 0 0 0 .42-.119l.584-2.454a4.59 4.59 0 0 1 2.537-3.098l1.328-.613a.25.25 0 0 0 .072-.404l-3.722-3.722a.25.25 0 0 0-.404.072l-.613 1.328a4.58 4.58 0 0 1-3.098 2.537l-2.454.584a.25.25 0 0 0-.119.42l2.731 2.732Z";

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
  readonly pin: HTMLElement;
  readonly separator: HTMLElement;
  /** Sizes the pinned panel, and the page's room for it, to the choice's width. */
  readonly size: () => void;
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
    /** Remembers whether the reader pinned the panel. */
    savePinned: (pinned: boolean) => void;
    /** Remembers a width the pinned panel was set to. */
    saveWidth: (width: number) => void;
    visit: AbortSignal;
  },
): ConversationPanel {
  const { choice, savePinned, saveWidth, visit } = options;
  const root = doc.documentElement;
  let view: PanelView | undefined;
  let frame: HTMLIFrameElement | undefined;
  let button: HTMLElement | undefined;
  let pressed: HTMLElement | undefined;
  let open = false;

  const sync = () => button?.setAttribute("aria-expanded", String(open));
  const fits = () => fitsColumn(doc.defaultView?.innerWidth ?? 0);
  const pinned = () => open && choice.pinned && fits();

  /** Draws the panel pinned or as the overlay, as the choice and the window allow. */
  function layout(): void {
    if (!view) return;
    view.aside.hidden = !open;
    view.pin.hidden = !fits();
    view.pin.setAttribute("aria-pressed", String(choice.pinned));
    view.separator.hidden = !pinned();
    if (pinned()) {
      root.dataset.ghPrismConversation = "pinned";
      view.size();
    } else {
      unpinPage(root);
      view.aside.style.removeProperty("width");
    }
  }

  /** Runs `layout`, gliding the page when it moves, unless the sidebar is already gliding. */
  function relayout(): void {
    const moves = (root.dataset.ghPrismConversation === "pinned") !== pinned();
    if (moves && root.dataset.ghPrismGlide === undefined) glide(doc, "pin", layout);
    else layout();
  }

  function show(focus: boolean): void {
    view ??= mountPanel(doc, { close: () => panel.close(), togglePin, choice, saveWidth }, visit);
    frame ??= loadFrame(doc, view, options);
    open = choice.open = true;
    view.aside.hidden = false;
    sync();
    if (!focus) {
      layout();
      return;
    }
    relayout();
    view.aside.focus({ preventScroll: true });
  }

  function hide(): void {
    if (!view || !open) return;
    const heldFocus = view.aside.contains(doc.activeElement);
    open = choice.open = false;
    relayout();
    sync();
    if (heldFocus) button?.focus();
  }

  function togglePin(): void {
    choice.pinned = !choice.pinned;
    savePinned(choice.pinned);
    relayout();
  }

  /** Closes the overlay; a pinned panel stays until its own close or the toolbar button. */
  const dismiss = () => {
    if (!pinned()) hide();
  };

  const panel: ConversationPanel = {
    toggle: () => (open ? hide() : show(true)),
    close: hide,
    get open() {
      return open;
    },
    attach(next) {
      button = next;
      // Hydrating the toolbar on a press can swap the button mid-press, and then no click fires.
      next.addEventListener("pointerdown", () => (pressed = next));
      next.addEventListener("pointerup", () => {
        if (pressed && !pressed.isConnected) panel.toggle();
        pressed = undefined;
      });
      next.setAttribute("aria-controls", PANEL_ID);
      sync();
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
  followFrameMessages(doc, () => frame, dismiss, visit);
  if (choice.open) show(false);
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
    choice,
    saveWidth,
  }: {
    close: () => void;
    togglePin: () => void;
    choice: ColumnWidthChoice;
    saveWidth: (width: number) => void;
  },
  visit: AbortSignal,
): PanelView {
  const pin = el(doc, "button", `gh-prism-conversation-pin ${ICON_BUTTON}`, icon(doc, PIN, {}));
  pin.type = "button";
  pin.setAttribute("aria-label", "Pin Conversation");
  pin.addEventListener("click", togglePin);

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
    pin,
    closeButton,
  );
  const body = el(doc, "div", "gh-prism-conversation-body");
  const aside = el(doc, "aside", "gh-prism-conversation", header, body);
  const { separator, size } = columnSeparator(aside, {
    choice,
    saveWidth,
    label: "Resize Conversation",
    onSize: (width) => doc.documentElement.style.setProperty(WIDTH_PROPERTY, `${width}px`),
  });
  separator.hidden = true;
  aside.append(separator);
  aside.id = PANEL_ID;
  aside.tabIndex = -1;
  aside.hidden = true;
  aside.setAttribute("aria-label", "Conversation");

  // A DOM clone, such as a restored snapshot, can carry an earlier visit's panel.
  doc.getElementById(PANEL_ID)?.remove();
  doc.body.append(aside);
  visit.addEventListener("abort", () => aside.remove());
  return { aside, body, pin, separator, size };
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
