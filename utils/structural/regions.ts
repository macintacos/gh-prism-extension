// Background side: import the engine and runner only as types; a value import bundles them into background.js.
import { hunkOps, type PrHunk } from "../github/pr-diff";
import { linesBefore } from "./base-text";
import type { ChangedRegion } from "./engine";

/**
 * The changed runs of `hunks`, one per maximal run of `+` and `-` lines, in order. `undefined`
 * when a hunk's body cannot be read.
 */
export function changedRegions(hunks: readonly PrHunk[]): ChangedRegion[] | undefined {
  const regions: ChangedRegion[] = [];
  for (const hunk of hunks) {
    const ops = hunkOps(hunk.lines);
    if (ops === undefined) return undefined;

    let oldLine = linesBefore(hunk.oldStart, hunk.oldCount) + 1;
    let newLine = linesBefore(hunk.newStart, hunk.newCount) + 1;
    let openRegion: { -readonly [K in keyof ChangedRegion]: number } | undefined;
    for (const { kind } of ops) {
      if (kind === " ") {
        openRegion = undefined;
        oldLine++;
        newLine++;
        continue;
      }

      if (!openRegion) {
        openRegion = { oldStart: oldLine, oldEnd: oldLine, newStart: newLine, newEnd: newLine };
        regions.push(openRegion);
      }
      if (kind === "-") oldLine++;
      else newLine++;
      openRegion.oldEnd = oldLine;
      openRegion.newEnd = newLine;
    }
  }
  return regions;
}
