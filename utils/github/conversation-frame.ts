import { type Browser, browser } from "wxt/browser";
import { isOwnerOrRepo } from "./pr-port";
import type { PrRef } from "./pr-ref";

type Rule = Browser.declarativeNetRequest.Rule;

/** The `runtime.connect` port name the Conversation panel opens and the service worker serves. */
export const CONVERSATION_FRAME_PORT = "gh-prism:conversation-frame";

const MAX_POLICY_LENGTH = 16384;

/** The URL the panel frames: the Conversation tab plus the marker the framing rule matches. */
export const conversationFrameUrl = (pr: PrRef): string =>
  `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}?gh-prism-panel=1`;

/** Whether `url` carries the marker of the URL the panel frames. */
export const isConversationFrame = (url: URL): boolean =>
  url.searchParams.get("gh-prism-panel") === "1";

/** `policy` without its frame-ancestors directive; every other directive kept as sent. */
export function withoutFrameAncestors(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter(
      (directive) => directive && directive.split(/\s+/)[0]?.toLowerCase() !== "frame-ancestors",
    )
    .join("; ");
}

/**
 * The session rule that lets only `tabId`'s panel frame `pr`: it matches only a github.com
 * sub-frame request in that tab for the marked Conversation URL, and keeps GitHub's policy
 * minus frame-ancestors.
 */
export function framingRule(tabId: number, pr: PrRef, policy: string): Rule {
  return {
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
export interface ConversationFramePort {
  readonly sender?: { tab?: { id?: number } };
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

interface FramingRequest {
  pr: PrRef;
  policy: string;
}

// A content script shares a renderer with the page, so its messages are untrusted.
function asFramingRequest(value: unknown): FramingRequest | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { owner, repo, number, policy } = value as Record<string, unknown>;
  if (!isOwnerOrRepo(owner) || !isOwnerOrRepo(repo)) return undefined;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return undefined;
  if (typeof policy !== "string" || policy.length > MAX_POLICY_LENGTH || /[\r\n]/.test(policy))
    return undefined;
  if (!withoutFrameAncestors(policy)) return undefined;
  return { pr: { kind: "pr", owner, repo, number }, policy };
}

/**
 * Serves panel ports: validates each request, installs the sender tab's rule, and revokes it when
 * that tab's current port disconnects or `forget` is called for the tab.
 */
export function conversationFraming(rules: {
  update(options: { removeRuleIds: number[]; addRules?: Rule[] }): Promise<void>;
}): { serve(port: ConversationFramePort): void; forget(tabId: number): void } {
  const current = new Map<number, ConversationFramePort>();

  function revoke(tabId: number): void {
    current.delete(tabId);
    rules.update({ removeRuleIds: [tabId] }).catch(console.error);
  }

  return {
    serve(port) {
      const tabId = port.sender?.tab?.id;
      if (tabId !== undefined) current.set(tabId, port);
      port.onDisconnect.addListener(() => {
        if (tabId !== undefined && current.get(tabId) === port) revoke(tabId);
      });
      port.onMessage.addListener(async (message) => {
        const request = asFramingRequest(message);
        if (tabId === undefined || !request) {
          port.postMessage({ allowed: false });
          return;
        }
        try {
          await rules.update({
            removeRuleIds: [tabId],
            addRules: [framingRule(tabId, request.pr, request.policy)],
          });
        } catch (error) {
          console.error("gh-prism: installing the Conversation frame rule failed", error);
          port.postMessage({ allowed: false });
          return;
        }
        port.postMessage({ allowed: true });
      });
    },
    forget: revoke,
  };
}

/** The slice of `browser.runtime.Port` the panel uses. */
export interface ConversationFrameClientPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

/**
 * Asks the service worker over a port from `connect` to let this tab's panel frame `pr` under
 * `policy`, resolving whether it did. The port stays open, keeping the rule, until `signal` aborts.
 */
export function requestFraming(
  connect: () => ConversationFrameClientPort,
  pr: PrRef,
  policy: string,
  signal: AbortSignal,
): Promise<boolean> {
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
    port.postMessage({ owner: pr.owner, repo: pr.repo, number: pr.number, policy });
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
