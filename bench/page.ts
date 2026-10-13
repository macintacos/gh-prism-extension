import { showDiffOrder } from "@/entrypoints/content/diffs/diff-order";
import { type FilesPage, findFilesPage } from "@/entrypoints/content/files-page";
import { showSections } from "@/entrypoints/content/sidebar/sections-view";
import type { FileSection } from "@/entrypoints/content/visit/visit";
import { type IntentResult, readIntent } from "@/utils/intent/intent";
import { landingOf, sectionsOf } from "@/utils/intent/landing";
import {
  changedFiles,
  intentDiff,
  mountDiffs,
  mountShell,
  needsHead,
  type SyntheticFile,
  syntheticFiles,
} from "./synthetic";

const NOTHING_PLACED: IntentResult = { ok: true, placements: new Map(), lines: new Map() };

const round = (ms: number) => Math.round(ms * 10) / 10;

/** Forces style and layout. */
const settle = () => document.documentElement.offsetHeight;

async function timed(run: () => unknown): Promise<number> {
  const start = performance.now();
  await run();
  return round(performance.now() - start);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

function mountPage(files: readonly SyntheticFile[], entrySize: number): FilesPage {
  mountShell(document);
  mountDiffs(document, files, entrySize);
  const page = findFilesPage(document);
  if (!page) throw new Error("the synthetic shell doesn't match a pull request's page");
  return page;
}

const orderOf = (anchor: string) => {
  const entry = document.getElementById(anchor)?.parentElement;
  if (!entry) throw new Error(`no diff entry for ${anchor}`);
  return Number(getComputedStyle(entry).order);
};

/** Throws unless the diffs sit in the order `sections` list their files. */
function checkOrder(sections: readonly FileSection[]): void {
  const orders = sections.flatMap(({ entries }) =>
    entries.map(({ file }) => orderOf(file.link.hash.slice(1))),
  );
  if (orders.length === 0 || orders.some((order, i) => i > 0 && !((orders[i - 1] ?? 0) < order)))
    throw new Error("the diff order didn't follow the sections");
}

/** Mounts `count` diffs of `entrySize` elements under the real diff order, ready to time. */
function diffOrder(count: number, entrySize: number) {
  const files = syntheticFiles(count);
  const page = mountPage(files, entrySize);
  const view = showDiffOrder(page, new AbortController().signal);
  const sections = sectionsOf(landingOf(NOTHING_PLACED), changedFiles(document, files, "modified"));
  settle();
  const firstEntry = page.diffs.querySelector('[role="region"]')?.parentElement;
  /** Orders the diffs as `order` lists them; returns the ms, layout included, and throws if the order didn't follow. */
  const arrange = async (order: readonly FileSection[]) => {
    const ms = await timed(() => {
      view.sections?.(order);
      settle();
    });
    checkOrder(order);
    return ms;
  };
  return {
    /** The first entry's element count. */
    elements: firstEntry ? firstEntry.querySelectorAll("*").length + 1 : 0,
    apply: () => arrange(sections),
    /** Each section's files reversed, so the ranks change. */
    rewrite: () =>
      arrange(sections.map((section) => ({ ...section, entries: section.entries.toReversed() }))),
  };
}

/** Each `.gh-prism-tree`'s count of `selector` in its shadow root. */
const countsOf = (selector: string) =>
  [...document.querySelectorAll(".gh-prism-tree")].map(
    (host) => host.shadowRoot?.querySelectorAll(selector).length ?? 0,
  );

const rendered = (selector: string) => countsOf(selector).some((count) => count > 0);

/**
 * Mounts the real sections view on `count` files, its hosts sized as in the sidebar or pinned
 * at one viewport, ready to mount its trees through their post-paint renders. Then times a
 * re-render where every status flips, and one where a path changes; throws unless each showed up.
 */
function sectionTrees(count: number, hosts: "sidebar" | "fixed" = "sidebar") {
  const files = syntheticFiles(count);
  const page = mountPage(files, 2);
  if (hosts === "fixed")
    document.head.insertAdjacentHTML(
      "beforeend",
      "<style>.gh-prism-tree { height: 100vh !important; }</style>",
    );
  const view = showSections(page, new AbortController().signal);
  view.landed?.(NOTHING_PLACED);
  settle();
  const sectionsWith = (status: "modified" | "added", of = files) =>
    sectionsOf(landingOf(NOTHING_PLACED), changedFiles(document, of, status));
  const modified = sectionsWith("modified");
  const added = sectionsWith("added");
  const renderOf = (sections: FileSection[]) => async () => {
    view.sections?.(sections);
    // @pierre/trees renders in a microtask; a task boundary lands it on the clock.
    await nextTask();
    settle();
  };
  /** The trees' ResizeObserver-driven virtualization renders over the next frames. */
  const twoFrames = async () => {
    await nextFrame();
    await nextFrame();
  };
  const rerenders = async () => {
    const rerender = await timed(renderOf(added));
    await twoFrames();
    if (
      !rendered('[data-item-git-status="added"]') ||
      rendered('[data-item-git-status="modified"]')
    )
      throw new Error("the status re-render didn't land");
    const [first, ...rest] = files;
    if (!first) throw new Error("no files to rename");
    const renamed = [{ ...first, path: "docs/guide-0/page-0-renamed.md" }, ...rest];
    const pathRerender = await timed(renderOf(sectionsWith("added", renamed)));
    await twoFrames();
    if (
      !rendered('[data-item-path="docs/guide-0/page-0-renamed.md"]') ||
      rendered('[data-item-path="docs/guide-0/page-0.md"]')
    )
      throw new Error("the path re-render didn't land");
    const rowsPerTree = countsOf('[data-type="item"]');
    const total = rowsPerTree.reduce((sum, count) => sum + count, 0);
    if (total === 0) throw new Error("the section trees rendered no rows");
    return {
      "re-render ms": rerender,
      "path ms": pathRerender,
      "max rows/tree": Math.max(...rowsPerTree),
      "rendered rows": total,
    };
  };
  return {
    mount: async () => {
      await renderOf(modified)();
      await twoFrames();
    },
    rerenders,
  };
}

/** Times `readIntent` over in-memory heads; throws unless every head was read once and some file split. */
async function intent(count: number) {
  const files = syntheticFiles(count);
  const { diffs, heads } = intentDiff(files);
  let reads = 0;
  const client = {
    files: async () => ({ ok: true as const, files: diffs }),
    fileContent: async (path: string) => {
      reads += 1;
      const text = heads.get(path);
      return text === undefined
        ? { ok: false as const, problem: "no-access" as const }
        : { ok: true as const, text };
    },
  };
  let result: IntentResult | undefined;
  const ms = await timed(async () => {
    result = await readIntent(client);
  });
  const expected = files.filter(({ path }) => needsHead(path)).length;
  if (reads !== expected) throw new Error(`read ${reads} heads, expected ${expected}`);
  const split = result?.ok && [...result.placements.values()].some(({ kind }) => kind === "split");
  if (!split) throw new Error("intent split no file");
  return { files: count, "heads read": reads, "read ms": ms };
}

const bench = { diffOrder, sectionTrees, intent };

/** The benchmarks this page puts on `window.bench`, for `run.ts` to call through Playwright. */
export type Bench = typeof bench;

Object.assign(window, { bench });
