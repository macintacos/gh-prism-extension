// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import contentScript from "../../entrypoints/content";
import { dockSidebar, type Side } from "../../entrypoints/content/sidebar/side";
import { showVisit } from "../../entrypoints/content/visit/land";
import { readFilesRoute } from "../../utils/github/files-route";
import { intentFor } from "../../utils/intent/read";
import {
  byId,
  loadClassicFixture,
  loadFixture,
  loadViewedFixture,
  VIEWED_APP_TOML,
} from "../fixtures/files-page";

// Only leaves are faked: intentFor needs a port fakeBrowser lacks; the views' DOM has own tests.
vi.mock(import("../../utils/intent/read"), async (importOriginal) => ({
  ...(await importOriginal()),
  intentFor: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../entrypoints/content/visit/land"), async (importOriginal) => ({
  ...(await importOriginal()),
  showVisit: vi.fn((_page, _signal, { intent }) => void intent(() => {})),
}));
vi.mock(import("../../entrypoints/content/sidebar/side"), async (importOriginal) => ({
  ...(await importOriginal()),
  dockSidebar: vi.fn(),
}));

const PR = "/o/r/pull/1/changes";
let controller: AbortController;
const run = () => contentScript.main({ signal: controller.signal } as ContentScriptContext);
const docked = () => vi.mocked(dockSidebar).mock.calls.map(([, , options]) => options);
// Runs the MutationObserver's pending microtask, and no timer.
const afterMutations = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetAllMocks();
  vi.useFakeTimers();
  history.replaceState(null, "", PR);
  loadFixture();
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("content script", () => {
  it.each<{ saved?: unknown; opens: Side }>([
    { saved: "left", opens: "left" },
    { saved: "up", opens: "right" },
    { opens: "right" },
  ])(
    "opens the sidebar on the $opens from the first page (saved: $saved)",
    async ({ saved, opens }) => {
      // Raw key on purpose, so the test outlives a move to typed storage items.
      if (saved !== undefined) await fakeBrowser.storage.sync.set({ sidebarSide: saved });

      const sides: Side[] = [];
      // At call time: a saved side read after the first page docks would fix up the shared choice.
      vi.mocked(dockSidebar).mockImplementationOnce((_page, _signal, { choice }) => {
        sides.push(choice.side);
      });

      await run();

      expect(sides).toEqual([opens]);
    },
  );

  it("opens on the right and mounts when reading the saved side fails", async () => {
    const failure = new Error("context invalidated");
    vi.spyOn(fakeBrowser.storage.sync, "get").mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sides: Side[] = [];
    vi.mocked(dockSidebar).mockImplementationOnce((_page, _signal, { choice }) => {
      sides.push(choice.side);
    });

    await run();

    expect(sides).toEqual(["right"]);
    expect(showVisit).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it("saves the side the user picks", async () => {
    await run();
    docked()[0]?.save("left");
    await vi.waitFor(async () =>
      expect(await fakeBrowser.storage.sync.get("sidebarSide")).toEqual({ sidebarSide: "left" }),
    );
  });

  it("logs a failed save instead of throwing it", async () => {
    const failure = new Error("quota");
    vi.spyOn(fakeBrowser.storage.sync, "set").mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await run();
    docked()[0]?.save("left");

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure));
  });

  it("mounts every page of a visit on one shared diff read", async () => {
    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    expect(intentFor).toHaveBeenCalledOnce();
    expect(intentFor).toHaveBeenCalledWith(
      readFilesRoute(PR),
      expect.any(AbortSignal),
      expect.anything(),
      expect.any(Function),
    );

    const shown = vi.mocked(showVisit).mock.calls;
    expect(shown).toHaveLength(2);
    expect(vi.mocked(dockSidebar).mock.calls.map(([page]) => page.sidebar.ownerDocument)).toEqual([
      document,
      document,
    ]);
    expect(docked()[1]?.choice).toBe(docked()[0]?.choice);
  });

  it("reads the diff afresh on the next visit", async () => {
    await run();
    history.pushState(null, "", "/o/r/pull/2/changes");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    expect(intentFor).toHaveBeenCalledTimes(2);
    expect(vi.mocked(intentFor).mock.calls[1]?.[0]).toEqual(readFilesRoute("/o/r/pull/2/changes"));
  });

  it("seeds Viewed state from embedded data on the first visit only", async () => {
    history.replaceState(null, "", "/macintacos/gh-prism-sandbox/pull/3/changes");
    loadViewedFixture();
    const viewedOf = (call: number) => vi.mocked(showVisit).mock.calls.at(call)?.[2].viewed;

    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    expect(viewedOf(0)?.byAnchor.get(VIEWED_APP_TOML)).toBe(true);
    expect(viewedOf(0)?.offered).toBe(true);
    expect(viewedOf(1)).toBe(viewedOf(0));

    history.pushState(null, "", "/o/r/pull/2/changes");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();
    history.pushState(null, "", "/macintacos/gh-prism-sandbox/pull/3/changes");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    expect(viewedOf(-1)?.byAnchor.size).toBe(0);
    expect(viewedOf(-1)?.offered).toBe(false);
  });

  it("ignores embedded Viewed data once GitHub has navigated", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    history.replaceState(null, "", "/macintacos/gh-prism-sandbox/pull/3/changes");
    loadViewedFixture();
    byId("pr-file-tree").remove();

    await run();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(showVisit).not.toHaveBeenCalled();
    loadViewedFixture();
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    const viewed = vi.mocked(showVisit).mock.calls.at(0)?.[2].viewed;
    expect(viewed?.byAnchor.size).toBe(0);
    expect(viewed?.offered).toBe(false);
  });

  it("reads each visit's pin from the page", async () => {
    const script = document.createElement("script");
    script.dataset.target = "react-app.embeddedData";

    const pin = { baseSha: "b".repeat(40), headSha: "a".repeat(40) };
    script.textContent = JSON.stringify({
      payload: {
        pullRequestsLayoutRoute: {
          pullRequest: { number: 1, headSha: pin.headSha },
          repository: { ownerLogin: "o", name: "r" },
        },
        pullRequestsChangesRoute: { diffContents: [{ oldCommitOid: pin.baseSha }] },
      },
    });
    document.body.append(script);

    await run();

    const pr1 = readFilesRoute(PR)?.diff;
    if (!pr1) throw new Error("the fixture's path is a Files route");
    expect(vi.mocked(intentFor).mock.calls[0]?.[2].pinOf?.(pr1)).toEqual(pin);
  });

  it("warns once when the Files changed tree never shows", async () => {
    document.body.innerHTML = "";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await run();
    await vi.advanceTimersByTimeAsync(20_000);
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);

    expect(consoleWarn).toHaveBeenCalledOnce();
  });

  describe("on a classic Files changed page", () => {
    const notice = () => document.querySelector<HTMLElement>(".gh-prism-notice");
    const reopen = () => document.querySelector<HTMLButtonElement>(".gh-prism-notice-reopen");

    beforeEach(() => {
      history.replaceState(null, "", "/o/r/pull/1/files");
      loadClassicFixture("");
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("shows the notice", async () => {
      await run();

      expect(notice()?.hidden).toBe(false);
      expect(reopen()?.hidden).toBe(true);
    });

    it("keeps a dismissal for the next page", async () => {
      await run();
      notice()?.querySelector("button")?.click();
      await vi.waitFor(async () =>
        expect(await fakeBrowser.storage.local.get("classicNoticeDismissed")).toEqual({
          classicNoticeDismissed: true,
        }),
      );
      controller.abort();
      controller = new AbortController();

      await run();

      expect(notice()?.hidden).toBe(true);
      expect(reopen()?.hidden).toBe(false);
    });

    it("shows the notice when reading the saved dismissal fails", async () => {
      const failure = new Error("context invalidated");
      vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValue(failure);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await run();

      expect(notice()?.hidden).toBe(false);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    });

    it("takes the notice away when GitHub navigates to the Conversation tab", async () => {
      await run();

      // The classic markup stays behind, as when popstate fires before GitHub swaps the page.
      history.pushState(null, "", "/o/r/pull/1");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await afterMutations();

      expect(notice()).toBeNull();
      expect(reopen()).toBeNull();
    });
  });
});
