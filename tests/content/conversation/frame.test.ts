// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dressConversationFrame } from "../../../entrypoints/content/conversation/frame";
import {
  CONVERSATION_ESCAPE,
  CONVERSATION_LEAVE,
} from "../../../entrypoints/content/conversation/frame-messages";
import chrome from "../../fixtures/conversation-chrome.html?raw";

const MARKED = "https://github.com/macintacos/gh-prism-sandbox/pull/1?gh-prism-panel=1";

// happy-dom can't nest a cross-origin frame, so the frame's window is the test's document under a
// stand-in top and parent.
function frameWindow(href = MARKED, top: unknown = {}) {
  const parent = { postMessage: vi.fn() };
  const win = { top, parent, location: new URL(href), document } as unknown as Window;
  return { win, posted: parent.postMessage };
}

const hidden = (selector: string) =>
  getComputedStyle(document.querySelector(selector) as Element).display === "none";

// Reports whether the click was prevented, then prevents it so happy-dom doesn't follow the link.
function click(selector: string, init: MouseEventInit = {}): { defaultPrevented: boolean } {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
  let defaultPrevented = false;
  document.addEventListener(
    "click",
    (seen) => {
      defaultPrevented = seen.defaultPrevented;
      seen.preventDefault();
    },
    { once: true },
  );
  document.querySelector(selector)?.dispatchEvent(event);
  return { defaultPrevented };
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-gh-prism-panel");
  document.head.replaceChildren();
  document.body.innerHTML = chrome;
});

describe("dressConversationFrame", () => {
  it("leaves a top-level window undressed", () => {
    const top = frameWindow();
    const win = top.win as unknown as { top: unknown };
    win.top = win;
    dressConversationFrame(top.win);
    expect(document.documentElement.hasAttribute("data-gh-prism-panel")).toBe(false);
    expect(hidden(".js-header-wrapper")).toBe(false);
  });

  it("leaves a frame without the marker undressed", () => {
    const { win, posted } = frameWindow("https://github.com/macintacos/gh-prism-sandbox/pull/1");
    dressConversationFrame(win);
    expect(document.documentElement.hasAttribute("data-gh-prism-panel")).toBe(false);
    expect(click("#files").defaultPrevented).toBe(false);
    expect(posted).not.toHaveBeenCalled();
  });

  it("hides GitHub's site header, PR title bar, sticky title, and tab row in the panel", () => {
    dressConversationFrame(frameWindow().win);
    expect(document.documentElement.hasAttribute("data-gh-prism-panel")).toBe(true);
    expect(hidden(".js-header-wrapper")).toBe(true);
    expect(hidden('header[class*="PageLayout-Header"]')).toBe(true);
    expect(hidden(".timeline")).toBe(false);
  });

  it("still dresses a page missing a hook", () => {
    document.querySelector(".js-header-wrapper")?.remove();
    expect(() => dressConversationFrame(frameWindow().win)).not.toThrow();
    expect(hidden('header[class*="PageLayout-Header"]')).toBe(true);
  });

  it("lets a fragment link scroll the Conversation", () => {
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    expect(click("#jump-comment").defaultPrevented).toBe(false);
    expect(posted).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an absolute permalink",
      "https://github.com/macintacos/gh-prism-sandbox/pull/1#issuecomment-1",
      "#issuecomment-1",
    ],
    [
      "a root-relative permalink",
      "/macintacos/gh-prism-sandbox/pull/1#pullrequestreview-1",
      "#pullrequestreview-1",
    ],
    ["a plain link to the Conversation", "/macintacos/gh-prism-sandbox/pull/1", ""],
  ])("keeps %s in the panel, moving only the hash", (_, href, hash) => {
    document.body.insertAdjacentHTML("beforeend", `<a id="same-pr" href="${href}">x</a>`);
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    expect(click("#same-pr").defaultPrevented).toBe(true);
    expect(posted).not.toHaveBeenCalled();
    expect(win.location.hash).toBe(hash);
    expect(win.location.search).toBe("?gh-prism-panel=1");
  });

  it.each([
    ["#files", "https://github.com/macintacos/gh-prism-sandbox/pull/1/files"],
    ["#other-repo", "https://github.com/macintacos/other/issues/2"],
    ["#other-site", "https://example.com/docs"],
  ])("hands %s, a link leaving the Conversation, to the parent", (id, href) => {
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    expect(click(id).defaultPrevented).toBe(true);
    expect(posted).toHaveBeenCalledWith({ type: CONVERSATION_LEAVE, href }, "https://github.com");
  });

  it.each<[string, string, MouseEventInit]>([
    ["a modified click", "#files", { metaKey: true }],
    ["a middle click", "#files", { button: 1 }],
    ["a target=_blank link", "#blank", {}],
  ])("lets %s through", (_, id, init) => {
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    expect(click(id, init).defaultPrevented).toBe(false);
    expect(posted).not.toHaveBeenCalled();
  });

  it("relays Escape to the parent", () => {
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(posted).toHaveBeenCalledWith({ type: CONVERSATION_ESCAPE }, "https://github.com");
  });

  it("keeps an Escape GitHub handled or typed in an editable", () => {
    const { win, posted } = frameWindow();
    dressConversationFrame(win);
    document.body.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    document
      .querySelector("#reply")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(posted).not.toHaveBeenCalled();
  });
});
