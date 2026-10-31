/** Posted when a link in the panel leaves the Conversation, for the top page to load `href`. */
export const CONVERSATION_LEAVE = "gh-prism:conversation-leave";
/** Posted when Escape in the panel goes unhandled, for the top page to close an overlay. */
export const CONVERSATION_ESCAPE = "gh-prism:conversation-escape";

export interface ConversationLeave {
  readonly type: typeof CONVERSATION_LEAVE;
  readonly href: string;
}

export interface ConversationEscape {
  readonly type: typeof CONVERSATION_ESCAPE;
}

/** A message the Conversation panel's frame posts to the page that frames it. */
export type FrameMessage = ConversationLeave | ConversationEscape;

/** Whether `data`, posted from the panel's frame, has a `FrameMessage`'s shape. */
export function isFrameMessage(data: unknown): data is FrameMessage {
  if (typeof data !== "object" || data === null) return false;
  const { type, href } = data as Record<string, unknown>;
  return type === CONVERSATION_ESCAPE || (type === CONVERSATION_LEAVE && typeof href === "string");
}
