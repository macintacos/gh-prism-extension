// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_ESCAPE,
  CONVERSATION_LEAVE,
} from "../../../entrypoints/content/conversation/frame-messages";
import {
  type ConversationChoice,
  conversationPanel,
  showConversationButton,
} from "../../../entrypoints/content/conversation/panel";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import type { PrRef } from "../../../utils/github/pr-ref";
import fixture from "../../fixtures/files-page.html?raw";

const PR: PrRef = { kind: "pr", owner: "o", repo: "r", number: 7 };
const POLICY = "default-src 'none'; frame-ancestors 'none'";

const headOk = () =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200, headers: { "content-security-policy": POLICY } }),
  );

function setup({
  choice = { open: false } as ConversationChoice,
  fetch = headOk(),
  allowFraming = vi.fn(async () => true),
  pr = PR,
} = {}) {
  const visit = new AbortController();
  const panel = conversationPanel(document, {
    pr,
    choice,
    fetch: fetch as unknown as typeof globalThis.fetch,
    allowFraming,
    visit: visit.signal,
  });
  return { panel, visit, choice, fetch, allowFraming };
}

function page(): FilesPage {
  const found = findFilesPage(document);
  if (!found) throw new Error("fixture has no Files page");
  return found;
}

function mountButton(
  panel: ReturnType<typeof setup>["panel"],
  signal = new AbortController().signal,
) {
  showConversationButton(page(), signal, panel);
  return button();
}

const button = () => document.querySelector<HTMLButtonElement>(".gh-prism-conversation-button");
const aside = () => document.getElementById("gh-prism-conversation");
const frame = () => aside()?.querySelector("iframe") ?? null;
const shown = () => aside() !== null && !aside()?.hidden;

function post(data: unknown, init: { source?: unknown; origin?: string } = {}) {
  const event = new MessageEvent("message", {
    data,
    origin: init.origin ?? "https://github.com",
    source: (init.source === undefined ? frame()?.contentWindow : init.source) as Window | null,
  });
  window.dispatchEvent(event);
}

// happy-dom can't load a frame from github.com, so a loaded frame's window is a stand-in.
const frameWindow = {} as Window;

beforeEach(() => {
  (
    window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
  ).happyDOM.settings.disableIframePageLoading = true;
  // happy-dom reports each frame it declines to load as a console error.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(frameWindow);
  document.body.innerHTML = fixture;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = "";
});

describe("showConversationButton", () => {
  it("mounts first in the toolbar row", () => {
    const { panel } = setup();

    mountButton(panel);

    expect(document.querySelector('section[class*="toolbar__"]')?.firstElementChild).toBe(button());
  });

  it("is removed when its signal aborts", () => {
    const { panel } = setup();
    const signal = new AbortController();

    mountButton(panel, signal.signal);
    signal.abort();

    expect(button()).toBeNull();
  });
});

describe("the button's expanded state", () => {
  it("follows the panel opening and closing", () => {
    const { panel } = setup();
    const control = mountButton(panel);

    control?.click();
    const opened = control?.getAttribute("aria-expanded");
    control?.click();

    expect(opened).toBe("true");
    expect(control?.getAttribute("aria-expanded")).toBe("false");
  });

  it("survives the page re-mounting the button", () => {
    const { panel } = setup();
    const first = new AbortController();
    mountButton(panel, first.signal)?.click();

    first.abort();
    mountButton(panel);

    expect(document.querySelectorAll(".gh-prism-conversation-button")).toHaveLength(1);
    expect(button()?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("focus", () => {
  it("moves into the panel when the reviewer opens it", () => {
    const { panel } = setup();

    mountButton(panel)?.click();

    expect(document.activeElement).toBe(aside());
  });

  it("returns to the button when the panel closes", () => {
    const { panel } = setup();
    const control = mountButton(panel);
    control?.click();

    panel.close();

    expect(document.activeElement).toBe(control);
  });
});

describe("dismissing the overlay", () => {
  it("closes on Escape", () => {
    const { panel, choice } = setup();
    mountButton(panel)?.click();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(shown()).toBe(false);
    expect(choice.open).toBe(false);
  });

  it("closes on a pointerdown outside it", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(panel.open).toBe(false);
  });

  it("stays open on a pointerdown inside it", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    aside()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(panel.open).toBe(true);
  });

  it("closes once when the button is pressed, not twice", () => {
    const { panel } = setup();
    const control = mountButton(panel);
    control?.click();

    control?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    control?.click();

    expect(panel.open).toBe(false);
  });

  it("closes on the close button", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    aside()?.querySelector<HTMLButtonElement>(".gh-prism-conversation-close")?.click();

    expect(panel.open).toBe(false);
  });
});

describe("messages from the frame", () => {
  it("closes on an Escape the frame relays", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    post({ type: CONVERSATION_ESCAPE });

    expect(panel.open).toBe(false);
  });

  it("ignores a message from another window", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    post({ type: CONVERSATION_ESCAPE }, { source: window });

    expect(panel.open).toBe(true);
  });

  it("ignores a message from another origin", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    post({ type: CONVERSATION_ESCAPE }, { origin: "https://evil.example" });

    expect(panel.open).toBe(true);
  });

  it("loads a leaving link in the page", () => {
    const { panel } = setup();
    mountButton(panel)?.click();
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener("click", clicked);

    post({ type: CONVERSATION_LEAVE, href: "https://github.com/o/r/pull/7/commits" });

    expect((clicked.mock.calls[0]?.[0]?.target as HTMLAnchorElement | undefined)?.href).toBe(
      "https://github.com/o/r/pull/7/commits",
    );
    document.removeEventListener("click", clicked);
  });

  it("drops a leaving link that isn't http(s)", () => {
    const { panel } = setup();
    mountButton(panel)?.click();
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener("click", clicked);

    post({ type: CONVERSATION_LEAVE, href: "javascript:alert(1)" });

    expect(clicked).not.toHaveBeenCalled();
    document.removeEventListener("click", clicked);
  });
});

describe("loading the frame", () => {
  it("frames the marked Conversation once the rule is in", async () => {
    const { panel, allowFraming } = setup();

    mountButton(panel)?.click();

    await vi.waitFor(() =>
      expect(frame()?.getAttribute("src")).toBe("https://github.com/o/r/pull/7?gh-prism-panel=1"),
    );
    expect(allowFraming).toHaveBeenCalledWith(PR, POLICY, expect.any(AbortSignal));
  });

  it.each([
    ["isn't ok", vi.fn(async () => new Response(null, { status: 404 })), async () => true],
    ["has no policy", vi.fn(async () => new Response(null, { status: 200 })), async () => true],
    ["is refused framing", headOk(), async () => false],
  ])("fails when the Conversation %s, linking to its tab", async (_case, fetch, allow) => {
    const { panel } = setup({ fetch, allowFraming: vi.fn(allow) });

    mountButton(panel)?.click();

    await vi.waitFor(() =>
      expect(aside()?.querySelector<HTMLAnchorElement>("a")?.href).toBe(
        "https://github.com/o/r/pull/7",
      ),
    );
    expect(frame()?.hasAttribute("src") ?? false).toBe(false);
  });

  it("reuses the frame when reopened", async () => {
    const { panel, fetch } = setup();
    const control = mountButton(panel);
    control?.click();
    await vi.waitFor(() => expect(frame()?.getAttribute("src")).toBeTruthy());
    const first = frame();

    control?.click();
    control?.click();

    expect(frame()).toBe(first);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("the visit's lifetime", () => {
  it("removes the panel when the visit ends", () => {
    const { panel, visit } = setup();
    mountButton(panel)?.click();

    visit.abort();

    expect(aside()).toBeNull();
  });

  it("opens on the next visit's pull request without taking focus", async () => {
    const choice: ConversationChoice = { open: false };
    const first = setup({ choice });
    mountButton(first.panel)?.click();
    first.visit.abort();
    const control = button();
    control?.focus();

    const next = setup({ choice, pr: { ...PR, number: 8 } });

    expect(next.panel.open).toBe(true);
    expect(document.activeElement).toBe(control);
    await vi.waitFor(() =>
      expect(frame()?.getAttribute("src")).toBe("https://github.com/o/r/pull/8?gh-prism-panel=1"),
    );
  });
});
