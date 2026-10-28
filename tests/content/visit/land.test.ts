// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anchorOf,
  type FilesPage,
  findFilesPage,
  findHeaderPage,
  readChangedFiles,
} from "../../../entrypoints/content/files-page";
import {
  type FileSection,
  type LandingView,
  land,
  showHeaderTab,
} from "../../../entrypoints/content/visit/land";
import { landingOf, sectionsOf } from "../../../utils/intent/landing";
import {
  type IntentProgress,
  type IntentResult,
  type PendingIntent,
  shareIntent,
} from "../../../utils/intent/read";
import {
  byId,
  closeOverlay,
  loadFixture,
  loadHeaderFixture,
  openOverlay,
} from "../../fixtures/files-page";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  progressBar,
  view,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null. Hoisted above
// the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

let controller: AbortController;
let page: FilesPage;
let log: string[];
const received: (readonly FileSection[])[] = [];
const hiddens: ReadonlySet<string>[] = [];

const result: IntentResult = {
  ok: true,
  placements: new Map([["src/lib.rs", { kind: "whole", section: "docs" }]]),
  lines: new Map(),
  commentLines: new Map(),
};

function recording(name: string): LandingView {
  return {
    pending: () => log.push(`${name}.pending`),
    progress: () => log.push(`${name}.progress`),
    landed: () => log.push(`${name}.landed`),
    shownIn: (tree) => log.push(`${name}.shownIn:${tree === page ? "page" : "overlay"}`),
    sections: (sections, hidden) => {
      log.push(`${name}.sections`);
      received.push(sections);
      hiddens.push(hidden);
    },
  };
}

/** A pending intent that reports its first progress as soon as it is read, before any view asks. */
function replayingIntent() {
  const deferred = Promise.withResolvers<IntentResult>();

  let report: (progress: IntentProgress) => void = () => {};
  const intent: PendingIntent = (onProgress) => {
    report = onProgress;
    onProgress({ checked: 0, total: 2 });
    return deferred.promise;
  };

  return { intent, resolve: deferred.resolve, progress: (p: IntentProgress) => report(p) };
}

const mount = (
  intent: PendingIntent,
  ignore?: Node,
  keep?: Promise<((path: string) => boolean) | undefined>,
) =>
  land(page, intent, [recording("a"), recording("b")], {
    signal: controller.signal,
    ignore,
    keep,
  });

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  controller = new AbortController();

  const found = findFilesPage(document);
  if (!found) throw new Error("fixture lacks the Files changed markup");
  page = found;

  log = [];
  received.length = 0;
  hiddens.length = 0;
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

describe("land", () => {
  it("shows every view pending, then the replayed progress, then each new progress", () => {
    const { intent, progress } = replayingIntent();
    mount(intent);
    expect(log).toEqual(["a.pending", "b.pending", "a.progress", "b.progress"]);

    progress({ checked: 1, total: 2 });
    expect(log.slice(4)).toEqual(["a.progress", "b.progress"]);
  });

  it("lands every view before any view gets the one shared section model", async () => {
    const { intent, resolve } = replayingIntent();
    mount(intent);
    log.length = 0;

    resolve(result);
    await vi.runAllTimersAsync();

    expect(log).toEqual(["a.landed", "b.landed", "a.sections", "b.sections"]);
    expect(received[1]).toBe(received[0]);
    expect(received[0]?.map(({ key }) => key)).toEqual(
      sectionsOf(landingOf(result), readChangedFiles(page.sidebar)).map(({ key }) => key),
    );
  });

  it("lands an intent that has already landed without showing it pending", () => {
    mount(() => result);
    expect(log).toEqual(["a.landed", "b.landed", "a.sections", "b.sections"]);
    expect(hiddens[0]?.size).toBe(0);
  });

  it("re-lists every view on a change to the native tree, but not on one inside `ignore`", async () => {
    const ignored = page.sidebar.appendChild(document.createElement("div"));
    mount(() => result, ignored);
    log.length = 0;

    ignored.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toEqual([]);

    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toEqual(["a.sections", "b.sections"]);
  });

  it("does not re-list a change to the native tree before landing", async () => {
    mount(replayingIntent().intent);
    log.length = 0;

    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);

    expect(log).toEqual([]);
  });

  describe("with a filter to keep", () => {
    const listed = () =>
      received.at(-1)?.flatMap(({ entries }) => entries.map(({ file }) => file.path));
    const anchorsBut = (path: string) =>
      new Set(
        readChangedFiles(page.sidebar)
          .filter((file) => file.path !== path)
          .map((file) => anchorOf(file.link)),
      );

    it("keeps an intent that has already landed pending until the filter settles", () => {
      mount(() => result, undefined, new Promise(() => {}));
      expect(log).toEqual(["a.pending", "b.pending"]);
    });

    it("lands, then lists only the kept files, with the others' anchors hidden", async () => {
      const keep = Promise.withResolvers<(path: string) => boolean>();
      mount(() => result, undefined, keep.promise);
      log.length = 0;

      keep.resolve((path) => path === "src/lib.rs");
      await vi.runAllTimersAsync();

      expect(log).toEqual(["a.landed", "b.landed", "a.sections", "b.sections"]);
      expect(listed()).toEqual(["src/lib.rs"]);
      expect(hiddens[0]).toEqual(anchorsBut("src/lib.rs"));
      expect(hiddens[0]?.size).toBeGreaterThan(0);
    });

    it("lands a pending intent only once both it and the filter have settled", async () => {
      const { intent, resolve } = replayingIntent();
      mount(
        intent,
        undefined,
        Promise.resolve(() => true),
      );
      await vi.runAllTimersAsync();
      expect(log).not.toContain("a.landed");

      resolve(result);
      await vi.runAllTimersAsync();
      expect(log.slice(-4)).toEqual(["a.landed", "b.landed", "a.sections", "b.sections"]);
    });

    it("lists every file when the filter settles undefined", async () => {
      mount(() => result, undefined, Promise.resolve(undefined));
      await vi.runAllTimersAsync();

      expect(listed()?.toSorted()).toEqual(
        readChangedFiles(page.sidebar)
          .map(({ path }) => path)
          .toSorted(),
      );
      expect(hiddens[0]?.size).toBe(0);
    });

    it("re-lists a change to the tree through the same filter", async () => {
      mount(
        () => result,
        undefined,
        Promise.resolve((path: string) => path === "src/lib.rs"),
      );
      await vi.runAllTimersAsync();

      addNativeFile("src/added.rs", "src/lib.rs");
      await afterDebounce();

      expect(listed()).toEqual(["src/lib.rs"]);
      expect(hiddens.at(-1)).toEqual(anchorsBut("src/lib.rs"));
    });

    it("lands nothing once aborted before the filter settles", async () => {
      const keep = Promise.withResolvers<undefined>();
      mount(() => result, undefined, keep.promise);
      log.length = 0;

      controller.abort();
      keep.resolve(undefined);
      await vi.runAllTimersAsync();

      expect(log).toEqual([]);
    });
  });

  describe("with the narrow layout's overlay open", () => {
    const listed = () =>
      received.at(-1)?.flatMap(({ entries }) => entries.map(({ file }) => file.path));
    const dockedRow = (path: string) => page.tree.querySelector(`[id="${CSS.escape(path)}"]`);

    it("lists the overlay's rows, then the docked rows once it closes", async () => {
      mount(() => result);
      const overlay = openOverlay();
      await vi.advanceTimersByTimeAsync(100);

      overlay.querySelector('[id="src/engine.rs"]')?.remove();
      await vi.advanceTimersByTimeAsync(100);
      expect(listed()).not.toContain("src/engine.rs");
      expect(dockedRow("src/engine.rs")).not.toBeNull();

      closeOverlay();
      await vi.advanceTimersByTimeAsync(100);
      expect(listed()).toContain("src/engine.rs");
    });

    it("tells every view where the sections are shown before re-listing them there", async () => {
      mount(() => result);
      log.length = 0;
      openOverlay();
      await vi.advanceTimersByTimeAsync(100);
      closeOverlay();
      await vi.advanceTimersByTimeAsync(100);

      expect(log).toEqual([
        "a.shownIn:overlay",
        "b.shownIn:overlay",
        "a.sections",
        "b.sections",
        "a.shownIn:page",
        "b.shownIn:page",
        "a.sections",
        "b.sections",
      ]);
    });
  });
});

describe("intent shared by each view of one visit", () => {
  const { remountWith } = mountsVisit();

  it("is read once, however many views follow it", () => {
    const read = vi.fn(pendingIntent().intent);
    const shared = shareIntent(read);

    remountWith(shared);
    remountWith(shared);

    expect(read).toHaveBeenCalledOnce();
  });

  it("resumes a view mounted mid-read at the latest progress", () => {
    const pending = pendingIntent();
    const shared = shareIntent(pending.intent);

    remountWith(shared);
    pending.progress({ checked: 2, total: 3 });
    remountWith(shared);
    expect(progressBar()?.getAttribute("aria-valuenow")).toBe("2");

    pending.progress({ checked: 3, total: 3 });
    expect(progressBar()?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("shows a view mounted once it has settled at once, with no progress bar or reveal", async () => {
    const shared = shareIntent(() =>
      Promise.resolve(landedWith(new Map([["src/parser.rs", whole("docs")]]))),
    );

    remountWith(shared);
    await afterDebounce();
    remountWith(shared);

    expect(progressBar()).toBeNull();
    expect(view()?.hasAttribute("aria-busy")).toBe(false);
    expect(view()?.hasAttribute("data-reveal")).toBe(false);
    expect(filesIn("docs")).toContain("src/parser.rs");
  });
});

describe("showHeaderTab", () => {
  const landed = landedWith(
    new Map([["src/lib.rs", whole("docs")]]),
    new Map([["src/lib.rs", { added: 3, removed: 1 }]]),
  );
  const diffstat = { choice: { view: "breakout" as const }, save: () => {} };
  const counter = () => document.querySelector(".gh-prism-diffstat");
  const headerPage = () => {
    const found = findHeaderPage(document);
    if (!found) throw new Error("fixture lacks the header's counter slot");
    return found;
  };

  beforeEach(() => loadHeaderFixture());

  it("mounts the counter once intent lands, and at once on a page that replaces it after", async () => {
    const pending = pendingIntent();
    const intent = shareIntent(pending.intent);
    showHeaderTab(headerPage(), controller.signal, { intent, diffstat });

    pending.resolve(landed);
    await vi.runAllTimersAsync();
    expect(counter()).not.toBeNull();

    controller.abort();
    loadHeaderFixture();
    const replaced = new AbortController();
    showHeaderTab(headerPage(), replaced.signal, { intent, diffstat });
    await vi.runAllTimersAsync();

    expect(counter()?.isConnected).toBe(true);
    replaced.abort();
  });

  it("mounts nothing on a page dropped before intent lands", async () => {
    const pending = pendingIntent();
    showHeaderTab(headerPage(), controller.signal, { intent: pending.intent, diffstat });

    controller.abort();
    pending.resolve(landed);
    await vi.runAllTimersAsync();

    expect(counter()).toBeNull();
  });

  it("logs a read that rejects and mounts nothing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    showHeaderTab(headerPage(), controller.signal, {
      intent: () => Promise.reject(new Error("offline")),
      diffstat,
    });

    await vi.runAllTimersAsync();

    expect(consoleError).toHaveBeenCalledOnce();
    expect(counter()).toBeNull();
    consoleError.mockRestore();
  });
});
