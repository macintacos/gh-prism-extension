import type { LineCounts } from "../github/pr-diff";
import { classify, SECTIONS, type SectionKey } from "../sections";
import type { FileLines, IntentResult, IntentSection, SectionShare } from "./read";

/**
 * Where a diff's files land, read through this module's functions: `placements` is sparse, and a
 * file absent from it keeps its path section. Every map is empty when path-only.
 */
export type Landing = Readonly<
  Pick<Extract<IntentResult, { ok: true }>, "placements" | "lines" | "commentLines">
>;

/** One place a file lands: whole, or as the share of a split that lands in `section`. */
export interface LandedEntry {
  readonly section: SectionKey;
  readonly share?: SectionShare;
  /**
   * The lines this entry adds and removes: its share's, else the file's; `undefined` when unknown.
   */
  readonly lines: FileLines | undefined;
}

/** A non-empty section, and each of the files that land in it. */
export interface LandedSection<F> {
  readonly key: SectionKey;
  readonly entries: readonly (LandedEntry & { readonly file: F })[];
}

/** One section's lines across the diff. */
export interface SectionLines {
  readonly section: SectionKey;
  readonly lines: LineCounts;
}

const PATH_ONLY: Landing = {
  placements: new Map(),
  lines: new Map(),
  commentLines: new Map(),
};

/**
 * `result`'s placements and lines once it lands ok; path-only while pending or when it isn't ok.
 */
export const landingOf = (result: IntentResult | undefined): Landing =>
  result?.ok ? result : PATH_ONLY;

/**
 * The section a file or hunk lands in: the rule section that `claimed` it, else its path section.
 */
export const sectionOf = (path: string, claimed?: IntentSection): SectionKey =>
  claimed ?? classify(path);

/**
 * Where `path` lands: once whole, or once per share of a split. Its Implementation entry leaves
 * out its comment lines, which count toward Docs & Comments.
 */
function entriesOf({ placements, lines, commentLines }: Landing, path: string): LandedEntry[] {
  const placement = placements.get(path);
  const entries: LandedEntry[] =
    placement?.kind === "split"
      ? placement.shares.map((share) => ({ section: share.section, share, lines: share.lines }))
      : [{ section: sectionOf(path, placement?.section), lines: lines.get(path) }];
  const comments = commentLines.get(path);
  return entries.map((entry) =>
    comments && entry.section === "implementation" && isCounted(entry.lines)
      ? { ...entry, lines: minus(entry.lines, comments) }
      : entry,
  );
}

const isCounted = (lines: FileLines | undefined): lines is LineCounts =>
  lines !== undefined && lines !== "binary";

const minus = (lines: LineCounts, less: LineCounts): LineCounts => ({
  added: lines.added - less.added,
  removed: lines.removed - less.removed,
});

/**
 * Non-empty sections in `SECTIONS` order, each listing the `files` that land there in `files`'
 * order. Docs & Comments is non-empty with comment lines alone, even when no file lands there.
 */
export function sectionsOf<F extends { readonly path: string }>(
  landing: Landing,
  files: readonly F[],
): LandedSection<F>[] {
  const entries = files.flatMap((file) =>
    entriesOf(landing, file.path).map((entry) => ({ ...entry, file })),
  );
  const bySection = Map.groupBy(entries, ({ section }) => section);
  return SECTIONS.flatMap((key) => {
    const landed =
      bySection.get(key) ?? (key === "docs" && landing.commentLines.size > 0 ? [] : undefined);
    return landed ? [{ key, entries: landed }] : [];
  });
}

const sum = (counts: readonly LineCounts[]): LineCounts =>
  counts.reduce(
    (total, { added, removed }) => ({
      added: total.added + added,
      removed: total.removed + removed,
    }),
    { added: 0, removed: 0 },
  );

/**
 * Each section's lines across the whole diff, in `SECTIONS` order, for sections that changed any. A
 * binary file counts in none.
 */
export function totalsOf(landing: Landing): SectionLines[] {
  const counted = [...landing.lines.keys()].flatMap((path) =>
    entriesOf(landing, path).flatMap(({ section, lines }) =>
      isCounted(lines) ? [{ section, lines }] : [],
    ),
  );
  const comments = [...landing.commentLines.values()].map((lines) => ({
    section: "docs" as const,
    lines,
  }));
  const bySection = Map.groupBy([...counted, ...comments], ({ section }) => section);
  return SECTIONS.flatMap((key) => {
    const total = sum((bySection.get(key) ?? []).map(({ lines }) => lines));
    return total.added + total.removed > 0 ? [{ section: key, lines: total }] : [];
  });
}

/** The comment lines of the diff's Implementation files, and their sum. */
export interface CommentLines {
  readonly lines: LineCounts;
  /** In diff order. */
  readonly files: readonly { readonly path: string; readonly lines: LineCounts }[];
}

/** `landing`'s comment lines; `undefined` when it has none. */
export function commentLinesOf(landing: Landing): CommentLines | undefined {
  const files = [...landing.lines.keys()].flatMap((path) => {
    const lines = landing.commentLines.get(path);
    return lines ? [{ path, lines }] : [];
  });
  return files.length > 0 ? { lines: sum(files.map(({ lines }) => lines)), files } : undefined;
}

/**
 * The first head-file line among `path`'s hunks placed in `section`; `undefined` unless a share
 * there has one.
 */
export function revealLineOf(
  landing: Landing,
  path: string,
  section: SectionKey,
): number | undefined {
  return entriesOf(landing, path)
    .find((entry) => entry.section === section)
    ?.share?.hunks.find((span) => span !== undefined)?.first;
}
