import { isConversationFrame } from "@/utils/github/conversation-frame";
import { isEditable } from "../ui/dom";
import { toggleKeyOf } from "../ui/toggle-keys";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./frame.css?inline";
import {
  CONVERSATION_ESCAPE,
  CONVERSATION_KEY,
  CONVERSATION_LEAVE,
  type FrameMessage,
} from "./frame-messages";

const PARENT_ORIGIN = "https://github.com";

/**
 * Dresses `win` when it is the Conversation panel's frame: hides GitHub's chrome, hands links
 * that leave the Conversation to the parent, and relays unhandled Escape, `\`, and Shift+\. Does
 * nothing elsewhere.
 */
export function dressConversationFrame(win: Window): void {
  if (win.top === win || !isConversationFrame(new URL(win.location.href))) return;
  const doc = win.document;
  const postToParent = (message: FrameMessage) => win.parent.postMessage(message, PARENT_ORIGIN);

  doc.documentElement.setAttribute("data-gh-prism-panel", "");
  // At document_start the head may not exist yet.
  doc.documentElement.append(Object.assign(doc.createElement("style"), { textContent: css }));

  doc.addEventListener(
    "click",
    (event) => {
      const url = followedLink(event, win.location);
      if (!url) return;
      const samePage = url.origin === win.location.origin && url.pathname === win.location.pathname;
      if (samePage && url.search === win.location.search) return;
      event.preventDefault();
      // Same PR without the marker: the framing rule wouldn't match, so stay and only scroll.
      if (!samePage) postToParent({ type: CONVERSATION_LEAVE, href: url.href });
      else if (url.hash) win.location.hash = url.hash;
    },
    { capture: true },
  );

  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented && !isEditable(event.target))
      postToParent({ type: CONVERSATION_ESCAPE });
    const key = event.defaultPrevented ? undefined : toggleKeyOf(event);
    if (key) postToParent({ type: CONVERSATION_KEY, key });
  });
}

/** The URL a plain left click on a same-tab link would navigate to, resolved against `here`. */
function followedLink(event: MouseEvent, here: Location | URL): URL | undefined {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
    return undefined;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(link instanceof HTMLAnchorElement) ||
    link.target === "_blank" ||
    link.hasAttribute("download")
  )
    return undefined;
  return new URL(link.getAttribute("href") ?? "", here.href);
}
