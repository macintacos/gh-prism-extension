// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffstatChoice } from "../entrypoints/content/diffstat-view";
import { type FilesPage, findFilesPage, readChangedFiles } from "../entrypoints/content/files-page";
import { type FileSection, type LandingView, land, showVisit } from "../entrypoints/content/visit";
import {
  type IntentProgress,
  type IntentResult,
  type PendingIntent,
  shareIntent,
} from "../utils/intent";
import { landingOf, sectionsOf } from "../utils/landing";
import { byId, loadFixture } from "./fixtures/files-page";
import { landedWith, whole } from "./fixtures/intent";

// Chrome content scripts run in an isolated world whose `customElements` is null. Hoisted above
// the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

let controller: AbortController;
let page: FilesPage;
let log: string[];
const received: (readonly FileSection[])[] = [];

const result: IntentResult = {
  ok: true,
  placements: new Map([["src/lib.rs", { kind: "whole", section: "docs" }]]),
  lines: new Map(),
};

function recording(name: string): LandingView {
  return {
    pending: () => log.push(`${name}.pending`),
    progress: () => log.push(`${name}.progress`),
    landed: () => log.push(`${name}.landed`),
    sections: (sections) => {
      log.push(`${name}.sections`);
      received.push(sections);
    },
  };
}

const view = () => document.querySelector<HTMLElement>(".gh-prism-sections");
const progressBar = () => view()?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;

function treeHost(section: string): HTMLElement {
  const host = document.querySelector<HTMLElement>(
    `.gh-prism-section[data-section="${section}"] .gh-prism-tree`,
  );
  if (!host) throw new Error(`no tree in ${section}`);
  return host;
}

const rowsIn = (section: string) => [
  ...(treeHost(section).shadowRoot?.querySelectorAll<HTMLElement>('[data-type="item"]') ?? []),
];

const filesIn = (section: string) =>
  rowsIn(section)
    .filter((row) => row.dataset.itemType === "file")
    .map((row) => row.dataset.itemPath);

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

/** Replaces any mounted visit with one that waits on `intent`. */
function remountWith(
  intent: PendingIntent = () => landedWith(),
  diffstat: DiffstatChoice = { view: "breakout" },
): void {
  controller.abort();
  controller = new AbortController();
  showVisit(page, controller.signal, { intent, diffstat });
}

function pendingIntent() {
  const deferred = Promise.withResolvers<IntentResult>();
  let report: (progress: IntentProgress) => void = () => {};
  const intent: PendingIntent = (onProgress) => {
    report = onProgress;
    onProgress({ checked: 0, total: 2 });
    return deferred.promise;
  };
  return { intent, resolve: deferred.resolve, progress: (p: IntentProgress) => report(p) };
}

const mount = (intent: PendingIntent, ignore?: Node) =>
  land(page, intent, [recording("a"), recording("b")], { signal: controller.signal, ignore });

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  controller = new AbortController();
  const found = findFilesPage(document);
  if (!found) throw new Error("fixture lacks the Files changed markup");
  page = found;
  log = [];
  received.length = 0;
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

describe("land", () => {
  it("shows every view pending, then the replayed progress, then each new progress", () => {
    const { intent, progress } = pendingIntent();
    mount(intent);
    expect(log).toEqual(["a.pending", "b.pending", "a.progress", "b.progress"]);
    progress({ checked: 1, total: 2 });
    expect(log.slice(4)).toEqual(["a.progress", "b.progress"]);
  });

  it("lands every view before any view gets the one shared section model", async () => {
    const { intent, resolve } = pendingIntent();
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
    mount(pendingIntent().intent);
    log.length = 0;
    byId("src/lib.rs").removeAttribute("aria-current");
    await vi.advanceTimersByTimeAsync(100);
    expect(log).toEqual([]);
  });
});

describe("intent shared by each view of one visit", () => {
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
