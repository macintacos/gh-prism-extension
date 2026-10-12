import { showDiffOrder } from "@/entrypoints/content/diff-order";
import { type FilesPage, findFilesPage } from "@/entrypoints/content/files-page";
import { showSections } from "@/entrypoints/content/sections-view";
import type { FileSection, LandingView } from "@/entrypoints/content/visit";
import { type IntentResult, readIntent } from "@/utils/intent";
import { landingOf, sectionsOf } from "@/utils/landing";
import {
  changedFiles,
  intentDiff,
  mountDiffs,
  mountShell,
  needsHead,
  type SyntheticFile,
  syntheticFiles,
} from "./synthetic";

const PATH_ONLY: IntentResult = { ok: true, placements: new Map(), lines: new Map() };

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

function filesPage(files: readonly SyntheticFile[], entrySize: number): FilesPage {
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

/** Throws unless the first file `sections` list sits ahead of the last. */
function checkOrder(sections: readonly FileSection[]): void {
  const first = sections[0]?.entries[0]?.file.link.hash.slice(1);
  const last = sections.at(-1)?.entries.at(-1)?.file.link.hash.slice(1);
  if (!first || !last || !(orderOf(first) < orderOf(last)))
    throw new Error("the diff order didn't follow the sections");
}

let ordering: { view: LandingView; sections: FileSection[] } | undefined;

const diffOrder = {
  /** Mounts `count` diffs of `entrySize` elements and returns each entry's measured element count. */
  setUp(count: number, entrySize: number): number {
    const files = syntheticFiles(count);
    const page = filesPage(files, entrySize);
    const view = showDiffOrder(page, new AbortController().signal);
    const sections = sectionsOf(landingOf(PATH_ONLY), changedFiles(document, files, "modified"));
    ordering = { view, sections };
    settle();
    const entry = page.diffs.querySelector('[role="region"]')?.parentElement;
    return entry ? entry.querySelectorAll("*").length + 1 : 0;
  },
  /** Orders the diffs as the sections list them. */
  async apply(): Promise<number> {
    const { view, sections } = ordering ?? {};
    if (!view || !sections) throw new Error("set up the diff order first");
    const ms = await timed(() => {
      view.sections?.(sections);
      settle();
    });
    checkOrder(sections);
    return ms;
  },
  /** Reorders the diffs with each section's files reversed, so every rank changes. */
  async rewrite(): Promise<number> {
    const { view, sections } = ordering ?? {};
    if (!view || !sections) throw new Error("set up the diff order first");
    const reversed = sections.map((section) => ({
      ...section,
      entries: section.entries.toReversed(),
    }));
    const ms = await timed(() => {
      view.sections?.(reversed);
      settle();
    });
    checkOrder(reversed);
    return ms;
  },
};

const renderedRows = () =>
  [...document.querySelectorAll(".gh-prism-tree")].reduce(
    (sum, host) => sum + (host.shadowRoot?.querySelectorAll('[data-type="item"]').length ?? 0),
    0,
  );

async function sectionTrees(count: number) {
  const files = syntheticFiles(count);
  const page = filesPage(files, 2);
  const view = showSections(page, new AbortController().signal);
  view.landed?.(PATH_ONLY);
  settle();
  const sectionsWith = (status: "modified" | "added") =>
    sectionsOf(landingOf(PATH_ONLY), changedFiles(document, files, status));
  const modified = sectionsWith("modified");
  const added = sectionsWith("added");
  const renderOf = (sections: FileSection[]) => async () => {
    view.sections?.(sections);
    await nextTask();
    settle();
  };
  const mount = await timed(renderOf(modified));
  const rerender = await timed(renderOf(added));
  await nextFrame();
  await nextFrame();
  const rows = renderedRows();
  if (rows === 0) throw new Error("the section trees rendered no rows");
  return { files: count, "mount ms": mount, "re-render ms": rerender, "rendered rows": rows };
}

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

declare global {
  interface Window {
    bench: typeof bench;
  }
}

window.bench = bench;
