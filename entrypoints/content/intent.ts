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
/** The sections a rule can claim a file or hunk for, whatever its path says. */
export type IntentSection = Extract<SectionKey, "docs" | "tests">;

/** One section's part of a file whose hunks span several sections. */
export interface SectionShare {
  readonly section: SectionKey;
  /** The head-file lines of each hunk placed here, in diff order; `undefined` for a hunk with none. */
  readonly hunks: readonly (HeadLineSpan | undefined)[];
}

/** Where intent moves one file: whole to a rule section, or across sections hunk by hunk. */
export type Placement =
  | { readonly kind: "whole"; readonly section: IntentSection }
  | { readonly kind: "split"; readonly shares: readonly SectionShare[] };

/** Where the changed files land, or why the view keeps path-only sections. */
export type IntentResult =
  | {
      ok: true;
      /** Keyed by path; a file absent here keeps its path section. Split shares are in `SECTIONS` order. */
      placements: ReadonlyMap<string, Placement>;
    }
  | { ok: false; problem: PathOnlyReason };

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
 * needs it. A file whose every hunk is docs moves whole to Documentation; otherwise a hunk in a test
 * block counts as Tests even when it only edits a doc comment.
 */
async function hunkSections(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<(IntentSection | undefined)[]> {
  const patchVerdicts = docHunkVerdicts(file);
  // also [] for binary or renamed
  if (patchVerdicts.every(isDocs)) return patchVerdicts.map(() => "docs");
  const needsHead = inlineTestRuleApplies(file) || patchVerdicts.includes("needs-content");
  const head = needsHead ? await readHead(client, file) : undefined;
  if (head === undefined)
    return patchVerdicts.map((verdict) => (isDocs(verdict) ? "docs" : undefined));
  const headVerdicts = docHunkVerdicts(file, head);
  if (headVerdicts.every(isDocs)) return headVerdicts.map(() => "docs");
  const inTests = inlineTestHunkVerdicts(file, head);
  return headVerdicts.map((verdict, i) =>
    inTests[i] ? "tests" : isDocs(verdict) ? "docs" : undefined,
  );
}

/**
 * Once each unclaimed hunk takes the path section, a split when the hunks span two or more
 * sections; a whole move when every hunk is claimed by one rule section; otherwise nothing, so the
 * file keeps its path section.
 */
function placementOf(
  file: PrFileDiff,
  sections: readonly (IntentSection | undefined)[],
): Placement | undefined {
  const resolved = sections.map((section) => section ?? classify(file.path));
  if (new Set(resolved).size > 1) {
    const spans = spansOf(file); // non-empty sections ⇒ a text file that wasn't renamed
    return {
      kind: "split",
      shares: SECTIONS.flatMap(({ key }) => {
        const hunks = resolved.flatMap((section, i) => (section === key ? [spans[i]] : []));
        return hunks.length > 0 ? [{ section: key, hunks }] : [];
      }),
    };
  }
  const [first] = sections;
  return first !== undefined && sections.every((section) => section === first)
    ? { kind: "whole", section: first }
    : undefined;
}

const spansOf = (file: PrFileDiff): SectionShare["hunks"] =>
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
  const placed = await Promise.all(
    listed.files.map(async (file) => ({
      path: file.path,
      placement: placementOf(file, await hunkSections(client, file)),
    })),
  );
  const placements = new Map<string, Placement>();
  for (const { path, placement } of placed) {
    if (placement === undefined) continue;
    placements.set(path, placement);
  }
  return { ok: true, placements };
}

/**
 * Where one Files view's files land. A commit-filtered route connects nothing; otherwise the
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
