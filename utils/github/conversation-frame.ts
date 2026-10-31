import { type Browser, browser } from "wxt/browser";
import { asPrRef, type PrDataPort } from "./pr-port";
import type { PrRef } from "./pr-ref";

type Rule = Browser.declarativeNetRequest.Rule;

/** The `runtime.connect` port name the Conversation panel opens and the service worker serves. */
export const CONVERSATION_FRAME_PORT = "gh-prism:conversation-frame";

const PANEL_MARKER = "gh-prism-panel";

/** The PR's Conversation tab on github.com. */
export const conversationUrl = (pr: PrRef): string =>
  `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`;

/** The URL the panel frames: the Conversation tab plus the marker the framing rule matches. */
export const conversationFrameUrl = (pr: PrRef): string =>
  `${conversationUrl(pr)}?${PANEL_MARKER}=1`;

/** Whether `url` carries the marker of the URL the panel frames. */
export const isConversationFrame = (url: URL): boolean =>
  url.searchParams.get(PANEL_MARKER) === "1";

/**
 * `policy` without its frame-ancestors directive; every other directive kept as sent. A combined
 * header's policies, joined with `", "`, are each filtered on their own.
 */
export function withoutFrameAncestors(policy: string): string {
  return policy
    .split(",")
    .map((single) =>
      single
        .split(";")
        .map((directive) => directive.trim())
        .filter(
          (directive) =>
            directive && directive.split(/\s+/)[0]?.toLowerCase() !== "frame-ancestors",
        )
        .join("; "),
    )
    .filter(Boolean)
    .join(", ");
}

/**
 * The session rule that lets only `tabId`'s panel frame `pr`: it matches only a github.com
 * sub-frame request in that tab for the marked Conversation URL, and keeps GitHub's policy
 * minus frame-ancestors.
 */
export function framingRule(tabId: number, pr: PrRef, policy: string): Rule {
  return {
    // One rule per tab, keyed by the tab's id: any other session rule must not use tab-sized ids.
    id: tabId,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        { header: "x-frame-options", operation: "remove" },
        {
          header: "content-security-policy",
          operation: "set",
          value: withoutFrameAncestors(policy),
        },
      ],
    },
    condition: {
      tabIds: [tabId],
      resourceTypes: ["sub_frame"],
      initiatorDomains: ["github.com"],
      requestDomains: ["github.com"],
      urlFilter: `|${conversationFrameUrl(pr)}|`,
    },
  };
}

/** The slice of `browser.runtime.Port` the service worker uses. */
export type ConversationFramePort = Omit<PrDataPort, "disconnect"> & {
  readonly sender?: { tab?: { id?: number } };
};

/** What the panel sends over {@link CONVERSATION_FRAME_PORT}; the worker answers `{ allowed }`. */
export interface FramingRequest {
  readonly pr: PrRef;
  readonly policy: string;
}

// The policy goes into a response header: CR or LF would let it add headers of its own, and the
// cap sits well above GitHub's few-KB policy while bounding what a page can make the worker store.
const MAX_POLICY_LENGTH = 16384;

// A content script shares a renderer with the page, so its messages are untrusted.
function asFramingRequest(value: unknown): FramingRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { pr: maybePr, policy } = value as Record<string, unknown>;
  const pr = asPrRef(maybePr);
  if (!pr) return undefined;
  if (typeof policy !== "string" || policy.length > MAX_POLICY_LENGTH || /[\r\n]/.test(policy))
    return undefined;
  if (!withoutFrameAncestors(policy)) return undefined;
  return { pr, policy };
}

/**
 * Serves panel ports: validates each request, installs the sender tab's rule, and revokes it when
 * that tab's current port disconnects or `forget` is called for the tab.
 */
export function conversationFraming(rules: {
  update(options: { removeRuleIds: number[]; addRules?: Rule[] }): Promise<void>;
}): { serve(port: ConversationFramePort): void; forget(tabId: number): void } {
  const currentPorts = new Map<number, ConversationFramePort>();

  function revoke(tabId: number): void {
    currentPorts.delete(tabId);
    rules
      .update({ removeRuleIds: [tabId] })
      .catch((error) =>
        console.error("gh-prism: revoking the Conversation frame rule failed", error),
      );
  }

  return {
    serve(port) {
      const tabId = port.sender?.tab?.id;
      let closed = false;
      if (tabId !== undefined) currentPorts.set(tabId, port);
      const answer = (allowed: boolean) => {
        if (!closed) port.postMessage({ allowed });
      };
      port.onDisconnect.addListener(() => {
        closed = true;
        if (tabId !== undefined && currentPorts.get(tabId) === port) revoke(tabId);
      });
      port.onMessage.addListener(async (message) => {
        const request = asFramingRequest(message);
        if (tabId === undefined || currentPorts.get(tabId) !== port || !request) {
          answer(false);
          return;
        }
        try {
          await rules.update({
            removeRuleIds: [tabId],
            addRules: [framingRule(tabId, request.pr, request.policy)],
          });
        } catch (error) {
          console.error("gh-prism: installing the Conversation frame rule failed", error);
          answer(false);
          return;
        }
        answer(true);
      });
    },
    forget: revoke,
  };
}

/**
 * Asks the service worker over a port from `connect` to let this tab's panel frame `pr` under
 * `policy`, resolving whether it did. The port stays open, keeping the rule, until `signal` aborts.
 */
export function requestFraming(
  connect: () => PrDataPort,
  pr: PrRef,
  policy: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  const port = connect();
  signal.addEventListener("abort", () => port.disconnect(), { once: true });
  return new Promise((resolve) => {
    port.onMessage.addListener((message) =>
      resolve(
        typeof message === "object" &&
          message !== null &&
          "allowed" in message &&
          message.allowed === true,
      ),
    );
    port.onDisconnect.addListener(() => resolve(false));
    port.postMessage({ pr, policy } satisfies FramingRequest);
  });
}

/** `requestFraming` over the extension's own Conversation frame port. */
export const allowConversationFrame = (
  pr: PrRef,
  policy: string,
  signal: AbortSignal,
): Promise<boolean> =>
  requestFraming(
    () => browser.runtime.connect({ name: CONVERSATION_FRAME_PORT }),
    pr,
    policy,
    signal,
  );
