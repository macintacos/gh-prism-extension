// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import contentScript from "../entrypoints/content";
import { readFilesRoute } from "../entrypoints/content/files-page";
import { intentFor } from "../entrypoints/content/intent";
import { showSections } from "../entrypoints/content/sections-view";
import { dockSidebar, type Side } from "../entrypoints/content/sidebar-side";
import { byId, loadFixture } from "./fixtures/files-page";

vi.mock(import("../entrypoints/content/intent"), () => ({
  intentFor: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../entrypoints/content/sections-view"), async (importOriginal) => ({
  ...(await importOriginal()),
  showSections: vi.fn(),
}));
vi.mock(import("../entrypoints/content/sidebar-side"), async (importOriginal) => ({
  ...(await importOriginal()),
  dockSidebar: vi.fn(),
}));

const PR = "/o/r/pull/1/changes";
let controller: AbortController;
const run = () =>
  contentScript.main({ signal: controller.signal } as unknown as ContentScriptContext);
const docked = () => vi.mocked(dockSidebar).mock.calls.map(([, , options]) => options);
// Runs the MutationObserver's pending microtask, and no timer.
const afterMutations = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
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
  it.each<{ saved?: Side; opens: Side }>([{ saved: "left", opens: "left" }, { opens: "right" }])(
    "opens the sidebar on the $opens from the first page",
    async ({ saved, opens }) => {
      if (saved) await fakeBrowser.storage.sync.set({ sidebarSide: saved });
      const sides: Side[] = [];
      // Recorded at call time: the shared choice may be mutated later.
      vi.mocked(dockSidebar).mockImplementationOnce((_doc, _signal, { choice }) => {
        sides.push(choice.side);
      });
      await run();
      expect(sides).toEqual([opens]);
    },
  );

  it("saves the side the user picks", async () => {
    await run();
    await docked()[0]?.save("left");
    expect(await fakeBrowser.storage.sync.get("sidebarSide")).toEqual({ sidebarSide: "left" });
  });

  it("logs a failed save instead of throwing it", async () => {
    const failure = new Error("quota");
    vi.spyOn(fakeBrowser.storage.sync, "set").mockRejectedValue(failure);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await run();
    await expect(docked()[0]?.save("left")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.any(String), failure);
  });

  it("shares one diff read across the pages of a visit", async () => {
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
    const shown = vi.mocked(showSections).mock.calls;
    expect(shown).toHaveLength(2);
    expect(shown[1]?.[2]?.intent).toBe(shown[0]?.[2]?.intent);
    expect(vi.mocked(dockSidebar).mock.calls.map(([doc]) => doc)).toEqual([document, document]);
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run();
    await vi.advanceTimersByTimeAsync(20_000);
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(warn).toHaveBeenCalledOnce();
  });
});
