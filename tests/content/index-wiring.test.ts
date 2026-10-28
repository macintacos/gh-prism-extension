// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import contentScript from "../../entrypoints/content";
import { showOwnerSection } from "../../entrypoints/content/sidebar/owner-section";
import { dockSidebar, type Side } from "../../entrypoints/content/sidebar/side";
import { showHeaderTab, showVisit } from "../../entrypoints/content/visit/land";
import { readCodeOwners, readPrReviewers } from "../../utils/github/code-owners";
import { readFilesRoute } from "../../utils/github/files-route";
import { intentFor } from "../../utils/intent/read";
import { type DiffstatView, whatsNewSeen } from "../../utils/prefs";
import { routedFetch } from "../fixtures/fetch";
import {
  byId,
  loadClassicFixture,
  loadCommitFixture,
  loadFixture,
  loadHeaderFixture,
  loadViewedFixture,
  VIEWED_APP_TOML,
} from "../fixtures/files-page";

// Only leaves are faked: intentFor needs a port fakeBrowser lacks; the views' DOM has own tests.
vi.mock(import("../../utils/intent/read"), async (importOriginal) => ({
  ...(await importOriginal()),
  intentFor: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../utils/github/code-owners"), async (importOriginal) => ({
  ...(await importOriginal()),
  readCodeOwners: vi.fn(() => new Promise<never>(() => {})),
  readPrReviewers: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../entrypoints/content/visit/land"), async (importOriginal) => ({
  ...(await importOriginal()),
  showVisit: vi.fn((_page, _signal, { intent }) => void intent(() => {})),
  showHeaderTab: vi.fn((_page, _signal, { intent }) => void intent(() => {})),
}));
vi.mock(import("../../entrypoints/content/sidebar/owner-section"), async (importOriginal) => ({
  ...(await importOriginal()),
  showOwnerSection: vi.fn(),
}));
vi.mock(import("../../entrypoints/content/sidebar/side"), async (importOriginal) => ({
  ...(await importOriginal()),
  dockSidebar: vi.fn(),
}));

const PR = "/o/r/pull/1/changes";
let controller: AbortController;
const run = () => {
  const { signal } = controller;
  const onInvalidated = (cb: () => void) => signal.addEventListener("abort", cb);
  return contentScript.main({ signal, onInvalidated } as ContentScriptContext);
};
const docked = () => vi.mocked(dockSidebar).mock.calls.map(([, , options]) => options);
// Runs the MutationObserver's pending microtask, and no timer.
const afterMutations = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  fakeBrowser.reset();
  vi.resetAllMocks();
  // main reads the version on every run; fakeBrowser leaves runtime.getManifest unmocked.
  vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
    manifest_version: 3,
    name: "gh-prism",
    version: "0.0.0",
  });
  vi.useFakeTimers();
  history.replaceState(null, "", PR);
  loadFixture();
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

  it("opens on the right and the breakout and mounts when reading saved choices fails", async () => {
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
    expect(vi.mocked(showVisit).mock.calls[0]?.[2].diffstat.choice.view).toBe("breakout");
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

  it.each<{ saved?: unknown; opens: DiffstatView }>([
    { saved: "total", opens: "total" },
    { saved: "sideways", opens: "breakout" },
    { opens: "breakout" },
  ])(
    "opens the header counter on the $opens from the first page (saved: $saved)",
    async ({ saved, opens }) => {
      // Raw key on purpose, so the test outlives a move to typed storage items.
      if (saved !== undefined) await fakeBrowser.storage.sync.set({ diffstatView: saved });
      const views: DiffstatView[] = [];
      vi.mocked(showVisit).mockImplementationOnce((_page, _signal, { diffstat }) => {
        views.push(diffstat.choice.view);
      });

      await run();

      expect(views).toEqual([opens]);
    },
  );

  it("opens a commit, after a reload, on the view a pull request switched to", async () => {
    await run();
    vi.mocked(showVisit).mock.calls[0]?.[2].diffstat.save("total");
    await vi.waitFor(async () =>
      expect(await fakeBrowser.storage.sync.get("diffstatView")).toEqual({ diffstatView: "total" }),
    );

    controller.abort();
    controller = new AbortController();
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    await run();

    expect(showVisit).toHaveBeenCalledTimes(2);
    expect(vi.mocked(showVisit).mock.calls.at(-1)?.[2].diffstat.choice.view).toBe("total");
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

  it("reads a pull request's code owners once per visit, shared by its pages", async () => {
    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    expect(readCodeOwners).toHaveBeenCalledOnce();
    expect(readCodeOwners).toHaveBeenCalledWith(
      readFilesRoute(PR)?.diff,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    const read = vi.mocked(readCodeOwners).mock.results[0]?.value;
    expect(vi.mocked(showVisit).mock.calls.map(([, , options]) => options.codeOwners)).toEqual([
      read,
      read,
    ]);
  });

  it("gives each page's owner section the visit's code owners and PR reviewers", async () => {
    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    expect(readPrReviewers).toHaveBeenCalledExactlyOnceWith(
      readFilesRoute(PR)?.diff,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    const codeOwners = vi.mocked(readCodeOwners).mock.results[0]?.value;
    const prReviewers = vi.mocked(readPrReviewers).mock.results[0]?.value;
    const given = vi.mocked(showOwnerSection).mock.calls.map(([, , options]) => options);
    expect(given).toHaveLength(2);
    for (const options of given) {
      expect(options.codeOwners).toBe(codeOwners);
      expect(options.prReviewers).toBe(prReviewers);
    }
  });

  it.each([
    ["fails", () => Promise.resolve(new Response("", { status: 404 }))],
    ["never answers", () => new Promise<Response>(() => {})],
  ])("hands each page the code owners while merge_box %s", async (_, mergeBox) => {
    const actual = await vi.importActual<typeof import("../../utils/github/code-owners")>(
      "../../utils/github/code-owners",
    );
    vi.mocked(readCodeOwners).mockImplementation(actual.readCodeOwners);
    vi.mocked(readPrReviewers).mockImplementation(actual.readPrReviewers);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ownershipByPath = { "src/lib.rs": { owners: ["@o/a"], isOwnedByViewer: true } };
    vi.stubGlobal(
      "fetch",
      routedFetch({
        "https://github.com/o/r/pull/1/page_data/codeowners": () =>
          Promise.resolve(new Response(JSON.stringify({ ownershipByPath }))),
        "https://github.com/o/r/pull/1/page_data/merge_box": mergeBox,
      }),
    );

    await run();

    const [, , visit] = vi.mocked(showVisit).mock.calls[0] ?? [];
    const [, , section] = vi.mocked(showOwnerSection).mock.calls[0] ?? [];
    await expect(visit?.codeOwners).resolves.toHaveProperty("size", 1);
    await expect(section?.codeOwners).resolves.toHaveProperty("size", 1);
  });

  it("reads code owners and PR reviewers afresh on the next visit", async () => {
    await run();
    history.pushState(null, "", "/o/r/pull/2/changes");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    const pr2 = readFilesRoute("/o/r/pull/2/changes")?.diff;
    expect(readCodeOwners).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readCodeOwners).mock.calls[1]?.[0]).toEqual(pr2);
    expect(readPrReviewers).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readPrReviewers).mock.calls[1]?.[0]).toEqual(pr2);
  });

  it("narrows each page to the owner its URL names, if any", async () => {
    history.replaceState(null, "", `${PR}?gh-prism-owner=excessive-dev/frontend`);
    await run();
    history.pushState(null, "", "/o/r/pull/2/changes");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();
    history.pushState(null, "", "/o/r/pull/3/changes?gh-prism-owner=octocat");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    expect(vi.mocked(showVisit).mock.calls.map(([, , options]) => options.owner)).toEqual([
      "@excessive-dev/frontend",
      undefined,
      "@octocat",
    ]);
  });

  it("narrows no commit to an owner, whatever its URL names", async () => {
    history.replaceState(null, "", "/o/r/commit/dd95cdc?gh-prism-owner=octocat");
    loadCommitFixture();
    await run();

    expect(showVisit).toHaveBeenCalledOnce();
    expect(vi.mocked(showVisit).mock.calls[0]?.[2].owner).toBeUndefined();
  });

  it("narrows a page whose URL names no owner to no one", async () => {
    await run();

    expect(vi.mocked(showVisit).mock.calls[0]?.[2].owner).toBeUndefined();
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

  describe("on a pull request's header tab", () => {
    beforeEach(() => {
      history.replaceState(null, "", "/o/r/pull/3");
      loadHeaderFixture();
    });

    it("reads the whole pull request's intent", async () => {
      await run();

      expect(intentFor).toHaveBeenCalledWith(
        { diff: { kind: "pr", owner: "o", repo: "r", number: 3 }, commitFiltered: false },
        expect.any(AbortSignal),
        expect.anything(),
        expect.any(Function),
      );
    });

    it("reads no code owners or PR reviewers", async () => {
      await run();

      expect(readCodeOwners).not.toHaveBeenCalled();
      expect(readPrReviewers).not.toHaveBeenCalled();
    });

    it("shares the Files view's diffstat choice", async () => {
      await run();

      history.pushState(null, "", "/o/r/pull/3/changes");
      loadFixture();
      document.dispatchEvent(new Event("soft-nav:end"));
      await afterMutations();

      expect(vi.mocked(showVisit).mock.calls[0]?.[2].diffstat).toBe(
        vi.mocked(showHeaderTab).mock.calls[0]?.[2].diffstat,
      );
    });
  });

  describe("on a classic Files changed page", () => {
    const dialog = () =>
      document.querySelector<HTMLDialogElement>("dialog.gh-prism-classic-notice");
    const opener = () =>
      document.querySelector<HTMLButtonElement>(".gh-prism-classic-notice-button");

    beforeEach(() => {
      history.replaceState(null, "", "/o/r/pull/1/files");
      loadClassicFixture("");
    });

    it("opens the notice", async () => {
      await run();

      expect(dialog()?.open).toBe(true);
    });

    it("keeps a dismissal for the next page", async () => {
      await run();
      dialog()?.close();
      await vi.waitFor(async () =>
        expect(await fakeBrowser.storage.local.get("classicNoticeDismissed")).toEqual({
          classicNoticeDismissed: true,
        }),
      );
      controller.abort();
      controller = new AbortController();

      await run();

      expect(dialog()?.open).toBe(false);
      expect(opener()).not.toBeNull();
    });

    it("opens the notice when reading the saved dismissal fails", async () => {
      const failure = new Error("context invalidated");
      vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValue(failure);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await run();

      expect(dialog()?.open).toBe(true);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
    });

    it("takes the notice away when GitHub navigates to the Conversation tab", async () => {
      await run();

      // The classic markup stays behind, as when popstate fires before GitHub swaps the page.
      history.pushState(null, "", "/o/r/pull/1");
      window.dispatchEvent(new PopStateEvent("popstate"));
      await afterMutations();

      expect(dialog()).toBeNull();
      expect(opener()).toBeNull();
    });
  });

  describe("with release notes", () => {
    const VERSION = "1.2.3";
    const block = () => document.querySelector(".gh-prism-whats-new");
    const seen = async () => (await fakeBrowser.storage.local.get("whatsNewSeen")).whatsNewSeen;

    beforeEach(async () => {
      vi.stubEnv("WXT_RELEASE_NOTES", "- Faster sections");
      vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({
        manifest_version: 3,
        name: "gh-prism",
        version: VERSION,
      });
      const actual = await vi.importActual<typeof import("../../entrypoints/content/visit/land")>(
        "../../entrypoints/content/visit/land",
      );
      vi.mocked(showVisit).mockImplementation(actual.showVisit);
    });

    it.each([
      { page: "a pull request", path: PR, load: loadFixture },
      { page: "a commit", path: "/o/r/commit/dd95cdc", load: loadCommitFixture },
    ])("shows the block atop the sidebar on $page and stamps it", async ({ path, load }) => {
      history.replaceState(null, "", path);
      load();
      const at = Date.now();

      await run();

      expect(block()).toBeInstanceOf(HTMLElement);
      expect(block()?.parentElement?.firstElementChild).toBe(block());
      expect(block()?.closest(".gh-prism-sections")).not.toBeNull();
      await vi.waitFor(async () =>
        expect(await seen()).toEqual({ shown: { version: VERSION, at } }),
      );
    });

    it("shows nothing once the version is dismissed", async () => {
      await fakeBrowser.storage.local.set({ whatsNewSeen: { dismissed: VERSION } });

      await run();

      expect(block()).toBeNull();
    });

    it("stores a dismissal", async () => {
      await run();

      block()?.querySelector<HTMLButtonElement>('[aria-label="Dismiss what\'s new"]')?.click();

      await vi.waitFor(async () => expect(await seen()).toMatchObject({ dismissed: VERSION }));
    });

    it("drops the block on the next page once another tab dismisses it", async () => {
      await run();
      expect(block()).not.toBeNull();

      await fakeBrowser.storage.local.set({ whatsNewSeen: { dismissed: VERSION } });
      const sidebar = byId("pr-file-tree");
      sidebar.replaceWith(sidebar.cloneNode(true));
      await afterMutations();

      expect(block()).toBeNull();
    });

    it("shows nothing 3 days after it was first shown", async () => {
      vi.setSystemTime(10 * 24 * 60 * 60 * 1000);
      await fakeBrowser.storage.local.set({
        whatsNewSeen: { shown: { version: VERSION, at: Date.now() - 3 * 24 * 60 * 60 * 1000 } },
      });

      await run();

      expect(block()).toBeNull();
    });

    it.each([
      { hidden: "dismissed", saved: () => ({ dismissed: VERSION }) },
      {
        hidden: "expired",
        saved: () => ({ shown: { version: VERSION, at: Date.now() - 3 * 24 * 60 * 60 * 1000 } }),
      },
    ])("leaves other tabs' storage writes unwatched once $hidden", async ({ saved }) => {
      vi.setSystemTime(10 * 24 * 60 * 60 * 1000);
      await fakeBrowser.storage.local.set({ whatsNewSeen: saved() });
      const watch = vi.spyOn(whatsNewSeen, "watch");

      await run();

      expect(watch).not.toHaveBeenCalled();
    });

    it("shows nothing and stores nothing when the build has no notes", async () => {
      vi.stubEnv("WXT_RELEASE_NOTES", undefined);

      await run();
      await afterMutations();

      expect(block()).toBeNull();
      expect(await seen()).toBeUndefined();
    });
  });
});
