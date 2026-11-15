import { afterEach, beforeEach, vi } from "vitest";
import {
  type FilesPage,
  findFilesPage,
  findFilesToolbar,
  findLayoutGear,
} from "../../../entrypoints/content/files-page";
import commitSplit from "../../fixtures/commit-page-diff-split.html?raw";
import commitUnified from "../../fixtures/commit-page-diff-unified.html?raw";
import commitToolbar from "../../fixtures/commit-page-toolbar.html?raw";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";
import prUnified from "../../fixtures/files-page-diff-rename.html?raw";
import prSplit from "../../fixtures/files-page-diff-split.html?raw";
import prToolbar from "../../fixtures/files-page-toolbar.html?raw";
import { installLayoutMenu } from "../../fixtures/layout-menu";
import commitMenu from "../../fixtures/layout-menu-commit.html?raw";
import prMenu from "../../fixtures/layout-menu-pr.html?raw";

const KINDS = {
  pr: { load: loadFixture, toolbar: prToolbar, menu: prMenu, unified: prUnified, split: prSplit },
  commit: {
    load: loadCommitFixture,
    toolbar: commitToolbar,
    menu: commitMenu,
    unified: commitUnified,
    split: commitSplit,
  },
};

/**
 * A page of `kind` with one diff table and, unless `gear` is false, its toolbar's gear, whose
 * diff settings menu (`menu`, or the kind's own) opens until `signal` aborts.
 */
export function menuPageOf(
  kind: keyof typeof KINDS,
  signal: AbortSignal,
  { gear = true, menu }: { gear?: boolean; menu?: string } = {},
): FilesPage {
  const fixtures = KINDS[kind];
  fixtures.load();
  const page = findFilesPage(document);
  const toolbar = page && findFilesToolbar(page);
  if (!page || !toolbar) throw new Error("fixture has no page or toolbar");
  if (gear) toolbar.outerHTML = fixtures.toolbar;
  else findLayoutGear(page)?.remove();

  const region = document.createElement("div");
  region.innerHTML = fixtures.split;
  page.diffs.append(region);

  installLayoutMenu({
    menu: menu ?? fixtures.menu,
    tables: { unified: fixtures.unified, split: fixtures.split },
    signal,
  });
  return page;
}

/**
 * Gives each test in the calling suite fake timers, a silenced `console.warn`, and an abort
 * signal. Read them through the returned getters, since each test gets fresh ones.
 */
export function useMenuTest() {
  let controller: AbortController;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    controller.abort();
    warn.mockRestore();
    vi.useRealTimers();
  });

  return {
    get signal() {
      return controller.signal;
    },
    get warn() {
      return warn;
    },
    abort: () => controller.abort(),
    pageOf: (kind: keyof typeof KINDS, opts?: { gear?: boolean; menu?: string }) =>
      menuPageOf(kind, controller.signal, opts),
  };
}

/** Clicks `page`'s gear and lets the menu open, under fake timers. */
export async function openMenu(page: FilesPage): Promise<void> {
  findLayoutGear(page)?.click();
  await vi.advanceTimersByTimeAsync(100);
}
