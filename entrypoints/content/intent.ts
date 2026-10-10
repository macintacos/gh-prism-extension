import {
  type DocVerdict,
  docHunkVerdicts,
  type ScannedHead,
  scanHeadText,
} from "@/utils/doc-intent";
import { inlineTestHunkVerdicts, inlineTestRuleApplies } from "@/utils/inline-tests";
import { type HeadLineSpan, hunkHeadSpan, type PrFileDiff, parsePrHunks } from "@/utils/pr-diff";
import type { PrDataClient } from "@/utils/pr-port";
import type { PrRef } from "@/utils/pr-ref";
import type { PrDataProblem } from "@/utils/pr-source";
import { classify, SECTIONS, type SectionKey } from "@/utils/sections";
import type { FilesRoute } from "./files-page";

/** Why the view keeps path-only sections. */
export type PathOnlyReason = PrDataProblem | "commit-filtered";
/** The sections intent can move a whole file into, whatever its path says. */
export type IntentSection = Extract<SectionKey, "docs" | "tests">;

/** One section's part of a file whose hunks span several sections. */
export interface SectionShare {
  readonly section: SectionKey;
  /** The head-file lines of each hunk placed here, in diff order; `undefined` for a hunk with none. */
  readonly hunks: readonly (HeadLineSpan | undefined)[];
}

/**
 * Where the changed files land, or why the view keeps path-only sections. A file in `overrides` is
 * moved whole to its section; a file in `splits` is listed in each section its hunks land in. A file
 * in neither keeps its path section.
 */
export type IntentResult =
  | {
      ok: true;
      overrides: ReadonlyMap<string, IntentSection>;
      /** Keyed by path, with each file's shares in `SECTIONS` order. */
      splits: ReadonlyMap<string, readonly SectionShare[]>;
    }
  | { ok: false; problem: PathOnlyReason };

type Placement = { readonly override: IntentSection } | { readonly split: readonly SectionShare[] };

const isDocs = (verdict: DocVerdict) => verdict === "docs";

async function readHead(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<ScannedHead | undefined> {
  const content = await client.fileContent(file.path);
  return content.ok ? scanHeadText(file.path, content.text) : undefined;
}

/**
 * Each hunk's rule section, or `undefined` to keep it in the path section; aligned with
 * `parsePrHunks`. The head is read only when the patch can't settle every hunk as docs and a rule
 * needs it.
 */
async function hunkSections(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<(IntentSection | undefined)[]> {
  const byPatch = docHunkVerdicts(file);
  if (byPatch.every(isDocs)) return byPatch.map(() => "docs"); // also [] for binary or renamed
  const needsHead = inlineTestRuleApplies(file) || byPatch.includes("needs-content");
  const head = needsHead ? await readHead(client, file) : undefined;
  if (head === undefined) return byPatch.map((verdict) => (isDocs(verdict) ? "docs" : undefined));
  const docs = docHunkVerdicts(file, head);
  if (docs.every(isDocs)) return docs.map(() => "docs");
  const tests = inlineTestHunkVerdicts(file, head);
  return docs.map((verdict, i) => (tests[i] ? "tests" : isDocs(verdict) ? "docs" : undefined));
}

/**
 * Pure: a split when the hunks resolve to two or more sections; an override when every hunk lands in
 * the same rule section; otherwise nothing, so the file keeps its path section.
 */
function placementOf(
  path: string,
  spans: readonly (HeadLineSpan | undefined)[],
  sections: readonly (IntentSection | undefined)[],
): Placement | undefined {
  const resolved = sections.map((section) => section ?? classify(path));
  if (new Set(resolved).size > 1) {
    return {
      split: SECTIONS.flatMap(({ key }) => {
        const hunks = resolved.flatMap((section, i) => (section === key ? [spans[i]] : []));
        return hunks.length > 0 ? [{ section: key, hunks }] : [];
      }),
    };
  }
  const [first] = sections;
  return first !== undefined && sections.every((section) => section === first)
    ? { override: first }
    : undefined;
}

const spansOf = (file: PrFileDiff) =>
  file.kind === "text" ? parsePrHunks(file.patch).map((hunk) => hunkHeadSpan(hunk)) : [];

/**
 * Reads the PR's files and places each one's hunks. A file whose head can't be read keeps the hunks
 * its patch settles, and the rest stay in its path section; only a `files()` failure makes the
 * result not ok.
 */
export async function readIntent(
  client: Pick<PrDataClient, "files" | "fileContent">,
): Promise<IntentResult> {
  const listed = await client.files();
  if (!listed.ok) return listed;
  // ponytail: unbounded concurrency; every file a rule needs content for reads at once.
  // Cap it with a worker pool if reads trip rate-limited.
  const placements = await Promise.all(
    listed.files.map(async (file) => ({
      path: file.path,
      placement: placementOf(file.path, spansOf(file), await hunkSections(client, file)),
    })),
  );
  const overrides = new Map<string, IntentSection>();
  const splits = new Map<string, readonly SectionShare[]>();
  for (const { path, placement } of placements) {
    if (placement === undefined) continue;
    if ("override" in placement) overrides.set(path, placement.override);
    else splits.set(path, placement.split);
  }
  return { ok: true, overrides, splits };
}

/**
 * Section overrides for one Files view. A commit-filtered route connects nothing; otherwise the
 * client is closed when `signal` aborts. Never rejects; once `signal` aborts it may never settle.
 */
export async function intentFor(
  route: FilesRoute,
  signal: AbortSignal,
  connect: (pr: PrRef) => PrDataClient,
): Promise<IntentResult> {
  if (route.commitFiltered) return { ok: false, problem: "commit-filtered" };
  const client = connect(route.pr);
  signal.addEventListener("abort", () => client.close(), { once: true });
  return readIntent(client);
}
