// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffstatChoice } from "../entrypoints/content/diffstat-view";
import { findFilesPage } from "../entrypoints/content/files-page";
import { showVisit } from "../entrypoints/content/visit";
import type { IntentResult, PendingIntent } from "../utils/intent";
import { byId, loadCommitFixture, loadFixture } from "./fixtures/files-page";
import { landedWith, pendingIntent, whole } from "./fixtures/intent";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

let controller: AbortController;

const view = () => document.querySelector<HTMLElement>(".gh-prism-sections");
const progressBar = () => view()?.querySelector<HTMLElement>('[role="progressbar"]') ?? null;

const sectionKeys = () =>
  [...document.querySelectorAll<HTMLElement>(".gh-prism-section")].map(
    (section) => section.dataset.section,
  );

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

/** Adds a native row for `path` after `after`'s row, as GitHub does when a file joins the PR. */
function addNativeFile(path: string, after: string): void {
  const native = byId(after).cloneNode(true);
  if (!(native instanceof HTMLElement)) throw new Error("clone is not an element");
  native.id = path;
  byId(after).after(native);
}

// Past the 50 ms debounce; the async advance runs the MutationObserver's pending microtask first.
const afterDebounce = () => vi.advanceTimersByTimeAsync(100);

/**
 * Replaces the view `beforeEach` mounted with one that waits on `intent`, in a tab whose header
 * counter last chose `diffstat`.
 */
function remountWith(
  intent: PendingIntent = () => landedWith(),
  diffstat: DiffstatChoice = { view: "breakout" },
): void {
  controller.abort();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showVisit(page, controller.signal, { intent, diffstat });
}

/** Mounts the view with `result` already landed, and lets it render. */
async function landed(result: IntentResult): Promise<void> {
  remountWith(() => Promise.resolve(result));
  await afterDebounce();
}

beforeEach(() => {
  vi.useFakeTimers();
  loadFixture();
  controller = new AbortController();
  const page = findFilesPage(document);
  if (!page) throw new Error("fixture lacks the Files changed markup");
  showVisit(page, controller.signal, {
    intent: () => landedWith(),
    diffstat: { view: "breakout" },
  });
});
afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

/** Replaces the diff list with GitHub's progressive one, every native file's diff mounted. */
function mountEveryDiff(): void {
  const list = document.createElement("div");
  list.dataset.testid = "progressive-diffs-list";
  for (const link of document.querySelectorAll('ul[role="tree"] a[href^="#diff-"]')) {
    const entry = document.createElement("div");
    entry.className = "PullRequestDiffsList-module__diffEntry__djnVa";
    entry.innerHTML = `<div role="region" id="${link.getAttribute("href")?.slice(1)}"></div>`;
    list.append(entry);
  }
  document.querySelector('[data-testid="diff-content"]')?.replaceChildren(list);
}

/**
 * The files whose diffs sit in `list`, top to bottom as laid out: DOM order, sorted by CSS order.
 * A file the native tree no longer lists shows as its anchor.
 */
function laidOut(list: Element | null): string[] {
  const placed = [...(list?.children ?? [])].map((entry, index) => ({
    entry,
    index,
    order: Number(getComputedStyle(entry).order) || 0,
  }));
  return placed
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .flatMap(({ entry }) => {
      const region = entry.querySelector('[role="region"]');
      const anchor = (
        region?.id ||
        region?.querySelector('a[href^="#diff-"]')?.getAttribute("href") ||
        ""
      ).replace(/^#/, "");
      if (!anchor) return [];
      const row = document
        .querySelector(`ul[role="tree"] a[href="#${anchor}"]`)
        ?.closest('[role="treeitem"]');
      return [row?.id ?? anchor];
    });
}

function byTestId(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!found) throw new Error(`fixture has no ${id}`);
  return found;
}

const progressiveList = () => document.querySelector('[data-testid="progressive-diffs-list"]');
const diffsProgressBar = () =>
  document.querySelector<HTMLElement>('[data-testid="diff-content"] [role="progressbar"]');
const diffsShown = () => getComputedStyle(progressiveList() ?? document.body).display !== "none";

describe("the diffs beside the sections", () => {
  beforeEach(mountEveryDiff);

  it("lift their cover in the same task the sections render", async () => {
    const pending = pendingIntent();
    remountWith(pending.intent);
    expect(diffsShown()).toBe(false);
    pending.resolve(landedWith());
    await vi.advanceTimersByTimeAsync(0);
    expect(sectionKeys()).toHaveLength(5);
    expect(diffsShown()).toBe(true);
    expect(diffsProgressBar()).toBeNull();
  });

  it("say they keep GitHub's order below the path-only notice, both above the sections", async () => {
    byTestId("diff-content").innerHTML =
      '<div style="position: relative"><div data-index="0" style="position: absolute; top: 0px">' +
      '<div role="region" id="diff-0a01"></div></div></div>';
    await landed({ ok: false, problem: "no-access" });
    const [first, second, third] = [...(view()?.children ?? [])];
    expect(first?.textContent).toBe(
      "Grouped by path. Sign in to GitHub to detect docstring-only and inline-test changes.",
    );
    expect(second?.textContent).toBe(
      "Diffs keep GitHub's order: gh-prism can't reorder this many files.",
    );
    expect(third?.classList.contains("gh-prism-section")).toBe(true);
  });

  it("lie in the sidebar's order", () => {
    expect(laidOut(progressiveList())).toEqual([
      "src/generated/schema.rs",
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/notes.rs",
      "src/parser.rs",
      "src/render.rs",
      "tests/integration.rs",
      "docs/guide.md",
      "README.md",
      "config/app.toml",
      "Cargo.toml",
      "Cargo.lock",
    ]);
  });

  it("put a file intent moves where the sidebar lists it", async () => {
    await landed(landedWith(new Map([["src/notes.rs", whole("docs")]])));
    expect(laidOut(progressiveList())).toEqual([
      "src/generated/schema.rs",
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/parser.rs",
      "src/render.rs",
      "tests/integration.rs",
      "docs/guide.md",
      "src/notes.rs",
      "README.md",
      "config/app.toml",
      "Cargo.toml",
      "Cargo.lock",
    ]);
  });

  it("put a Partial file where the sidebar first lists it", async () => {
    const share = (section: "tests" | "docs") => ({
      section,
      hunks: [{ first: 1, last: 2 }],
      lines: { added: 1, removed: 1 },
    });
    await landed(
      landedWith(
        new Map([["src/render.rs", { kind: "split", shares: [share("tests"), share("docs")] }]]),
      ),
    );
    expect(laidOut(progressiveList())).toEqual([
      "src/generated/schema.rs",
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/notes.rs",
      "src/parser.rs",
      "src/render.rs",
      "tests/integration.rs",
      "docs/guide.md",
      "README.md",
      "config/app.toml",
      "Cargo.toml",
      "Cargo.lock",
    ]);
    expect(filesIn("tests")).toEqual(["src/render.rs", "tests/integration.rs"]);
  });

  it("follow a file that joins the sidebar", async () => {
    addNativeFile("docs/intro.md", "docs/guide.md");
    byId("docs/intro.md").querySelector("a")?.setAttribute("href", "#diff-0a14");
    const entry = document.createElement("div");
    entry.innerHTML = '<div role="region" id="diff-0a14"></div>';
    progressiveList()?.append(entry);
    await afterDebounce();
    expect(laidOut(progressiveList()).slice(8, 11)).toEqual([
      "docs/guide.md",
      "docs/intro.md",
      "README.md",
    ]);
  });

  it("put a diff the sidebar doesn't list after the ones it does", async () => {
    byId("docs/guide.md").remove();
    await afterDebounce();
    expect(laidOut(progressiveList()).slice(-2)).toEqual(["Cargo.lock", "diff-0a02"]);
  });

  it("keep GitHub's order once the view is gone", () => {
    controller.abort();
    expect(laidOut(progressiveList())).toEqual([
      "config/app.toml",
      "docs/guide.md",
      "src/generated/schema.rs",
      "src/engine.rs",
      "src/helpers.rs",
      "src/lib.rs",
      "src/notes.rs",
      "src/parser.rs",
      "src/render.rs",
      "tests/integration.rs",
      "Cargo.lock",
      "Cargo.toml",
      "README.md",
    ]);
  });

  it("show at once when intent has already landed", () => {
    remountWith(() => landedWith());
    expect(diffsShown()).toBe(true);
    expect(diffsProgressBar()).toBeNull();
  });

  it("say they keep GitHub's order when GitHub virtualizes them", async () => {
    byTestId("diff-content").innerHTML =
      '<div style="position: relative"><div data-index="0" style="position: absolute; top: 0px">' +
      '<div role="region" id="diff-0a01"></div></div></div>';
    await landed(landedWith());
    expect(view()?.firstElementChild?.textContent).toBe(
      "Diffs keep GitHub's order: gh-prism can't reorder this many files.",
    );
  });

  describe("while intent is pending", () => {
    it("hide behind a progress bar", () => {
      remountWith(pendingIntent().intent);
      expect(diffsShown()).toBe(false);
      expect(diffsProgressBar()).not.toBeNull();
    });

    it("show anyway once the read has taken 15 seconds", async () => {
      remountWith(pendingIntent().intent);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(diffsShown()).toBe(true);
      expect(diffsProgressBar()).toBeNull();
      expect(progressBar()).not.toBeNull();
    });

    it("report how many of the diff's files intent has checked", () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.progress({ checked: 3, total: 13 });
      expect(diffsProgressBar()?.getAttribute("aria-valuenow")).toBe("3");
    });

    it("show in the sidebar's order once it settles", async () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.resolve(landedWith(new Map([["src/notes.rs", whole("docs")]])));
      await afterDebounce();
      expect(diffsShown()).toBe(true);
      expect(diffsProgressBar()).toBeNull();
      expect(laidOut(progressiveList()).slice(7, 10)).toEqual([
        "docs/guide.md",
        "src/notes.rs",
        "README.md",
      ]);
    });

    it("hand GitHub the URL's hash afresh once they show, since it can't land on hidden diffs", async () => {
      history.replaceState(null, "", "#diff-0a08R2");
      const announced: string[] = [];
      // happy-dom also fires hashchange, a tick late, whenever replaceState changes the hash.
      const ours = vi.spyOn(globalThis, "HashChangeEvent");
      const listen = (event: HashChangeEvent) => {
        if (ours.mock.results.some(({ value }) => value === event)) announced.push(location.hash);
      };
      window.addEventListener("hashchange", listen);
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.resolve(landedWith());
      await afterDebounce();
      window.removeEventListener("hashchange", listen);
      ours.mockRestore();
      history.replaceState(null, "", location.pathname);
      expect(announced).toEqual(["", "#diff-0a08R2"]);
    });
  });
});

describe("a commit's diffs beside the sections", () => {
  it("lie in the sidebar's order, the first flush under the toolbar", () => {
    controller.abort();
    loadCommitFixture();
    const [launcher, test] = [...document.querySelectorAll('[role="region"]')].map(
      (region) => region.parentElement,
    );
    if (!launcher || !test) throw new Error("commit fixture lacks two diffs");
    // As GitHub would list them in the opposite order: the first one has no top padding.
    launcher.before(test);
    test.style.paddingTop = "0px";
    launcher.style.paddingTop = "16px";
    controller = new AbortController();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the commit markup");
    showVisit(page, controller.signal, {
      intent: () => landedWith(),
      diffstat: { view: "breakout" },
    });
    expect(laidOut(launcher.parentElement)).toEqual([
      "bin/caret-launcher",
      "test/core/commands/install/launcher.test.ts",
    ]);
    expect(getComputedStyle(launcher).paddingTop).toBe("0px");
    expect(getComputedStyle(test).paddingTop).toBe("16px");
  });
});
