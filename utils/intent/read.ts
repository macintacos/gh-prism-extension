import type { FilesRoute } from "../github/files-route";
import {
  type HeadLineSpan,
  hunkHeadSpan,
  hunkLineCounts,
  type LineCounts,
  type PrFileDiff,
  type PrHunk,
  parsePrHunks,
} from "../github/pr-diff";
import type { PrDataClient } from "../github/pr-port";
import type { DiffPin, DiffRef } from "../github/pr-ref";
import type { PrDataProblem, PrFilesResult } from "../github/pr-source";
import { commentLineCounts, type DocVerdict, docHunkVerdicts } from "../hunk-rules/doc-intent";
import { type ScannedHead, scanHeadText } from "../hunk-rules/head-scan";
import { inlineTestHunkVerdicts, inlineTestRuleApplies } from "../hunk-rules/inline-tests";
import { classify, SECTIONS, type SectionKey } from "../sections";
import type { IntentCache, LandedIntent } from "./cache";
import { sectionOf, sum } from "./landing";

/**
 * The most files `readIntent` places at once, and so the most heads it reads at once. Over
 * HTTP/2 the browser sets no limit of its own; more than six invites GitHub's rate limiting.
 */
export const HEAD_READS_AT_ONCE = 6;

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
      /**
       * Keyed by path: the changed comment and docstring lines in the file's hunks that stay in
       * Implementation. A file with none is absent.
       */
      commentLines: ReadonlyMap<string, LineCounts>;
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

const sumHunkLines = (hunks: readonly PrHunk[]): LineCounts => sum(hunks.map(hunkLineCounts));

/** One file's hunk sections, and the comment lines in its hunks that stay in Implementation. */
interface FileIntent {
  /**
   * Each hunk's rule section, or `undefined` to keep it in the path section; aligned with
   * `parsePrHunks`.
   */
  readonly sections: (IntentSection | undefined)[];
  readonly commentLines: LineCounts;
}

/**
 * `file`'s hunk sections and Implementation comment lines. The head is read only when the patch
 * can't settle every hunk as docs and a rule or a comment count needs it. A file whose every hunk
 * is docs moves whole to Docs & Comments; otherwise a hunk in a test block counts as Tests even
 * when it only edits a doc comment, and an Implementation file that keeps a code hunk outside its
 * test blocks keeps its other docs hunks too, counting their comment lines. A head read for any reason settles every unclaimed hunk's count, as it is
 * the more accurate scan; a hunk whose comment lines only the unread head could confirm counts
 * none.
 */
async function fileIntent(
  client: Pick<PrDataClient, "fileContent">,
  file: PrFileDiff,
): Promise<FileIntent> {
  const noLines = { added: 0, removed: 0 };
  const patchVerdicts = docHunkVerdicts(file);
  // also [] for binary or renamed
  if (patchVerdicts.every(isDocs))
    return { sections: patchVerdicts.map(() => "docs"), commentLines: noLines };

  const hunks = hunksOf(file);
  const countsComments = classify(file.path) === "implementation";
  const patchCounts = countsComments ? hunks.map((hunk) => commentLineCounts(file.path, hunk)) : [];
  const needsHead =
    inlineTestRuleApplies(file) ||
    patchVerdicts.includes("needs-content") ||
    patchCounts.includes("needs-content");
  const head = needsHead ? await readHead(client, file) : undefined;

  const sections =
    head === undefined ? patchSections(file.path, patchVerdicts) : headSections(file, head);
  if (!countsComments) return { sections, commentLines: noLines };
  const counts = hunks.map((hunk, i) => {
    if (sections[i] !== undefined) return noLines;
    if (head !== undefined) return commentLineCounts(file.path, hunk, head);
    const count = patchCounts[i];
    return count === undefined || count === "needs-content" ? noLines : count;
  });
  return { sections, commentLines: sum(counts) };
}

/** Where a docs hunk goes in a file that doesn't move whole: an Implementation file keeps it. */
const docsHunkSection = (path: string): IntentSection | undefined =>
  classify(path) === "implementation" ? undefined : "docs";

const patchSections = (path: string, verdicts: readonly DocVerdict[]) =>
  verdicts.map((verdict) => (isDocs(verdict) ? docsHunkSection(path) : undefined));

function headSections(file: PrFileDiff, head: ScannedHead): (IntentSection | undefined)[] {
  const headVerdicts = docHunkVerdicts(file, head);
  if (headVerdicts.every(isDocs)) return headVerdicts.map(() => "docs");
  const inTests = inlineTestHunkVerdicts(file, head);
  const keepsCode = headVerdicts.some((verdict, i) => !inTests[i] && !isDocs(verdict));
  const docsSection = keepsCode ? docsHunkSection(file.path) : "docs";
  return headVerdicts.map((verdict, i) =>
    inTests[i] ? "tests" : isDocs(verdict) ? docsSection : undefined,
  );
}

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
      shares: SECTIONS.flatMap((key) => {
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

/** Maps `items` through `fn` with at most `limit` calls pending at once, keeping input order. */
async function mapAtMost<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // Every worker pulls from this one iterator, so each item is taken exactly once.
  const queue = items.entries();
  const worker = async () => {
    for (const [i, item] of queue) results[i] = await fn(item);
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

/**
 * Reads the PR's files and places each one's hunks. A file whose head can't be read keeps the hunks
 * its patch settles, and the rest stay in its path section; only a `files()` failure makes the
 * result not ok. `onProgress` reports once after `files()` succeeds, then once per file as it is
 * placed. At most `HEAD_READS_AT_ONCE` files are placed at once.
 */
export async function readIntent(
  client: Pick<PrDataClient, "fileContent"> & { files(): Promise<PrFilesResult> },
  onProgress?: (progress: IntentProgress) => void,
): Promise<IntentResult> {
  const listed = await client.files();
  if (!listed.ok) return listed;

  const total = listed.files.length;
  onProgress?.({ checked: 0, total });
  let checked = 0;
  const placed = await mapAtMost(listed.files, HEAD_READS_AT_ONCE, async (file) => {
    const { sections, commentLines } = await fileIntent(client, file);
    checked += 1;
    onProgress?.({ checked, total });
    return { path: file.path, placement: placementOf(file, sections), commentLines };
  });

  const placements = new Map<string, Placement>();
  const commentLines = new Map<string, LineCounts>();
  for (const { path, placement, commentLines: counts } of placed) {
    if (placement !== undefined) placements.set(path, placement);
    if (counts.added + counts.removed > 0) commentLines.set(path, counts);
  }

  const lines = new Map<string, FileLines>();
  for (const file of listed.files) lines.set(file.path, linesOf(file));
  return { ok: true, placements, lines, commentLines };
}

/** Where `intentFor` reads a diff, and where it keeps what it read. */
export interface IntentSources {
  readonly connect: (diff: DiffRef) => PrDataClient;
  readonly cache: IntentCache;
  /**
   * What the page says pins `diff`: a revisit with the same pin lands from `cache` without reading
   * the diff.
   */
  readonly pinOf?: (diff: DiffRef) => DiffPin | undefined;
}

/** Problems a later read of a file may not hit. */
const PASSING: ReadonlySet<PrDataProblem> = new Set(["rate-limited", "failed"]);

/** A key for `files` read at `headSha`: a diff whose head or patches change gets a new one. */
async function diffKey(headSha: string, files: readonly PrFileDiff[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([headSha, files]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pinKey = ({ baseSha, headSha }: DiffPin) => `${baseSha}...${headSha}`;

/** Files `intent` under each key in turn: concurrent sets race on the cache's index. */
async function keepUnder(
  cache: IntentCache,
  intent: LandedIntent,
  keys: readonly (string | undefined)[],
): Promise<void> {
  for (const key of keys) if (key) await cache.set(key, intent);
}

/**
 * Where one Files view's files land: from `cache` when it holds this very diff, else read and
 * cached. The cache is checked by the page's pin first, and a pinned hit connects nothing. A read
 * that a file's passing problem cut short isn't cached. A commit-filtered route connects nothing;
 * otherwise the client is closed when `signal` aborts. Never rejects; once `signal` aborts it may
 * never settle.
 */
export async function intentFor(
  route: FilesRoute,
  signal: AbortSignal,
  { connect, cache, pinOf }: IntentSources,
  onProgress?: (progress: IntentProgress) => void,
): Promise<IntentResult> {
  if (route.commitFiltered) return { ok: false, problem: "commit-filtered" };

  const pin = pinOf?.(route.diff);
  const pinned = pin && pinKey(pin);
  const early = pinned ? await cache.get(pinned) : undefined;
  if (early) return early;

  const client = connect(route.diff);
  // An already-aborted signal never fires "abort": the pinned lookup outlasted the visit.
  if (signal.aborted) client.close();
  else signal.addEventListener("abort", () => client.close(), { once: true });

  const listed = await client.files();
  if (!listed.ok) return listed;

  const key = await diffKey(listed.headSha, listed.files);
  // Only a pin naming the head these files were read at may file them.
  // ponytail: the worker keeps a PR's diff by head alone, so a retarget read while it is alive
  // files the old base's diff under the new pin; key the worker's diff by base too if that bites.
  const pinnedHere = pin?.headSha === listed.headSha ? pinned : undefined;
  const cached = await cache.get(key);
  if (cached) {
    void keepUnder(cache, cached, [pinnedHere]);
    return cached;
  }

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

  // ponytail: a pinned diff is stored under both keys, doubling its slots and bytes; file the pin
  // as an alias of the diff key if the cache fills.
  if (result.ok && !cutShort) void keepUnder(cache, result, [key, pinnedHere]);
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
