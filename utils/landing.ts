import type { FileLines, IntentResult, IntentSection, SectionShare } from "./intent";
import type { LineCounts } from "./pr-diff";
import { classify, SECTIONS, type SectionKey } from "./sections";

/**
 * Where a diff's files land, read through this module's functions: `placements` is sparse, and a
 * file absent from it keeps its path section. Both maps are empty when path-only.
 */
export type Landing = Readonly<Pick<Extract<IntentResult, { ok: true }>, "placements" | "lines">>;

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

const PATH_ONLY: Landing = { placements: new Map(), lines: new Map() };

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

/** Where `path` lands: once whole, or once per share of a split. */
function entriesOf({ placements, lines }: Landing, path: string): LandedEntry[] {
  const placement = placements.get(path);
  if (placement?.kind === "split")
    return placement.shares.map((share) => ({ section: share.section, share, lines: share.lines }));
  return [{ section: sectionOf(path, placement?.section), lines: lines.get(path) }];
}

/**
 * Non-empty sections in `SECTIONS` order, each listing the `files` that land there in `files`'
 * order.
 */
export function sectionsOf<F extends { readonly path: string }>(
  landing: Landing,
  files: readonly F[],
): LandedSection<F>[] {
  const entries = files.flatMap((file) =>
    entriesOf(landing, file.path).map((entry) => ({ ...entry, file })),
  );
  const bySection = Map.groupBy(entries, ({ section }) => section);
  return SECTIONS.flatMap(({ key }) => {
    const landed = bySection.get(key);
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
      lines === undefined || lines === "binary" ? [] : [{ section, lines }],
    ),
  );
  const bySection = Map.groupBy(counted, ({ section }) => section);
  return SECTIONS.flatMap(({ key }) => {
    const total = sum((bySection.get(key) ?? []).map(({ lines }) => lines));
    return total.added + total.removed > 0 ? [{ section: key, lines: total }] : [];
  });
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
