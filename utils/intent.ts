import { type DocVerdict, docHunkVerdicts, type ScannedHead, scanHeadText } from "./doc-intent";
import type { FilesRoute } from "./files-route";
import { inlineTestHunkVerdicts, inlineTestRuleApplies } from "./inline-tests";
import type { IntentCache } from "./intent-cache";
import { sectionOf } from "./landing";
import {
  type HeadLineSpan,
  hunkHeadSpan,
  hunkLineCounts,
  type LineCounts,
  type PrFileDiff,
  type PrHunk,
  parsePrHunks,
} from "./pr-diff";
import type { PrDataClient } from "./pr-port";
import type { DiffRef } from "./pr-ref";
import type { PrDataProblem } from "./pr-source";
import { SECTIONS, type SectionKey } from "./sections";

/** Why the view keeps path-only sections. */
export type PathOnlyReason = PrDataProblem | "commit-filtered";
/** The sections a rule can claim a file or hunk for, whatever its path says. */
export type IntentSection = Extract<SectionKey, "docs" | "tests">;

/** One section's part of a file whose hunks span several sections. */
export interface SectionShare {
  readonly section: SectionKey;
  /** The head-file lines of each hunk placed here, in diff order; `undefined` for a hunk with none. */
  readonly hunks: readonly (HeadLineSpan | undefined)[];
  /** Lines the hunks placed here add and remove. */
  readonly lines: LineCounts;
}

/** A file's whole-diff line counts, or `"binary"` for a binary file such as an image. */
export type FileLines = LineCounts | "binary";

/** How far `readIntent` has got: `checked` of the diff's `total` files placed. */
export interface IntentProgress {
  readonly checked: number;
  readonly total: number;
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
      /** Every file in the PR's diff, keyed by path. */
      lines: ReadonlyMap<string, FileLines>;
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
  const resolved = sections.map((section) => sectionOf(file.path, section));
  if (new Set(resolved).size > 1) {
    const hunks = hunksOf(file); // non-empty sections ⇒ a text file that wasn't renamed
    return {
      kind: "split",
      shares: SECTIONS.flatMap(({ key }) => {
        const placed = hunks.filter((_, i) => resolved[i] === key);
        return placed.length > 0 ? [shareOf(key, placed)] : [];
      }),
    };
  }
  const [first] = sections;
  return first !== undefined && sections.every((section) => section === first)
    ? { kind: "whole", section: first }
    : undefined;
}

const sumHunkLines = (hunks: readonly PrHunk[]): LineCounts =>
  hunks.reduce(
    (sum, hunk) => {
      const counts = hunkLineCounts(hunk);
      return { added: sum.added + counts.added, removed: sum.removed + counts.removed };
    },
    { added: 0, removed: 0 },
  );

const shareOf = (section: SectionKey, hunks: readonly PrHunk[]): SectionShare => ({
  section,
  hunks: hunks.map((hunk) => hunkHeadSpan(hunk)),
  lines: sumHunkLines(hunks),
});

const hunksOf = (file: PrFileDiff): PrHunk[] =>
  file.kind === "text" ? parsePrHunks(file.patch) : [];

const linesOf = (file: PrFileDiff): FileLines =>
  file.kind === "binary" ? "binary" : sumHunkLines(hunksOf(file));

/**
 * Reads the PR's files and places each one's hunks. A file whose head can't be read keeps the hunks
 * its patch settles, and the rest stay in its path section; only a `files()` failure makes the
 * result not ok. `onProgress` reports once after `files()` succeeds, then once per file as it is
 * placed.
 */
export async function readIntent(
  client: Pick<PrDataClient, "files" | "fileContent">,
  onProgress?: (progress: IntentProgress) => void,
): Promise<IntentResult> {
  const listed = await client.files();
  if (!listed.ok) return listed;
  const total = listed.files.length;
  onProgress?.({ checked: 0, total });
  let checked = 0;
  // ponytail: unbounded concurrency; every file a rule needs content for reads at once.
  // Cap it with a worker pool if reads trip rate-limited.
  const placed = await Promise.all(
    listed.files.map(async (file) => {
      const placement = placementOf(file, await hunkSections(client, file));
      checked += 1;
      onProgress?.({ checked, total });
      return { path: file.path, placement };
    }),
  );
  const placements = new Map<string, Placement>();
  for (const { path, placement } of placed) {
    if (placement === undefined) continue;
    placements.set(path, placement);
  }
  const lines = new Map<string, FileLines>();
  for (const file of listed.files) lines.set(file.path, linesOf(file));
  return { ok: true, placements, lines };
}

/** Where `intentFor` reads a diff, and where it keeps what it read. */
export interface IntentSources {
  readonly connect: (diff: DiffRef) => PrDataClient;
  readonly cache: IntentCache;
}

/** Problems a later read of a file may not hit. */
const PASSING: ReadonlySet<PrDataProblem> = new Set(["rate-limited", "failed"]);

/** A key for `files` read at `headSha`: a diff whose head or patches change gets a new one. */
async function diffKey(headSha: string, files: readonly PrFileDiff[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([headSha, files]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Where one Files view's files land: from `cache` when it holds this very diff, else read and
 * cached. A read that a file's passing problem cut short isn't cached. A commit-filtered route
 * connects nothing; otherwise the client is closed when `signal` aborts. Never rejects; once
 * `signal` aborts it may never settle.
 */
export async function intentFor(
  route: FilesRoute,
  signal: AbortSignal,
  { connect, cache }: IntentSources,
  onProgress?: (progress: IntentProgress) => void,
): Promise<IntentResult> {
  if (route.commitFiltered) return { ok: false, problem: "commit-filtered" };
  const client = connect(route.diff);
  signal.addEventListener("abort", () => client.close(), { once: true });
  const listed = await client.files();
  if (!listed.ok) return listed;
  const head = await client.head();
  const key = await diffKey(head.ok ? head.headSha : "", listed.files);
  const cached = await cache.get(key);
  if (cached) return cached;
  let cutShort = false;
  const result = await readIntent(
    {
      files: () => client.files(),
      fileContent: async (path) => {
        const content = await client.fileContent(path);
        if (!content.ok && PASSING.has(content.problem)) cutShort = true;
        return content;
      },
    },
    onProgress,
  );
  if (result.ok && !cutShort) void cache.set(key, result);
  return result;
}

/**
 * Reads where the changed files land, reporting its progress through `onProgress`. Returns the
 * result itself, not a promise, when it has already landed.
 */
export type PendingIntent = (
  onProgress: (progress: IntentProgress) => void,
) => IntentResult | Promise<IntentResult>;

/**
 * Starts `read` now and lets each view that follows it share that one read: a view joining
 * mid-read starts at the latest progress, and one joining after it lands gets the result itself.
 */
export function shareIntent(read: PendingIntent): PendingIntent {
  let latest: IntentProgress | undefined;
  let result: IntentResult | undefined;
  // ponytail: a dropped view's follower stays until the visit ends, updating detached nodes;
  // unfollow on the view's signal if remounts ever pile up.
  const followers = new Set<(progress: IntentProgress) => void>();
  const landing = Promise.resolve(
    read((progress) => {
      latest = progress;
      for (const follow of followers) follow(progress);
    }),
  ).then((landed) => (result = landed));
  return (onProgress) => {
    if (result) return result;
    if (latest) onProgress(latest);
    followers.add(onProgress);
    return landing;
  };
}
