/**
 * Reports which files the reviewer has marked Viewed. A visit starts from the full load's route
 * data when that is fresh, then reads each header's toggle as its diff mounts and as GitHub flips
 * it. A file keeps its last-read state after its diff unmounts, until the visit ends. Also marks a
 * file Viewed, through GitHub's own toggle.
 */

import type { ViewedSeed } from "@/utils/github/pr-ref";
import {
  anchorOfDigest,
  type FilesPage,
  observeDiffs,
  observeViewed,
  readViewed,
  showsViewed,
  viewedOffered,
  viewedToggleOf,
} from "../files-page";
import type { LandingView } from "../visit/land";
import { pathsByAnchor, sameSet } from "./on-screen";
import { untilFound } from "./reveal";

/**
 * One visit's Viewed state: whether the page offers Viewed, and each file's state as last read, by
 * diff anchor. Shared by the visit's pages; dropped with the visit.
 */
export interface VisitViewed {
  /** Once true, true for the rest of the visit. */
  offered: boolean;
  /** Reads overwrite a file's state; a diff unmounting never clears it. */
  readonly byAnchor: Map<string, boolean>;
}

/** A visit's Viewed state, seeded from `seed` when route data was fresh. */
export function visitViewed(seed: ViewedSeed | undefined): VisitViewed {
  return {
    offered: seed?.offered ?? false,
    byAnchor: new Map(
      [...(seed?.viewed ?? [])].map(([digest, marked]) => [anchorOfDigest(digest), marked]),
    ),
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
 * Calls `show` with the paths of the viewed files once the page offers Viewed, then whenever that
 * set changes, until `signal` aborts; never while the page offers no Viewed. Paths come from the files the `sections` hook lists. Records each
 * read into `viewed`: Viewed stays offered once a read finds it, and each mounted header
 * overwrites its file's state.
 */
export function followViewed(
  page: FilesPage,
  viewed: VisitViewed,
  show: (paths: ReadonlySet<string>) => void,
  signal: AbortSignal,
): LandingView {
  let paths = new Map<string, string>();
  let shown: ReadonlySet<string> | undefined;

  const showIfChanged = () => {
    if (!viewed.offered) return;
    const next = viewedPaths(viewed.byAnchor, paths);
    if (shown && sameSet(next, shown)) return;
    shown = next;
    show(next);
  };
  const read = () => {
    viewed.offered ||= viewedOffered(page);
    if (!viewed.offered) return;
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

/**
 * Has GitHub show `link`'s file as `viewed` by clicking its header's toggle, unless the toggle
 * already shows that. Resolves once the toggle shows `viewed`, at `REVEAL_TIMEOUT_MS`, or once
 * `signal` aborts. Never rejects, and clicks at most once: GitHub honors a second click during a
 * pending save and toggles back.
 */
export async function markViewed(
  page: FilesPage,
  link: HTMLAnchorElement,
  viewed: boolean,
  { signal }: { signal: AbortSignal },
): Promise<void> {
  // Re-found each check: GitHub may replace the header rather than flip its toggle.
  const shows = () => {
    const toggle = viewedToggleOf(page, link);
    return toggle && showsViewed(toggle) === viewed ? toggle : null;
  };
  const observe: typeof observeDiffs = (diffs, onChange, options) => {
    observeDiffs(diffs, onChange, options);
    observeViewed(diffs, onChange, options);
  };

  if (signal.aborted || shows()) return;
  viewedToggleOf(page, link)?.click();
  await untilFound(page.diffs, shows, { signal, observe });
}
