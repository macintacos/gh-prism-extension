// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listRules, showDiffOrder } from "../../../entrypoints/content/diffs/diff-order";
import { commitPage, findFilesPage, prPage } from "../../../entrypoints/content/files-page";
import { byId, loadCommitFixture } from "../../fixtures/files-page";
import { landedWith, pendingIntent, whole } from "../../fixtures/intent";
import {
  addNativeFile,
  afterDebounce,
  filesIn,
  mountsVisit,
  progressBar,
  sectionKeys,
  sheetsStyling,
  view,
} from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

const { remountWith, landed, abort } = mountsVisit();

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

/** Replaces the diff list with GitHub's virtualized one. */
function virtualize(): void {
  byTestId("diff-content").innerHTML =
    '<div style="position: relative"><div data-index="0" style="position: absolute; top: 0px">' +
    '<div role="region" id="diff-0a01"></div></div></div>';
}

/** The diff list entry holding the diff of the native tree's file at `path`. */
function entryOf(path: string): HTMLElement {
  const anchor = byId(path).querySelector("a")?.getAttribute("href")?.slice(1) ?? "";
  const entry = document.getElementById(anchor)?.parentElement;
  if (!entry) throw new Error(`no entry for ${path}`);
  return entry;
}

const SIDEBAR_ORDER = [
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
];

const GITHUB_ORDER = [
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
];

const progressiveList = () => document.querySelector('[data-testid="progressive-diffs-list"]');
const diffsProgressBar = () =>
  document.querySelector<HTMLElement>('[data-testid="diff-content"] [role="progressbar"]');
/** The diff list's entries that carry an inline `order` or `animation-delay`. */
const placedEntries = () =>
  [...(progressiveList()?.children ?? [])].filter(
    (entry) => entry instanceof HTMLElement && (entry.style.order || entry.style.animationDelay),
  );
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
    virtualize();
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
    expect(laidOut(progressiveList())).toEqual(SIDEBAR_ORDER);
  });

  it("place no rule per file", () => {
    const sheets = [...document.querySelectorAll("style")];
    expect(sheets.filter((sheet) => /#diff-[0-9a-f]+\b/.test(sheet.textContent ?? ""))).toEqual([]);
  });

  it("keep their place when GitHub replaces an entry", async () => {
    const old = entryOf("src/engine.rs");
    const fresh = document.createElement("div");
    fresh.append(...old.children);
    old.replaceWith(fresh);
    await Promise.resolve();
    expect(fresh.style.order).toBe("2");
    expect(laidOut(progressiveList())).toEqual(SIDEBAR_ORDER);
  });

  it("take their place when GitHub adds an entry the sidebar lists", async () => {
    const old = entryOf("src/engine.rs");
    old.remove();
    remountWith();
    const entry = document.createElement("div");
    entry.append(...old.children);
    progressiveList()?.append(entry);
    await Promise.resolve();
    expect(entry.style.order).toBe("2");
    expect(laidOut(progressiveList())).toEqual(SIDEBAR_ORDER);
  });

  it("take the sidebar's order when their list appears after the view lands", async () => {
    byTestId("diff-content").replaceChildren();
    remountWith();
    mountEveryDiff();
    await Promise.resolve();
    expect(laidOut(progressiveList())).toEqual(SIDEBAR_ORDER);
  });

  it("take the sidebar's order when GitHub replaces their list after the view lands", async () => {
    remountWith();
    mountEveryDiff();
    await Promise.resolve();
    expect(laidOut(progressiveList())).toEqual(SIDEBAR_ORDER);
  });

  it("keep GitHub's order where a diff isn't its entry's child", () => {
    for (const region of document.querySelectorAll('[role="region"]')) {
      const wrapper = document.createElement("div");
      region.replaceWith(wrapper);
      wrapper.append(region);
    }
    remountWith();
    expect(laidOut(progressiveList())).toEqual(GITHUB_ORDER);
    expect(placedEntries()).toEqual([]);
  });

  it("drop in a section at a time", () => {
    const [first, second] = sectionKeys();
    const delays = (section = "") =>
      filesIn(section).map((path = "") => entryOf(path).style.animationDelay);
    expect(new Set(delays(first))).toEqual(new Set(["0ms"]));
    expect(new Set(delays(second))).toEqual(new Set(["50ms"]));
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
    abort();
    expect(laidOut(progressiveList())).toEqual(GITHUB_ORDER);
  });

  it("leave no inline order on GitHub's entries once the view is gone", () => {
    abort();
    const styled = [...(progressiveList()?.children ?? [])].filter(
      (entry) => entry instanceof HTMLElement && (entry.style.order || entry.style.animationDelay),
    );
    expect(styled).toEqual([]);
  });

  it("show at once when intent has already landed", () => {
    remountWith(() => landedWith());
    expect(diffsShown()).toBe(true);
    expect(diffsProgressBar()).toBeNull();
  });

  it("say they keep GitHub's order when GitHub virtualizes them", async () => {
    virtualize();
    await landed(landedWith());
    expect(view()?.firstElementChild?.textContent).toBe(
      "Diffs keep GitHub's order: gh-prism can't reorder this many files.",
    );
  });

  it("aren't placed while GitHub virtualizes them", async () => {
    virtualize();
    await landed(landedWith());
    expect(placedEntries()).toHaveLength(0);
  });

  it("drop their placement once GitHub virtualizes them", async () => {
    expect(placedEntries()).toHaveLength(13);
    byTestId("diff-content").insertAdjacentHTML(
      "beforeend",
      '<div data-index="0"><div role="region"></div></div>',
    );
    byId("src/engine.rs").setAttribute("aria-current", "true");
    await afterDebounce();
    expect(placedEntries()).toHaveLength(0);
  });

  it("take the sidebar's order once GitHub stops virtualizing them", async () => {
    virtualize();
    await landed(landedWith());
    mountEveryDiff();
    byId("src/engine.rs").setAttribute("aria-current", "true");
    await afterDebounce();
    expect(laidOut(progressiveList()).slice(0, 2)).toEqual([
      "src/generated/schema.rs",
      "src/engine.rs",
    ]);
  });

  describe("while intent is pending", () => {
    it("hide behind a progress bar", () => {
      remountWith(pendingIntent().intent);
      expect(diffsShown()).toBe(false);
      expect(diffsProgressBar()).not.toBeNull();
    });

    it("hide behind a cover styled by its own stylesheets, without the sidebar, until aborted", () => {
      abort();
      const page = findFilesPage(document);
      if (!page) throw new Error("fixture lacks the Files changed markup");
      const controller = new AbortController();
      showDiffOrder(page, controller.signal).pending?.();
      expect(diffsProgressBar()).not.toBeNull();
      expect(sheetsStyling("gh-prism-diff-card")).toHaveLength(1);
      expect(sheetsStyling("gh-prism-loading-label")).toHaveLength(1);
      controller.abort();
      expect(sheetsStyling("gh-prism-diff-card")).toHaveLength(0);
      expect(sheetsStyling("gh-prism-loading-label")).toHaveLength(0);
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

    it("stay revealed until the last section's files have dropped in", async () => {
      const pending = pendingIntent();
      remountWith(pending.intent);
      pending.resolve(landedWith());
      await vi.advanceTimersByTimeAsync(599);
      expect(document.documentElement.dataset.ghPrismDiffs).toBe("revealed");
      await vi.advanceTimersByTimeAsync(1);
      expect(document.documentElement.dataset.ghPrismDiffs).toBeUndefined();
    });
  });
});

describe("a commit's diffs beside the sections", () => {
  it("lie in the sidebar's order, the first flush under the toolbar", () => {
    abort();
    loadCommitFixture();
    const [launcher, test] = [...document.querySelectorAll('[role="region"]')].map(
      (region) => region.parentElement,
    );
    if (!launcher || !test) throw new Error("commit fixture lacks two diffs");
    // As GitHub would list them in the opposite order: the first one has no top padding.
    launcher.before(test);
    test.style.paddingTop = "0px";
    launcher.style.paddingTop = "16px";
    remountWith();
    expect(laidOut(launcher.parentElement)).toEqual([
      "bin/caret-launcher",
      "test/core/commands/install/launcher.test.ts",
    ]);
    expect(getComputedStyle(launcher).paddingTop).toBe("0px");
    expect(getComputedStyle(test).paddingTop).toBe("16px");
  });
});

describe("a page kind's list rules", () => {
  const reveal = (entries: string) =>
    "@media (prefers-reduced-motion: no-preference) { " +
    `html[data-gh-prism-diffs="revealed"] ${entries} { ` +
    "animation: gh-prism-diff-reveal 280ms cubic-bezier(0.2, 0.7, 0.2, 1) backwards; } }";

  it("put a pull request's unlisted files last, hide its whole list while covered, and drop its files in", () => {
    const entries = '[data-testid="progressive-diffs-list"] > :has([role="region"])';
    expect(listRules(prPage)).toBe(
      [
        `${entries} { order: 999999; }`,
        `${entries} ~ :not(:has([role="region"])) { order: 1000000; }`,
        'html[data-gh-prism-diffs="covered"] [data-testid="progressive-diffs-list"] { display: none !important; }',
        reveal(entries),
      ].join("\n"),
    );
  });

  it("make a commit's list a flex column and keep its toolbar in view while covered", () => {
    const list = '#diff-content-parent > :has(> * > [role="region"])';
    const entries = `${list} > :has([role="region"])`;
    expect(listRules(commitPage)).toBe(
      [
        `${list} { display: flex; flex-direction: column; }`,
        `${entries} { order: 999999; }`,
        `${entries} ~ :not(:has([role="region"])) { order: 1000000; }`,
        `html[data-gh-prism-diffs="covered"] ${list} > :not(:first-child) { display: none !important; }`,
        reveal(entries),
      ].join("\n"),
    );
  });
});
