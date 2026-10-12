// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import contentScript from "../entrypoints/content";
import { dockSidebar, type Side } from "../entrypoints/content/sidebar-side";
import { showVisit } from "../entrypoints/content/visit";
import { readFilesRoute } from "../utils/files-route";
import { intentFor } from "../utils/intent";
import { byId, loadFixture } from "./fixtures/files-page";

// Only leaves are faked: intentFor needs a port fakeBrowser lacks; the views' DOM has own tests.
vi.mock(import("../utils/intent"), async (importOriginal) => ({
  ...(await importOriginal()),
  intentFor: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../entrypoints/content/visit"), async (importOriginal) => ({
  ...(await importOriginal()),
  showVisit: vi.fn((_page, _signal, { intent }) => void intent(() => {})),
}));
vi.mock(import("../entrypoints/content/sidebar-side"), async (importOriginal) => ({
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
      vi.mocked(dockSidebar).mockImplementationOnce((_doc, _signal, { choice }) => {
        sides.push(choice.side);
      });
      await run();
      expect(sides).toEqual([opens]);
    },
  );

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
    expect(vi.mocked(dockSidebar).mock.calls.map(([doc]) => doc)).toEqual([document, document]);
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

  it("warns once when the Files changed tree never shows", async () => {
    document.body.innerHTML = "";
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run();
    await vi.advanceTimersByTimeAsync(20_000);
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(consoleWarn).toHaveBeenCalledOnce();
  });
});
