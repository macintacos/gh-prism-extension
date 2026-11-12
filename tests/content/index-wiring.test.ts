// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import contentScript from "../../entrypoints/content";
import { showCommitMessage } from "../../entrypoints/content/commit/message-view";
import { showStepLinks } from "../../entrypoints/content/commit/step-links";
import {
  type ConversationChoice,
  type ConversationPanel,
  conversationPanel,
} from "../../entrypoints/content/conversation/panel";
import { showReviewerFiles } from "../../entrypoints/content/conversation/reviewer-files";
import {
  findFilesCommentAuthors,
  findFilesPage,
  findFilesToolbar,
  findLayoutGear,
} from "../../entrypoints/content/files-page";
import { showOwnerSection } from "../../entrypoints/content/sidebar/owner-section";
import { dockSidebar, type Side } from "../../entrypoints/content/sidebar/side";
import { showHeaderTab, showVisit } from "../../entrypoints/content/visit/land";
import {
  readCodeOwners,
  readOwnership,
  readReviewersWithTeams,
} from "../../utils/github/code-owners";
import { readFilesRoute } from "../../utils/github/files-route";
import { readNextCommit } from "../../utils/github/next-commit";
import { connectPrData, type PrDataClient } from "../../utils/github/pr-port";
import { intentFor } from "../../utils/intent/read";
import { type CommitMessageView, type DiffstatView, whatsNewSeen } from "../../utils/prefs";
import commitToolbar from "../fixtures/commit-page-toolbar.html?raw";
import { routedFetch } from "../fixtures/fetch";
import {
  byId,
  loadClassicCommentsFixture,
  loadClassicFixture,
  loadCommentsFixture,
  loadCommitFixture,
  loadFixture,
  loadHeaderFixture,
  loadViewedFixture,
  VIEWED_APP_TOML,
} from "../fixtures/files-page";
import prRename from "../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../fixtures/files-page-diff-split.html?raw";
import prToolbar from "../fixtures/files-page-toolbar.html?raw";
import { installLayoutMenu } from "../fixtures/layout-menu";
import prLayoutMenu from "../fixtures/layout-menu-pr.html?raw";
import { setViewport } from "../fixtures/viewport";

// Only leaves are faked: intentFor needs a port fakeBrowser lacks; the views' DOM has own tests.
vi.mock(import("../../utils/intent/read"), async (importOriginal) => ({
  ...(await importOriginal()),
  intentFor: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../utils/github/code-owners"), async (importOriginal) => ({
  ...(await importOriginal()),
  readCodeOwners: vi.fn(() => new Promise<never>(() => {})),
  readReviewersWithTeams: vi.fn(() => new Promise<never>(() => {})),
  readOwnership: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../entrypoints/content/conversation/reviewer-files"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, showReviewerFiles: vi.fn(actual.showReviewerFiles) };
});
vi.mock(import("../../entrypoints/content/visit/land"), async (importOriginal) => ({
  ...(await importOriginal()),
  showVisit: vi.fn((_page, _signal, { intent }) => {
    void intent(() => {});
    return { startStructural: () => {} };
  }),
  showHeaderTab: vi.fn((_page, _signal, { intent }) => void intent(() => {})),
}));
vi.mock(import("../../entrypoints/content/commit/message-view"), async (importOriginal) => ({
  ...(await importOriginal()),
  showCommitMessage: vi.fn(),
}));
vi.mock(import("../../utils/github/next-commit"), async (importOriginal) => ({
  ...(await importOriginal()),
  readNextCommit: vi.fn(() => new Promise<never>(() => {})),
}));
vi.mock(import("../../entrypoints/content/commit/step-links"), async (importOriginal) => ({
  ...(await importOriginal()),
  showStepLinks: vi.fn(),
}));
vi.mock(import("../../entrypoints/content/sidebar/owner-section"), async (importOriginal) => ({
  ...(await importOriginal()),
  showOwnerSection: vi.fn(),
}));
vi.mock(import("../../entrypoints/content/sidebar/side"), async (importOriginal) => ({
  ...(await importOriginal()),
  dockSidebar: vi.fn(),
}));

vi.mock(import("../../entrypoints/content/conversation/panel"), async (importOriginal) => ({
  ...(await importOriginal()),
  conversationPanel: vi.fn(),
}));
vi.mock(import("../../utils/github/pr-port"), async (importOriginal) => ({
  ...(await importOriginal()),
  connectPrData: vi.fn(),
}));

/** A port client whose reads never settle. */
const fakeClient = (): PrDataClient => ({
  files: () => new Promise(() => {}),
  fileContent: () => new Promise(() => {}),
  filePrefix: () => new Promise(() => {}),
  structural: () => new Promise(() => {}),
  close: vi.fn(),
});

const PR = "/o/r/pull/1/changes";
let controller: AbortController;
const run = () => {
  const { signal } = controller;
  const onInvalidated = (cb: () => void) => signal.addEventListener("abort", cb);
  return contentScript.main({ signal, onInvalidated } as ContentScriptContext);
};
const docked = () => vi.mocked(dockSidebar).mock.calls.map(([, , options]) => options);
// At call time: a saved view read after the first page mounts would fix up the shared choice.
const recordFirstCommitView = () => {
  const views: CommitMessageView[] = [];
  vi.mocked(showCommitMessage).mockImplementationOnce((_page, _signal, { choice }) => {
    views.push(choice.view);
  });
  return views;
};
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

  it("opens on the right, the breakout, and the rendered message and mounts when reading saved choices fails", async () => {
    const failure = new Error("context invalidated");
    vi.spyOn(fakeBrowser.storage.sync, "get").mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const sides: Side[] = [];
    vi.mocked(dockSidebar).mockImplementationOnce((_page, _signal, { choice }) => {
      sides.push(choice.side);
    });
    const views = recordFirstCommitView();

    await run();

    expect(sides).toEqual(["right"]);
    expect(views).toEqual(["rendered"]);
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
        return { startStructural: () => {} };
      });

      await run();

      expect(views).toEqual([opens]);
    },
  );

  it.each<{ saved?: unknown; opens: CommitMessageView }>([
    { saved: "plaintext", opens: "plaintext" },
    { saved: "raw", opens: "rendered" },
    { opens: "rendered" },
  ])("opens a commit's message on the $opens view (saved: $saved)", async ({ saved, opens }) => {
    // Raw key on purpose, so the test outlives a move to typed storage items.
    if (saved !== undefined) await fakeBrowser.storage.sync.set({ commitMessageView: saved });
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    const views = recordFirstCommitView();

    await run();

    expect(views).toEqual([opens]);
  });

  it.each<{ saved?: unknown; hidden: boolean }>([
    { saved: true, hidden: true },
    { saved: "yes", hidden: false },
    { hidden: false },
  ])("opens a commit's message hidden: $hidden (saved: $saved)", async ({ saved, hidden }) => {
    // Raw key on purpose, so the test outlives a move to typed storage items.
    if (saved !== undefined) await fakeBrowser.storage.sync.set({ commitMessageHidden: saved });
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();

    await run();

    expect(vi.mocked(showCommitMessage).mock.calls[0]?.[2].visit.hidden).toBe(hidden);
  });

  it.each<{ pinned?: unknown; left?: unknown; viewport: number; open: boolean }>([
    { pinned: true, left: true, viewport: 1400, open: true },
    { pinned: true, left: false, viewport: 1400, open: false },
    { pinned: true, viewport: 1400, open: false },
    { pinned: true, left: true, viewport: 1024, open: false },
    { pinned: "yes", left: true, viewport: 1400, open: false },
    { left: true, viewport: 1400, open: false },
  ])(
    "on a full load, opens the Conversation panel only when left open and pinned and the window fits it (pinned: $pinned, open: $left, $viewport px)",
    async ({ pinned, left, viewport, open }) => {
      // Raw keys on purpose, so the test outlives a move to typed storage items.
      if (pinned !== undefined) await fakeBrowser.storage.sync.set({ conversationPinned: pinned });
      if (left !== undefined) await fakeBrowser.storage.sync.set({ conversationOpen: left });
      await fakeBrowser.storage.local.set({ conversationWidth: 520 });
      setViewport({ width: viewport, height: 768 });
      onTestFinished(() => setViewport({ width: 1024, height: 768 }));
      const choices: ConversationChoice[] = [];
      vi.mocked(conversationPanel).mockImplementationOnce((_doc, { choice }) => {
        choices.push({ ...choice });
        return undefined as unknown as ConversationPanel;
      });

      await run();

      expect(choices).toEqual([{ open, pinned: pinned === true, width: 520 }]);
    },
  );

  it("saves the Conversation panel's pin and width", async () => {
    await run();
    const [[, options] = []] = vi.mocked(conversationPanel).mock.calls;
    options?.savePinned(true);
    options?.saveWidth(600);

    await vi.waitFor(async () => {
      expect(await fakeBrowser.storage.sync.get("conversationPinned")).toEqual({
        conversationPinned: true,
      });
      expect(await fakeBrowser.storage.local.get("conversationWidth")).toEqual({
        conversationWidth: 600,
      });
    });
  });

  it("carries a commit's message view to the next commit in the tab", async () => {
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    await run();

    history.pushState(null, "", "/o/r/commit/4f0a580");
    loadCommitFixture("mention");
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();

    const calls = vi.mocked(showCommitMessage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[2].choice).toBe(calls[0]?.[2].choice);
  });

  it("saves the commit message view the user picks", async () => {
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();

    await run();
    vi.mocked(showCommitMessage).mock.calls[0]?.[2].save("plaintext");

    await vi.waitFor(async () =>
      expect(await fakeBrowser.storage.sync.get("commitMessageView")).toEqual({
        commitMessageView: "plaintext",
      }),
    );
  });

  it("logs a failed commit message view save instead of throwing it", async () => {
    const failure = new Error("quota");
    vi.spyOn(fakeBrowser.storage.sync, "set").mockRejectedValue(failure);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();

    await run();
    vi.mocked(showCommitMessage).mock.calls[0]?.[2].save("plaintext");

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure));
  });

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

  describe("Structural mode", () => {
    const structuralOf = (call: number) => vi.mocked(showVisit).mock.calls.at(call)?.[2].structural;
    const rerender = async () => {
      const sidebar = byId("pr-file-tree");
      sidebar.replaceWith(sidebar.cloneNode(true));
      await afterMutations();
    };

    beforeEach(() => {
      vi.mocked(connectPrData).mockImplementation(fakeClient);
    });

    it.each<{ saved?: unknown; on: boolean }>([
      { on: false },
      { saved: false, on: false },
      { saved: "true", on: false },
      { saved: 1, on: false },
      { saved: true, on: true },
    ])("shows Structural mode: $on (saved: $saved)", async ({ saved, on }) => {
      // Raw key on purpose, so the test outlives a move to typed storage items.
      if (saved !== undefined) await fakeBrowser.storage.sync.set({ structuralMode: saved });

      await run();

      expect(structuralOf(0) !== undefined).toBe(on);
      expect(connectPrData).not.toHaveBeenCalled();
    });

    it("opens off when reading the saved choice fails", async () => {
      await fakeBrowser.storage.sync.set({ structuralMode: true });
      vi.spyOn(fakeBrowser.storage.sync, "get").mockRejectedValue(new Error("invalidated"));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await run();

      expect(structuralOf(0)).toBeUndefined();
    });

    it("asks a visit's own port for on-screen files, closed on the next visit", async () => {
      await fakeBrowser.storage.sync.set({ structuralMode: true });
      await run();
      const first = structuralOf(0);

      first?.files.request(["a.ts"]);
      const firstAsked = vi.mocked(connectPrData).mock.calls.slice();
      history.pushState(null, "", "/o/r/pull/2/changes");
      document.dispatchEvent(new Event("soft-nav:end"));
      await afterMutations();
      const next = structuralOf(-1);
      next?.files.request(["a.ts"]);

      expect(firstAsked).toEqual([[readFilesRoute(PR)?.diff]]);
      const client = vi.mocked(connectPrData).mock.results[0]?.value as PrDataClient;
      expect(client.close).toHaveBeenCalledOnce();
      expect(next?.files).not.toBe(first?.files);
      expect(connectPrData).toHaveBeenCalledTimes(2);
    });

    it("turns off and saves off once Unified is seen", async () => {
      await fakeBrowser.storage.sync.set({ structuralMode: true });
      await run();
      const mode = structuralOf(0);

      mode?.unifiedSeen();
      await rerender();

      expect(mode?.until.aborted).toBe(true);
      expect(structuralOf(-1)).toBeUndefined();
      await vi.waitFor(async () =>
        expect(await fakeBrowser.storage.sync.get("structuralMode")).toEqual({
          structuralMode: false,
        }),
      );
    });

    it("gives a commit-filtered pull request page no Structural mode", async () => {
      await fakeBrowser.storage.sync.set({ structuralMode: true });
      history.replaceState(null, "", `${PR}/dd95cdc`);

      await run();

      expect(structuralOf(0)).toBeUndefined();
    });

    describe("diff view control", () => {
      const segment = (name: string) =>
        document.querySelector<HTMLButtonElement>(`.gh-prism-diff-view [data-view="${name}"]`);
      const startStructural = vi.fn();

      /** Gives the loaded page `toolbar`, a table drawn as `table`, and GitHub's menu. */
      function withToolbar(toolbar: string, table: string, tables: typeof prTables) {
        const page = findFilesPage(document);
        const row = page && findFilesToolbar(page);
        if (!page || !row) throw new Error("fixture has no toolbar");
        row.outerHTML = toolbar;
        findLayoutGear(page)?.setAttribute("aria-expanded", "false");
        const region = document.createElement("div");
        region.innerHTML = table;
        page.diffs.append(region);
        installLayoutMenu({ menu: prLayoutMenu, tables, signal: controller.signal });
      }
      const prTables = { unified: prRename, split: prSplit };

      beforeEach(() => {
        vi.mocked(showVisit).mockImplementation((_page, _signal, { intent }) => {
          void intent(() => {});
          return { startStructural };
        });
      });

      it.each([
        { name: "a pull request", url: PR, load: loadFixture, toolbar: prToolbar },
        {
          name: "a commit",
          url: "/o/r/commit/dd95cdc",
          load: loadCommitFixture,
          toolbar: commitToolbar,
        },
      ])("mounts on $name's page with a gear", async ({ url, load, toolbar }) => {
        history.replaceState(null, "", url);
        load();
        withToolbar(toolbar, prSplit, prTables);

        await run();

        expect(document.querySelector(".gh-prism-diff-view")).not.toBeNull();
      });

      it("turns the mode on from Structural, saving it and starting the page's mode", async () => {
        withToolbar(prToolbar, prSplit, prTables);
        await run();

        segment("structural")?.click();
        await vi.advanceTimersByTimeAsync(100);

        expect(startStructural).toHaveBeenCalledWith(
          expect.objectContaining({ until: expect.any(AbortSignal) }),
        );
        await vi.waitFor(async () =>
          expect(await fakeBrowser.storage.sync.get("structuralMode")).toEqual({
            structuralMode: true,
          }),
        );
      });

      it("turns the mode off from Unified, saving it and ending the page's mode", async () => {
        await fakeBrowser.storage.sync.set({ structuralMode: true });
        withToolbar(prToolbar, prSplit, prTables);
        await run();
        const mode = structuralOf(0);

        segment("unified")?.click();
        await vi.advanceTimersByTimeAsync(100);

        expect(mode?.until.aborted).toBe(true);
        await vi.waitFor(async () =>
          expect(await fakeBrowser.storage.sync.get("structuralMode")).toEqual({
            structuralMode: false,
          }),
        );
      });

      it("writes nothing to storage for Unified and Split with the mode off", async () => {
        withToolbar(prToolbar, prSplit, prTables);
        await run();
        const write = vi.spyOn(fakeBrowser.storage.sync, "set");

        segment("unified")?.click();
        await vi.advanceTimersByTimeAsync(100);
        segment("split")?.click();
        await vi.advanceTimersByTimeAsync(100);

        expect(segment("split")?.getAttribute("aria-pressed")).toBe("true");
        expect(write).not.toHaveBeenCalled();
      });

      it("disables Structural on a commit-filtered pull request page", async () => {
        history.replaceState(null, "", `${PR}/dd95cdc`);
        withToolbar(prToolbar, prSplit, prTables);

        await run();

        expect(segment("structural")?.getAttribute("aria-disabled")).toBe("true");
      });
    });

    it("gives no page of an off visit Structural mode", async () => {
      await run();
      await rerender();

      expect(showVisit).toHaveBeenCalledTimes(2);
      expect(structuralOf(-1)).toBeUndefined();
    });
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

  it("shields review comment authors from the visit's own code owners and PR reviewers reads", async () => {
    const codeOwners = new Map();
    const prReviewers: Awaited<ReturnType<typeof readReviewersWithTeams>> = [];
    vi.mocked(readCodeOwners).mockResolvedValue(codeOwners);
    vi.mocked(readReviewersWithTeams).mockResolvedValue(prReviewers);
    loadCommentsFixture();

    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    expect(showReviewerFiles).toHaveBeenCalledOnce();
    const [doc, signal, options] = vi.mocked(showReviewerFiles).mock.calls[0] ?? [];
    expect(doc).toBe(document);
    expect(signal?.aborted).toBe(false);
    expect(options?.findAuthors).toBe(findFilesCommentAuthors);
    expect(options?.filter).toBe(vi.mocked(showVisit).mock.calls[0]?.[2].filter);
    expect(await options?.read()).toEqual({ codeOwners, prReviewers });
    expect(readCodeOwners).toHaveBeenCalledOnce();
    expect(readOwnership).not.toHaveBeenCalled();
  });

  it("gives each page's owner section the visit's code owners and PR reviewers", async () => {
    await run();
    const sidebar = byId("pr-file-tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();

    const codeOwners = vi.mocked(readCodeOwners).mock.results[0]?.value;
    expect(readReviewersWithTeams).toHaveBeenCalledExactlyOnceWith(
      readFilesRoute(PR)?.diff,
      codeOwners,
      expect.objectContaining({ fetchFn: expect.any(Function), signal: expect.any(AbortSignal) }),
    );
    const given = vi.mocked(showOwnerSection).mock.calls.map(([, , options]) => options);
    expect(given).toHaveLength(2);
    for (const options of given) {
      expect(options.codeOwners).toBe(codeOwners);
      expect(options.prReviewers).toBe(given[0]?.prReviewers);
    }
  });

  /**
   * Runs the content script with the real code owners and PR reviewers reads, answered by
   * `routes`, and returns the options the first page's visit and owner section got.
   */
  const runWithReads = async (routes: Parameters<typeof routedFetch>[0]) => {
    const actual = await vi.importActual<typeof import("../../utils/github/code-owners")>(
      "../../utils/github/code-owners",
    );
    vi.mocked(readCodeOwners).mockImplementation(actual.readCodeOwners);
    vi.mocked(readReviewersWithTeams).mockImplementation(actual.readReviewersWithTeams);
    vi.stubGlobal("fetch", routedFetch(routes));

    await run();

    const [, , visit] = vi.mocked(showVisit).mock.calls[0] ?? [];
    const [, , section] = vi.mocked(showOwnerSection).mock.calls[0] ?? [];
    return { visit, section };
  };
  const answers = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body)));

  it("hands each page the PR reviewers with the owning teams a code owner among them is in", async () => {
    const ownershipByPath = { "src/lib.rs": { owners: ["@o/core"], isOwnedByViewer: false } };
    const pendingReviewRequests = [
      { reviewer: { displayLogin: "grace", reviewerType: "User" }, isCodeOwner: true },
    ];

    const { visit, section } = await runWithReads({
      "https://github.com/o/r/pull/1/page_data/codeowners": answers({ ownershipByPath }),
      "https://github.com/o/r/pull/1/page_data/review_requests": answers({ pendingReviewRequests }),
      "https://github.com/orgs/o/teams/core/members": answers({ total: 1, members: ["grace"] }),
    });

    const withTeams = [{ token: "@grace", teams: ["@o/core"], codeOwner: true }];
    await expect(visit?.prReviewers).resolves.toEqual(withTeams);
    await expect(section?.prReviewers).resolves.toEqual(withTeams);
  });

  it.each([
    ["fails", () => Promise.resolve(new Response("", { status: 404 }))],
    ["never answers", () => new Promise<Response>(() => {})],
  ])("hands each page the code owners while review_requests %s", async (_, reviewRequests) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ownershipByPath = { "src/lib.rs": { owners: ["@o/a"], isOwnedByViewer: true } };

    const { visit, section } = await runWithReads({
      "https://github.com/o/r/pull/1/page_data/codeowners": answers({ ownershipByPath }),
      "https://github.com/o/r/pull/1/page_data/review_requests": reviewRequests,
    });

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
    expect(readReviewersWithTeams).toHaveBeenCalledTimes(2);
    expect(vi.mocked(readReviewersWithTeams).mock.calls[1]?.[0]).toEqual(pr2);
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
      expect(readOwnership).not.toHaveBeenCalled();
    });

    describe("with a Reviewers list", () => {
      /** Mounts a Reviewers list with one reviewer's row, then GitHub's replacement of it. */
      const showReviewers = async () => {
        for (let mount = 0; mount < 2; mount++) {
          document.getElementById("partial-discussion-sidebar")?.remove();
          document.body.insertAdjacentHTML(
            "beforeend",
            '<div id="partial-discussion-sidebar"><form id="pull-request-reviewers-form-1"><span class="css-truncate"><div><a href="/orgs/o/teams/team"></a></div></span></form></div>',
          );
          await afterMutations();
        }
      };

      it("reads the pull request's code owners and PR reviewers once per visit, as it shows", async () => {
        await run();

        await showReviewers();

        const pr = { kind: "pr", owner: "o", repo: "r", number: 3 };
        expect(readOwnership).toHaveBeenCalledExactlyOnceWith(pr, {
          fetchFn: fetch,
          teamMembers: expect.any(Function),
          signal: expect.any(AbortSignal),
        });
        expect(vi.mocked(readOwnership).mock.calls[0]?.[1].signal.aborted).toBe(false);
      });

      it("reads again on a fresh visit", async () => {
        await run();
        await showReviewers();

        history.pushState(null, "", "/o/r/pull/3/changes");
        loadFixture();
        document.dispatchEvent(new Event("soft-nav:end"));
        await afterMutations();
        history.pushState(null, "", "/o/r/pull/3");
        loadHeaderFixture();
        document.dispatchEvent(new Event("soft-nav:end"));
        await afterMutations();
        vi.mocked(readOwnership).mockClear();
        await showReviewers();

        expect(readOwnership).toHaveBeenCalledOnce();
      });
    });

    it("shares the Files view's diffstat choice", async () => {
      await run();

      history.pushState(null, "", "/o/r/pull/3/changes");
      loadFixture();
      document.dispatchEvent(new Event("soft-nav:end"));
      await afterMutations();

      expect(vi.mocked(showVisit).mock.calls[0]?.[2].diffstat.choice).toBe(
        vi.mocked(showHeaderTab).mock.calls[0]?.[2].diffstat.choice,
      );
    });

    it("names the pull request on both visits' diffstat, and none on a commit filter", async () => {
      await run();

      for (const path of ["/o/r/pull/3/changes", "/o/r/pull/3/changes/dd95cdc"]) {
        history.pushState(null, "", path);
        loadFixture();
        document.dispatchEvent(new Event("soft-nav:end"));
        await afterMutations();
      }

      expect(vi.mocked(showHeaderTab).mock.calls[0]?.[2].diffstat.pr).toBe("o/r#3");
      expect(vi.mocked(showVisit).mock.calls.map(([, , { diffstat }]) => diffstat.pr)).toEqual([
        "o/r#3",
        undefined,
      ]);
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

    it("shields review comment authors, with no owner filter, reading the pull request's code owners and PR reviewers once per visit once a review comment shows", async () => {
      loadClassicCommentsFixture("");

      await run();
      const toolbar = document.querySelector("#files_bucket .pr-toolbar");
      toolbar?.replaceWith(toolbar.cloneNode(true));
      await afterMutations();

      expect(showReviewerFiles).toHaveBeenCalledOnce();
      const [, , options] = vi.mocked(showReviewerFiles).mock.calls[0] ?? [];
      expect(options?.findAuthors).toBe(findFilesCommentAuthors);
      expect(options?.filter).toBeUndefined();
      await afterMutations();
      expect(readOwnership).toHaveBeenCalledExactlyOnceWith(
        readFilesRoute("/o/r/pull/1/files")?.diff,
        expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
      );
    });

    it("reads no code owners while no review comment shows", async () => {
      await run();
      await afterMutations();

      expect(readOwnership).not.toHaveBeenCalled();
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

  it("shows each commit page's message once the intent lands and the browser is idle", async () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    let land: (value: never) => void = () => {};
    vi.mocked(intentFor).mockImplementationOnce(
      () => new Promise<never>((resolve) => (land = resolve)),
    );
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    await run();

    const calls = vi.mocked(showCommitMessage).mock.calls;
    expect(calls).toHaveLength(1);
    const [page, signal, options] = calls[0] ?? [];
    expect(page).toBe(vi.mocked(showVisit).mock.calls[0]?.[0]);
    expect(signal).toBe(vi.mocked(showVisit).mock.calls[0]?.[1]);
    const task = () => {};
    options?.afterSections(task);
    await afterMutations();
    expect(requestIdleCallback).not.toHaveBeenCalled();

    land(undefined as never);
    await afterMutations();

    expect(requestIdleCallback).toHaveBeenCalledWith(task, { timeout: 1000 });
  });

  it("reads what follows a commit once per visit, after the intent lands and the browser is idle", async () => {
    vi.stubGlobal("requestIdleCallback", (task: () => void) => task());
    let land: (value: never) => void = () => {};
    vi.mocked(intentFor).mockImplementationOnce(
      () => new Promise<never>((resolve) => (land = resolve)),
    );
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    await run();
    const sidebar = byId("diff_file_tree");
    sidebar.replaceWith(sidebar.cloneNode(true));
    await afterMutations();
    expect(readNextCommit).not.toHaveBeenCalled();

    land(undefined as never);
    await afterMutations();

    expect(readNextCommit).toHaveBeenCalledOnce();
    expect(readNextCommit).toHaveBeenCalledWith(
      readFilesRoute("/o/r/commit/dd95cdc")?.diff,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    const shown = vi.mocked(showStepLinks).mock.calls.map(([, , options]) => options);
    expect(shown).toHaveLength(2);
    expect(shown[1]?.next).toBe(shown[0]?.next);
  });

  it("goes Next from a commit to the child the reader last saw it under, with no read", async () => {
    vi.stubGlobal("requestIdleCallback", (task: () => void) => task());
    const parent = "dd95cdc6a9817998ee6663563e888761f329abcd";
    history.replaceState(null, "", "/o/r/commit/4f0a580");
    loadCommitFixture();
    await run();
    vi.mocked(showStepLinks).mock.calls[0]?.[2].sawParent(parent);

    history.pushState(null, "", `/o/r/commit/${parent}`);
    loadCommitFixture();
    document.dispatchEvent(new Event("soft-nav:end"));
    await afterMutations();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await vi.mocked(showStepLinks).mock.calls[1]?.[2].next).toEqual({
      kind: "commit",
      sha: "4f0a580",
    });
    expect(vi.mocked(readNextCommit).mock.calls.map(([commit]) => commit.headSha)).toEqual([
      "4f0a580",
    ]);
  });

  it("shows a commit page's message after a second when the intent never lands", async () => {
    const requestIdleCallback = vi.fn();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    history.replaceState(null, "", "/o/r/commit/dd95cdc");
    loadCommitFixture();
    await run();

    const task = () => {};
    vi.mocked(showCommitMessage).mock.calls[0]?.[2].afterSections(task);
    await vi.advanceTimersByTimeAsync(999);
    expect(requestIdleCallback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(requestIdleCallback.mock.calls.filter(([scheduled]) => scheduled === task)).toEqual([
      [task, { timeout: 1000 }],
    ]);
  });
});
