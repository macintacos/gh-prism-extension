/** Keeps landed intent in extension storage, so a revisit to an unchanged diff skips reading it. */

import type { HeadLineSpan } from "@/utils/pr-diff";
import { SECTIONS } from "@/utils/sections";
import type { FileLines, IntentResult, Placement, SectionShare } from "./intent";

export type LandedIntent = Extract<IntentResult, { ok: true }>;

/** Landed intent by a key naming the diff it was read from. Never rejects: a storage failure is a miss. */
export interface IntentCache {
  get(key: string): Promise<LandedIntent | undefined>;
  set(key: string, intent: LandedIntent): Promise<void>;
}

type LocalKey = `local:${string}`;

/** The slice of WXT's `storage` the cache uses. */
export interface IntentStorage {
  getItem(key: LocalKey): Promise<unknown>;
  setItem(key: LocalKey, value: unknown): Promise<void>;
  removeItems(keys: LocalKey[]): Promise<void>;
}

/** JSON has no `undefined` or `Map`, and chrome.storage keeps values as JSON. */
interface StoredIntent {
  readonly placements: readonly (readonly [string, StoredPlacement])[];
  readonly lines: readonly (readonly [string, FileLines])[];
}

type StoredShare = Omit<SectionShare, "hunks"> & { readonly hunks: (HeadLineSpan | null)[] };

type StoredPlacement =
  | Exclude<Placement, { kind: "split" }>
  | { readonly kind: "split"; readonly shares: readonly StoredShare[] };

// The entries' shape is versioned in their keys; a new shape takes a new prefix.
const INDEX: LocalKey = "local:intent.v1";
const entryKey = (key: string): LocalKey => `local:intent.v1:${key}`;

const toStored = ({ placements, lines }: LandedIntent): StoredIntent => ({
  placements: [...placements].map(([path, placement]) => [
    path,
    placement.kind === "split"
      ? {
          ...placement,
          shares: placement.shares.map((share) => ({
            ...share,
            hunks: share.hunks.map((span) => span ?? null),
          })),
        }
      : placement,
  ]),
  lines: [...lines],
});

const fromStored = ({ placements, lines }: StoredIntent): LandedIntent => ({
  ok: true,
  placements: new Map(
    placements.map(([path, placement]) => [
      path,
      placement.kind === "split"
        ? {
            ...placement,
            shares: placement.shares.map((share) => ({
              ...share,
              hunks: share.hunks.map((span) => span ?? undefined),
            })),
          }
        : placement,
    ]),
  ),
  lines: new Map(lines),
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isEntry = (value: unknown): value is [string, unknown] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === "string";

const isSection = (value: unknown) => SECTIONS.some(({ key }) => key === value);

const isCounts = (value: unknown) =>
  isObject(value) && typeof value.added === "number" && typeof value.removed === "number";

const isSpan = (value: unknown) =>
  value === null ||
  (isObject(value) && typeof value.first === "number" && typeof value.last === "number");

const isShare = (value: unknown) =>
  isObject(value) &&
  isSection(value.section) &&
  Array.isArray(value.hunks) &&
  value.hunks.every(isSpan) &&
  isCounts(value.lines);

const isPlacement = (value: unknown) =>
  isObject(value) &&
  (value.kind === "whole"
    ? isSection(value.section)
    : value.kind === "split" && Array.isArray(value.shares) && value.shares.every(isShare));

const isStored = (value: unknown): value is StoredIntent =>
  isObject(value) &&
  Array.isArray(value.placements) &&
  value.placements.every((entry) => isEntry(entry) && isPlacement(entry[1])) &&
  Array.isArray(value.lines) &&
  value.lines.every((entry) => isEntry(entry) && (entry[1] === "binary" || isCounts(entry[1])));

const isKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === "string");

/** An {@link IntentCache} in `storage` that keeps the `limit` most recently stored results. */
export function storedIntents(storage: IntentStorage, limit: number): IntentCache {
  return {
    async get(key) {
      try {
        const stored = await storage.getItem(entryKey(key));
        return isStored(stored) ? fromStored(stored) : undefined;
      } catch (error) {
        console.error("gh-prism: reading cached sections failed", error);
        return undefined;
      }
    },
    async set(key, intent) {
      try {
        const index = await storage.getItem(INDEX);
        // ponytail: two tabs storing at once can each drop the other's key, orphaning an entry the
        // limit never evicts; store the index per entry if storage ever fills.
        const kept = [key, ...(isKeys(index) ? index.filter((other) => other !== key) : [])];
        await storage.setItem(entryKey(key), toStored(intent));
        await storage.setItem(INDEX, kept.slice(0, limit));
        await storage.removeItems(kept.slice(limit).map(entryKey));
      } catch (error) {
        console.error("gh-prism: caching sections failed", error);
      }
    },
  };
}

/**
 * Drops every result {@link storedIntents} keeps in `storage`, as another build may place files
 * differently. Never rejects: a storage failure is logged.
 */
export async function forgetIntents(storage: IntentStorage): Promise<void> {
  try {
    const index = await storage.getItem(INDEX);
    await storage.removeItems([INDEX, ...(isKeys(index) ? index.map(entryKey) : [])]);
  } catch (error) {
    console.error("gh-prism: clearing cached sections failed", error);
  }
}
