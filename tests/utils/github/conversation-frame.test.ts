import { describe, expect, it, vi } from "vitest";
import {
  conversationFrameUrl,
  conversationFraming,
  framingRule,
  requestFraming,
  withoutFrameAncestors,
} from "../../../utils/github/conversation-frame";
import type { PrRef } from "../../../utils/github/pr-ref";
import githubCsp from "../../fixtures/github-csp.txt?raw";

const POLICY = githubCsp.split("\n")[1] ?? "";
const PR: PrRef = { kind: "pr", owner: "o", repo: "r", number: 7 };
const REQUEST = { pr: PR, policy: POLICY };

const directives = (policy: string) => policy.split("; ");

describe("conversationFrameUrl", () => {
  it("is the Conversation tab carrying the panel marker", () => {
    expect(conversationFrameUrl(PR)).toBe("https://github.com/o/r/pull/7?gh-prism-panel=1");
  });
});

describe("withoutFrameAncestors", () => {
  it("drops frame-ancestors from GitHub's policy", () => {
    expect(withoutFrameAncestors(POLICY)).not.toMatch(/frame-ancestors/);
  });

  it("keeps every other directive as sent", () => {
    const kept = directives(POLICY).filter((d) => !d.startsWith("frame-ancestors"));
    expect(directives(withoutFrameAncestors(POLICY))).toEqual(kept);
  });

  it("matches the directive name in any case", () => {
    expect(withoutFrameAncestors("Frame-Ancestors 'none' ;  default-src 'none' ;")).toBe(
      "default-src 'none'",
    );
  });

  it("filters each policy of a combined header on its own", () => {
    expect(
      withoutFrameAncestors("default-src 'none'; frame-ancestors 'none', script-src 'self'"),
    ).toBe("default-src 'none', script-src 'self'");
  });

  it("leaves a directive that only starts with the name", () => {
    expect(withoutFrameAncestors("frame-ancestors-x a")).toBe("frame-ancestors-x a");
  });
});

describe("framingRule", () => {
  it("lets only the tab's github.com sub-frame load the marked Conversation, keeping the policy", () => {
    expect(framingRule(3, PR, POLICY)).toEqual({
      id: 3,
      priority: 1,
      action: {
        type: "modifyHeaders",
        responseHeaders: [
          { header: "x-frame-options", operation: "remove" },
          {
            header: "content-security-policy",
            operation: "set",
            value: withoutFrameAncestors(POLICY),
          },
        ],
      },
      condition: {
        tabIds: [3],
        resourceTypes: ["sub_frame"],
        initiatorDomains: ["github.com"],
        requestDomains: ["github.com"],
        urlFilter: "|https://github.com/o/r/pull/7?gh-prism-panel=1|",
      },
    });
  });
});

function fakePort(tabId: number | null = 3) {
  let onMessage: (message: unknown) => Promise<void> | void = () => {};
  let onDisconnect: () => void = () => {};
  return {
    sender: tabId === null ? {} : { tab: { id: tabId } },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: {
      addListener(listener: typeof onMessage) {
        onMessage = listener;
      },
    },
    onDisconnect: {
      addListener(listener: typeof onDisconnect) {
        onDisconnect = listener;
      },
    },
    send: (message: unknown) => onMessage(message),
    drop: () => onDisconnect(),
  };
}

function setup() {
  const update = vi.fn(async (_options: unknown) => {});
  return { update, framing: conversationFraming({ update }) };
}

describe("conversationFraming", () => {
  it("installs the sender tab's rule and allows the frame", async () => {
    const { update, framing } = setup();
    const port = fakePort(3);
    framing.serve(port);

    await port.send(REQUEST);

    expect(update).toHaveBeenCalledWith({
      removeRuleIds: [3],
      addRules: [framingRule(3, PR, POLICY)],
    });
    expect(port.postMessage).toHaveBeenCalledWith({ allowed: true });
  });

  it.each([
    ["an invalid owner", { ...REQUEST, pr: { ...PR, owner: ".." } }],
    ["an invalid repo", { ...REQUEST, pr: { ...PR, repo: "a/b" } }],
    ["a non-positive number", { ...REQUEST, pr: { ...PR, number: 0 } }],
    ["a fractional number", { ...REQUEST, pr: { ...PR, number: 1.5 } }],
    ["a missing pr", { policy: POLICY }],
    ["a policy with a line break", { ...REQUEST, policy: `${POLICY}\r\nx-evil: 1` }],
    ["an oversized policy", { ...REQUEST, policy: `default-src 'none'; ${"a".repeat(16384)}` }],
    ["a policy of only frame-ancestors", { ...REQUEST, policy: "frame-ancestors 'none'" }],
    ["a non-string policy", { ...REQUEST, policy: 1 }],
    ["a non-object", "hi"],
  ])("refuses %s without touching rules", async (_name, message) => {
    const { update, framing } = setup();
    const port = fakePort(3);
    framing.serve(port);

    await port.send(message);

    expect(update).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({ allowed: false });
  });

  it("refuses a port with no sender tab", async () => {
    const { update, framing } = setup();
    const port = fakePort(null);
    framing.serve(port);

    await port.send(REQUEST);

    expect(update).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledWith({ allowed: false });
  });

  it("refuses the frame when the rule can't be installed", async () => {
    const update = vi.fn(async () => {
      throw new Error("quota");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const port = fakePort(3);
    conversationFraming({ update }).serve(port);

    await port.send(REQUEST);

    expect(port.postMessage).toHaveBeenCalledWith({ allowed: false });
  });

  it("revokes the tab's rule when its port disconnects", async () => {
    const { update, framing } = setup();
    const port = fakePort(3);
    framing.serve(port);
    await port.send(REQUEST);

    port.drop();

    expect(update).toHaveBeenLastCalledWith({ removeRuleIds: [3] });
  });

  it("keeps the rule when a replaced port disconnects late", async () => {
    const { update, framing } = setup();
    const previous = fakePort(3);
    const current = fakePort(3);
    framing.serve(previous);
    framing.serve(current);
    await previous.send(REQUEST);
    await current.send(REQUEST);
    update.mockClear();

    previous.drop();

    expect(update).not.toHaveBeenCalled();
  });

  it("answers nothing once the port disconnects while the rule installs", async () => {
    const { framing } = setup();
    const port = fakePort(3);
    port.postMessage.mockImplementation(() => {
      throw new Error("Attempting to use a disconnected port object");
    });
    framing.serve(port);

    const sent = port.send(REQUEST);
    port.drop();

    await expect(sent).resolves.toBeUndefined();
  });

  it("installs no rule for a port the tab has since replaced", async () => {
    const { update, framing } = setup();
    const previous = fakePort(3);
    framing.serve(previous);
    framing.serve(fakePort(3));

    await previous.send(REQUEST);

    expect(update).not.toHaveBeenCalled();
    expect(previous.postMessage).toHaveBeenCalledWith({ allowed: false });
  });

  it("revokes a closed tab's rule", () => {
    const { update, framing } = setup();

    framing.forget(3);

    expect(update).toHaveBeenCalledWith({ removeRuleIds: [3] });
  });
});

describe("requestFraming", () => {
  it("asks for the PR's frame and resolves with the answer", async () => {
    const port = fakePort();

    const allowed = requestFraming(() => port, PR, POLICY, new AbortController().signal);
    await port.send({ allowed: true });

    expect(port.postMessage).toHaveBeenCalledWith(REQUEST);
    await expect(allowed).resolves.toBe(true);
  });

  it("keeps the port open after the answer, so the rule stays", async () => {
    const port = fakePort();

    const allowed = requestFraming(() => port, PR, POLICY, new AbortController().signal);
    await port.send({ allowed: true });
    await allowed;

    expect(port.disconnect).not.toHaveBeenCalled();
  });

  it("refuses when the port drops before answering", async () => {
    const port = fakePort();

    const allowed = requestFraming(() => port, PR, POLICY, new AbortController().signal);
    port.drop();

    await expect(allowed).resolves.toBe(false);
  });

  it("disconnects when the signal aborts", () => {
    const port = fakePort();
    const controller = new AbortController();

    void requestFraming(() => port, PR, POLICY, controller.signal);
    controller.abort();

    expect(port.disconnect).toHaveBeenCalled();
  });

  it("refuses without connecting when the signal already aborted", async () => {
    const connect = vi.fn(fakePort);

    const allowed = requestFraming(connect, PR, POLICY, AbortSignal.abort());

    await expect(allowed).resolves.toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});
