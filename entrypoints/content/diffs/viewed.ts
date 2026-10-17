/**
 * Reports which files the reviewer has marked Viewed. A visit starts from the full load's route
 * data when that is fresh, then reads each header's toggle as its diff mounts and as GitHub flips
 * it. A file keeps its last-read state after its diff unmounts, until the visit ends.
 */

import type { ViewedSeed } from "@/utils/github/pr-ref";
import {
  anchorOfDigest,
  type FilesPage,
  observeDiffs,
  observeViewed,
  readViewed,
  viewedOffered,
} from "../files-page";
import type { LandingView } from "../visit/land";
import { pathsByAnchor, sameSet } from "./on-screen";

/**
 * One visit's Viewed state: whether the page offers Viewed, and each file's state as last read, by
 * diff anchor. Shared by the visit's pages; dropped with the visit.
 */
export interface VisitViewed {
  offered: boolean;
  readonly byAnchor: Map<string, boolean>;
}

/** A visit's Viewed state, seeded from `seed` when route data was fresh. */
export function visitViewed(seed: ViewedSeed | undefined): VisitViewed {
  return {
    offered: seed?.offered ?? false,
    byAnchor: new Map([...(seed?.viewed ?? [])].map(([digest, v]) => [anchorOfDigest(digest), v])),
  };
}

/** The paths of the files `byAnchor` marks viewed, through each file's anchor in `paths`. */
function viewedPaths(
  byAnchor: ReadonlyMap<string, boolean>,
  paths: ReadonlyMap<string, string>,
): Set<string> {
  const viewed = new Set<string>();
  for (const [anchor, path] of paths) if (byAnchor.get(anchor)) viewed.add(path);
  return viewed;
}

/**
 * Calls `show` with the paths of the viewed files whenever that set changes, while the page offers
 * Viewed, until `signal` aborts. Paths come from the files the `sections` hook lists.
 */
export function followViewed(
  page: FilesPage,
  viewed: VisitViewed,
  show: (paths: ReadonlySet<string>) => void,
  signal: AbortSignal,
): LandingView {
  let paths = new Map<string, string>();
  let shown: ReadonlySet<string> = new Set();

  const showIfChanged = () => {
    const next = viewed.offered ? viewedPaths(viewed.byAnchor, paths) : new Set<string>();
    if (sameSet(next, shown)) return;
    shown = next;
    show(next);
  };
  const read = () => {
    viewed.offered ||= viewedOffered(page);
    for (const [anchor, pressed] of readViewed(page)) viewed.byAnchor.set(anchor, pressed);
    showIfChanged();
  };

  read();
  observeDiffs(page.diffs, read, { signal });
  observeViewed(page.diffs, read, { signal });

  return {
    sections(sections) {
      paths = pathsByAnchor(sections);
      showIfChanged();
    },
  };
}
