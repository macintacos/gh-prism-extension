// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FilesPage, findFilesPage, readChangedFiles } from "../entrypoints/content/files-page";
import { type FileSection, type LandingView, land } from "../entrypoints/content/visit";
import type { IntentProgress, IntentResult, PendingIntent } from "../utils/intent";
import { landingOf, sectionsOf } from "../utils/landing";
import { byId, loadFixture } from "./fixtures/files-page";

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
