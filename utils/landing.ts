import type { FileLines, IntentResult, IntentSection, Placement, SectionShare } from "./intent";
import type { LineCounts } from "./pr-diff";
import { classify, SECTIONS, type SectionKey } from "./sections";

/** Where a diff's files land: intent's placements, and every file's lines. Both are empty from paths alone. */
export interface Landing {
  readonly placements: ReadonlyMap<string, Placement>;
  readonly lines: ReadonlyMap<string, FileLines>;
}

/** One place a file lands: whole, or as the share of a split that lands in `section`. */
export interface LandedEntry {
  readonly section: SectionKey;
  readonly share?: SectionShare;
  /** The lines this entry adds and removes: its share's, else the file's; unknown from paths alone. */
  readonly lines: FileLines | undefined;
}

/** A non-empty section, and each of the files that land in it. */
export interface LandedSection<F> {
  readonly key: SectionKey;
  readonly label: string;
  readonly entries: readonly (LandedEntry & { readonly file: F })[];
}

/** One section's lines across the diff. */
export interface SectionLines {
  readonly section: SectionKey;
  readonly lines: LineCounts;
}

const PATH_ONLY: Landing = { placements: new Map(), lines: new Map() };

/** The landing `result` gives: its placements once it lands ok; paths alone while pending or after a failure. */
export const landingOf = (result: IntentResult | undefined): Landing =>
  result?.ok ? result : PATH_ONLY;

/** The section a file or hunk lands in: the rule section that `claimed` it, else its path section. */
export const sectionOf = (path: string, claimed?: IntentSection): SectionKey =>
  claimed ?? classify(path);

/** Where `path` lands: once whole, or once per share of a split. */
function entriesOf({ placements, lines }: Landing, path: string): LandedEntry[] {
  const placement = placements.get(path);
  if (placement?.kind === "split")
    return placement.shares.map((share) => ({ section: share.section, share, lines: share.lines }));
  return [{ section: sectionOf(path, placement?.section), lines: lines.get(path) }];
}

/** Non-empty sections in `SECTIONS` order, each listing the `files` that land there in `files`' order. */
export function sectionsOf<F extends { readonly path: string }>(
  landing: Landing,
  files: readonly F[],
): LandedSection<F>[] {
  const entries = files.flatMap((file) =>
    entriesOf(landing, file.path).map((entry) => ({ ...entry, file })),
  );
  const bySection = Map.groupBy(entries, ({ section }) => section);
  return SECTIONS.flatMap(({ key, label }) => {
    const landed = bySection.get(key);
    return landed ? [{ key, label, entries: landed }] : [];
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

/** Each section's lines across the whole diff, in `SECTIONS` order, for sections that changed any. A binary file counts in none. */
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

/** The head-file line of the first hunk `path` places in `section`, if a share there has one. */
export function revealLineOf(landing: Landing, path: string, section: string): number | undefined {
  return entriesOf(landing, path)
    .find((entry) => entry.section === section)
    ?.share?.hunks.find((span) => span !== undefined)?.first;
}
