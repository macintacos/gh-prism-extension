import { isConversationFrame } from "../../../utils/github/conversation-frame";
import { isEditable } from "../ui/dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./frame.css?inline";
import { CONVERSATION_ESCAPE, CONVERSATION_LEAVE, type FrameMessage } from "./frame-messages";

const PARENT_ORIGIN = "https://github.com";

/**
 * Dresses `win` when it is the Conversation panel's frame: hides GitHub's chrome, hands links
 * that leave the Conversation to the parent, and relays unhandled Escape. Does nothing elsewhere.
 */
export function dressConversationFrame(win: Window): void {
  if (win.top === win || !isConversationFrame(new URL(win.location.href))) return;
  const doc = win.document;
  const post = (message: FrameMessage) => win.parent.postMessage(message, PARENT_ORIGIN);

  doc.documentElement.setAttribute("data-gh-prism-panel", "");
  // At document_start the head may not exist yet.
  doc.documentElement.append(Object.assign(doc.createElement("style"), { textContent: css }));

  doc.addEventListener(
    "click",
    (event) => {
      const href = leavingHref(event, win.location);
      if (!href) return;
      event.preventDefault();
      post({ type: CONVERSATION_LEAVE, href });
    },
    { capture: true },
  );

  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented && !isEditable(event.target))
      post({ type: CONVERSATION_ESCAPE });
  });
}

function leavingHref(event: MouseEvent, here: Location | URL): string | undefined {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return undefined;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(link instanceof HTMLAnchorElement) ||
    link.target === "_blank" ||
    link.hasAttribute("download")
  )
    return undefined;
  const url = new URL(link.getAttribute("href") ?? "", here.href);
  if (url.origin === here.origin && url.pathname === here.pathname) return undefined;
  return url.href;
}
