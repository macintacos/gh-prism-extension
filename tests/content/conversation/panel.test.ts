// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_ESCAPE,
  CONVERSATION_KEY,
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
import { setViewport } from "../../fixtures/viewport";

const PR: PrRef = { kind: "pr", owner: "o", repo: "r", number: 7 };
const POLICY = "default-src 'none'; frame-ancestors 'none'";

const headOk = () =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200, headers: { "content-security-policy": POLICY } }),
  );

// Every relayed key reaches each open panel's listeners, so a test's panel must end with it.
const visits: AbortController[] = [];

const closed = (): ConversationChoice => ({ open: false, pinned: false, width: 300 });

function setup({
  choice = closed(),
  fetch = headOk(),
  allowFraming = vi.fn(async () => true),
  pr = PR,
} = {}) {
  const visit = new AbortController();
  visits.push(visit);
  const savePinned = vi.fn();
  const saveWidth = vi.fn();
  const panel = conversationPanel(document, {
    pr,
    choice,
    fetch: fetch as unknown as typeof globalThis.fetch,
    allowFraming,
    savePinned,
    saveWidth,
    visit: visit.signal,
  });
  return { panel, visit, choice, fetch, allowFraming, savePinned, saveWidth };
}

const WIDE = { width: 1400, height: 768 };
const NARROW = { width: 1024, height: 768 };

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
  for (const visit of visits.splice(0)) visit.abort();
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

describe("a press the page re-mounts the button under", () => {
  // GitHub hydrates the toolbar on the first press and re-renders it, so the press starts on one
  // button and ends on its replacement, and the browser fires no click.
  it("opens the panel when released on the replacement", () => {
    const { panel } = setup();
    const first = new AbortController();
    mountButton(panel, first.signal)?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );

    first.abort();
    mountButton(panel)?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(shown()).toBe(true);
  });

  it("forgets a press released elsewhere", () => {
    const { panel } = setup();
    const first = new AbortController();
    mountButton(panel, first.signal)?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    first.abort();
    mountButton(panel)?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    expect(shown()).toBe(false);
  });

  it("still opens the panel once for a press on an unchanged button", () => {
    const { panel } = setup();
    const control = mountButton(panel);

    control?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    control?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    control?.click();

    expect(shown()).toBe(true);
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

  it("stays open on an Escape in a text field", () => {
    const { panel } = setup();
    mountButton(panel)?.click();
    const field = document.createElement("textarea");
    document.body.append(field);

    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(panel.open).toBe(true);
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

describe("Shift+\\", () => {
  const pressShiftBackslash = (target: EventTarget = document.body, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "|", shiftKey: true, bubbles: true, ...init }),
    );

  it("opens the panel, moving focus into it, and closes it, returning focus to the button", () => {
    const { panel } = setup();
    const control = mountButton(panel);

    pressShiftBackslash();
    const focusedOpen = document.activeElement;
    pressShiftBackslash();

    expect(focusedOpen).toBe(aside());
    expect(panel.open).toBe(false);
    expect(document.activeElement).toBe(control);
  });

  it("closes a pinned panel, as the button does", () => {
    setViewport(WIDE);
    const { panel } = setup({ choice: { open: true, pinned: true, width: 300 } });
    mountButton(panel);

    pressShiftBackslash();

    expect(panel.open).toBe(false);
  });

  it("is left alone in a field, with a modifier, or on a repeat", () => {
    const { panel } = setup();
    mountButton(panel);
    const field = document.body.appendChild(document.createElement("textarea"));

    pressShiftBackslash(field);
    pressShiftBackslash(document.body, { metaKey: true });
    pressShiftBackslash(document.body, { repeat: true });

    expect(panel.open).toBe(false);
  });

  it("stops once the visit ends", () => {
    const { panel, visit } = setup();
    mountButton(panel);
    visit.abort();

    pressShiftBackslash();

    expect(panel.open).toBe(false);
  });

  it("is named on the button for assistive technology, and shown on it as a hidden keycap", () => {
    const { panel } = setup();
    const control = mountButton(panel);

    expect(control?.getAttribute("aria-keyshortcuts")).toBe("Shift+\\");
    const key = control?.querySelector("kbd");
    expect(key?.textContent).toBe("⇧\\");
    expect(key?.getAttribute("aria-hidden")).toBe("true");
    expect(control?.lastElementChild).toBe(key);
  });
});

describe("messages from the frame", () => {
  it("closes on a Shift+\\ the frame relays", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    post({ type: CONVERSATION_KEY, key: "Shift+\\" });

    expect(panel.open).toBe(false);
  });

  it("presses a relayed \\ on the page, for the tree's key to take", () => {
    const { panel } = setup();
    mountButton(panel)?.click();
    const keys: string[] = [];
    document.addEventListener("keydown", (event) => keys.push(event.key));

    post({ type: CONVERSATION_KEY, key: "\\" });

    expect(keys).toEqual(["\\"]);
  });

  it("ignores a relayed key from another window", () => {
    const { panel } = setup();
    mountButton(panel)?.click();

    post({ type: CONVERSATION_KEY, key: "Shift+\\" }, { source: window });

    expect(panel.open).toBe(true);
  });

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

  describe("a load", () => {
    // Chrome's error page for a refused frame is cross-origin, so it has no reachable document.
    const refuse = () =>
      vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockReturnValue(null);
    const accept = () =>
      vi.spyOn(HTMLIFrameElement.prototype, "contentDocument", "get").mockReturnValue(document);
    const framed = async () => {
      const { panel } = setup();
      mountButton(panel)?.click();
      await vi.waitFor(() => expect(frame()?.getAttribute("src")).toBeTruthy());
      return frame();
    };
    const state = () => aside()?.dataset.state;

    it("fails when the Conversation refuses framing", async () => {
      const framedAt = await framed();
      refuse();

      framedAt?.dispatchEvent(new Event("load"));

      expect(state()).toBe("failed");
    });

    it("ignores the empty frame's load before it has a source", () => {
      const { panel } = setup();
      mountButton(panel)?.click();
      refuse();

      frame()?.dispatchEvent(new Event("load"));

      expect(state()).toBe("loading");
    });

    it("points a frame that left the Conversation back at it, keeping the frame", async () => {
      const framedAt = await framed();
      accept();
      framedAt?.dispatchEvent(new Event("load"));
      framedAt?.setAttribute("src", "https://github.com/o/r/pull/1");
      refuse();

      framedAt?.dispatchEvent(new Event("load"));

      expect(frame()).toBe(framedAt);
      expect(framedAt?.getAttribute("src")).toBe("https://github.com/o/r/pull/7?gh-prism-panel=1");
      expect(state()).toBe("loaded");
    });

    it("fails when the pointed-back frame is refused too", async () => {
      const framedAt = await framed();
      accept();
      framedAt?.dispatchEvent(new Event("load"));
      refuse();
      framedAt?.dispatchEvent(new Event("load"));

      framedAt?.dispatchEvent(new Event("load"));

      expect(state()).toBe("failed");
    });
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
    const choice = closed();
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

describe("pinning", () => {
  const pin = () => aside()?.querySelector<HTMLButtonElement>(".gh-prism-conversation-pin");
  const separator = () => aside()?.querySelector<HTMLElement>('[role="separator"]');
  const root = document.documentElement;
  const pinnedWidth = () => root.style.getPropertyValue("--gh-prism-conversation-width");
  const pressEscape = () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  const openPinned = () => {
    const parts = setup({ choice: { open: false, pinned: true, width: 300 } });
    mountButton(parts.panel)?.click();
    return parts;
  };

  beforeEach(() => setViewport(WIDE));
  afterEach(() => {
    setViewport(NARROW);
    delete root.dataset.ghPrismConversation;
    root.style.removeProperty("--gh-prism-conversation-width");
  });

  it("pins from its header, pushing the page over by its width and saying so", () => {
    const { panel, choice, savePinned } = setup();
    mountButton(panel)?.click();

    pin()?.click();

    expect(pin()?.getAttribute("aria-pressed")).toBe("true");
    expect(root.dataset.ghPrismConversation).toBe("pinned");
    expect(pinnedWidth()).toBe("300px");
    expect(separator()?.hidden).toBe(false);
    expect(choice.pinned).toBe(true);
    expect(savePinned).toHaveBeenCalledWith(true);
  });

  it("unpins back to the overlay, letting the page back", () => {
    const { savePinned } = openPinned();

    pin()?.click();

    expect(pin()?.getAttribute("aria-pressed")).toBe("false");
    expect(root.dataset.ghPrismConversation).toBeUndefined();
    expect(pinnedWidth()).toBe("");
    expect(savePinned).toHaveBeenLastCalledWith(false);
  });

  describe("the page's slide", () => {
    const animate = vi.fn();
    beforeEach(() => Object.assign(root, { animate }));
    afterEach(() => {
      Reflect.deleteProperty(root, "animate");
      animate.mockReset();
    });
    const slide = (from: string, to: string, duration: number) =>
      expect(animate).toHaveBeenLastCalledWith(
        [{ paddingInlineStart: from }, { paddingInlineStart: to }],
        expect.objectContaining({ duration }),
      );

    it("pushes the page over as the panel pins", () => {
      const { panel } = setup();
      mountButton(panel)?.click();

      pin()?.click();

      slide("0px", "300px", 280);
    });

    it("draws the page back as the panel unpins", () => {
      openPinned();

      pin()?.click();

      slide("300px", "0px", 280);
    });

    it("draws the page back quicker as a pinned panel closes", () => {
      const { panel } = openPinned();

      panel.close();

      slide("300px", "0px", 160);
    });

    it("stops sliding when the window narrows past the column mid-slide", () => {
      const finish = vi.fn();
      animate.mockReturnValue({ finish });
      openPinned();

      setViewport(NARROW);
      window.dispatchEvent(new Event("resize"));

      expect(finish).toHaveBeenCalled();
    });

    it("holds still under reduced motion", () => {
      const matchMedia = vi
        .spyOn(window, "matchMedia")
        .mockReturnValue({ matches: true } as MediaQueryList);
      openPinned();
      matchMedia.mockRestore();

      expect(animate).not.toHaveBeenCalled();
    });

    it("holds still when a visit opens it pinned", () => {
      setup({ choice: { open: true, pinned: true, width: 300 } });

      expect(animate).not.toHaveBeenCalled();
    });
  });

  it("keeps its frame through pinning and unpinning", () => {
    setup().panel.toggle();
    const framed = frame();

    pin()?.click();
    pin()?.click();

    expect(frame()).toBe(framed);
  });

  it("offers no pin on a window too narrow for the column, drawing a pinned panel as the overlay", () => {
    const { choice } = openPinned();

    setViewport(NARROW);

    expect(pin()?.hidden).toBe(true);
    expect(root.dataset.ghPrismConversation).toBeUndefined();
    expect(choice.pinned).toBe(true);

    setViewport(WIDE);

    expect(pin()?.hidden).toBe(false);
    expect(root.dataset.ghPrismConversation).toBe("pinned");
  });

  it("stays open, pinned, on Escape and a pointerdown outside it", () => {
    const { panel } = openPinned();

    pressEscape();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    expect(panel.open).toBe(true);
  });

  it("closes, pinned, from its close button, letting the page back", () => {
    const { panel, choice } = openPinned();

    aside()?.querySelector<HTMLButtonElement>(".gh-prism-conversation-close")?.click();

    expect(panel.open).toBe(false);
    expect(root.dataset.ghPrismConversation).toBeUndefined();
    expect(choice.pinned).toBe(true);
  });

  it("steps its pinned width by arrow key within the window's bounds, saving each width", () => {
    const { choice, saveWidth } = openPinned();

    separator()?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(pinnedWidth()).toBe("303px");
    expect(choice.width).toBe(303);
    expect(saveWidth).toHaveBeenCalledWith(303);

    for (let i = 0; i < 40; i++)
      separator()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );

    expect(pinnedWidth()).toBe("388px");
  });

  it("opens pinned on a visit whose choice is open, without taking focus", () => {
    const control = document.createElement("button");
    document.body.append(control);
    control.focus();

    setup({ choice: { open: true, pinned: true, width: 300 } });

    expect(root.dataset.ghPrismConversation).toBe("pinned");
    expect(document.activeElement).toBe(control);
  });

  it("lets the page back when the visit ends", () => {
    const { visit } = openPinned();

    visit.abort();

    expect(root.dataset.ghPrismConversation).toBeUndefined();
    expect(pinnedWidth()).toBe("");
  });
});

describe("resizing the overlay", () => {
  const separator = () => aside()?.querySelector<HTMLElement>('[role="separator"]');
  const pin = () => aside()?.querySelector<HTMLButtonElement>(".gh-prism-conversation-pin");
  const root = document.documentElement;
  const press = (key: string, times = 1) => {
    for (let i = 0; i < times; i++)
      separator()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  };
  const openOverlay = (choice: Partial<ConversationChoice> = {}) => {
    const parts = setup({ choice: { ...closed(), ...choice } });
    mountButton(parts.panel)?.click();
    return parts;
  };

  beforeEach(() => setViewport(WIDE));
  afterEach(() => {
    setViewport(NARROW);
    delete root.dataset.ghPrismConversation;
    root.style.removeProperty("--gh-prism-conversation-width");
    root.style.removeProperty("padding-inline-start");
  });

  it("draws the overlay at the chosen width, with its separator", () => {
    openOverlay();

    expect(separator()?.hidden).toBe(false);
    expect(aside()?.style.width).toBe("300px");
  });

  it("steps the overlay's width by arrow key, saving each width", () => {
    const { choice, saveWidth } = openOverlay();

    press("ArrowRight");

    expect(aside()?.style.width).toBe("303px");
    expect(choice.width).toBe(303);
    expect(saveWidth).toHaveBeenCalledWith(303);
  });

  it("holds the overlay to the window less a strip of page, past the column's bound", () => {
    openOverlay({ width: 1500 });

    expect(aside()?.style.width).toBe(`${WIDE.width - 48}px`);
    expect(separator()?.getAttribute("aria-valuemax")).toBe(String(WIDE.width - 48));
  });

  it("resizes the overlay on a window too narrow for the column", () => {
    setViewport(NARROW);
    const { choice } = openOverlay({ pinned: true, width: 600 });

    press("ArrowRight");

    expect(choice.width).toBe(603);
    expect(aside()?.style.width).toBe("603px");
  });

  it("leaves the page alone while it resizes the overlay", () => {
    openOverlay();

    press("ArrowRight", 5);

    expect(root.style.getPropertyValue("--gh-prism-conversation-width")).toBe("");
    expect(root.style.paddingInlineStart).toBe("");
    expect(root.dataset.ghPrismConversation).toBeUndefined();
  });

  it("pins at the overlay's width, held to the column's bound", () => {
    const { choice } = openOverlay({ width: 380 });
    press("ArrowRight", 10);

    pin()?.click();

    expect(choice.width).toBe(410);
    expect(aside()?.style.width).toBe(`${WIDE.width - 1012}px`);
    expect(root.style.getPropertyValue("--gh-prism-conversation-width")).toBe(
      `${WIDE.width - 1012}px`,
    );
  });

  it("stays open on a pointerdown on its separator", () => {
    const { panel } = openOverlay();

    separator()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));

    expect(panel.open).toBe(true);
  });
});
