/**
 * Reports which files' diffs are on screen, below GitHub's sticky chrome, through one
 * `IntersectionObserver` over the mounted diff regions. A region holds its file's header, so a
 * collapsed, Viewed, or unloaded diff counts while its header shows.
 */

import {
  anchorOf,
  coveredTop,
  type FilesPage,
  mountedDiffs,
  observeCoveredTop,
  observeDiffs,
} from "../files-page";
import type { FileSection, LandingView } from "../visit/land";

/** Each tree file's diff anchor, mapped to its path. */
export function pathsByAnchor(sections: readonly FileSection[]): Map<string, string> {
  const paths = new Map<string, string>();
  for (const { entries } of sections)
    for (const { file } of entries) {
      const anchor = anchorOf(file.link);
      if (anchor) paths.set(anchor, file.path);
    }
  return paths;
}

/** The paths of the `onScreen` regions, through each region's anchor in `regions`. */
function pathsOf(
  onScreen: ReadonlySet<Element>,
  regions: ReadonlyMap<Element, string>,
  paths: ReadonlyMap<string, string>,
): Set<string> {
  const shown = new Set<string>();
  for (const region of onScreen) {
    const path = paths.get(regions.get(region) ?? "");
    if (path) shown.add(path);
  }
  return shown;
}

export const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Calls `show` with the paths of the files whose diffs are on screen whenever that set changes,
 * until `signal` aborts. Paths come from the files the `sections` hook lists.
 */
export function followOnScreen(
  page: FilesPage,
  show: (paths: ReadonlySet<string>) => void,
  signal: AbortSignal,
): LandingView {
  let paths = new Map<string, string>();
  let anchorsByRegion = new Map<Element, string>();
  const onScreen = new Set<Element>();
  let shown: ReadonlySet<string> = new Set();
  let top = coveredTop(page);
  let observer: IntersectionObserver | undefined;

  const showIfChanged = () => {
    const next = pathsOf(onScreen, anchorsByRegion, paths);
    if (sameSet(next, shown)) return;
    shown = next;
    show(next);
  };
  const intersect: IntersectionObserverCallback = (entries) => {
    for (const { target, isIntersecting } of entries)
      if (isIntersecting) onScreen.add(target);
      else onScreen.delete(target);
    showIfChanged();
  };
  const build = () => {
    observer?.disconnect();
    observer = new IntersectionObserver(intersect, { rootMargin: `-${top}px 0px 0px 0px` });
    for (const region of anchorsByRegion.keys()) observer.observe(region);
  };
  // Unobserves regions that left, so the observer holds no detached node, and drops them from
  // onScreen now.
  const rescan = () => {
    const mounted = new Map([...mountedDiffs(page)].map(([anchor, region]) => [region, anchor]));
    for (const region of anchorsByRegion.keys())
      if (!mounted.has(region)) {
        observer?.unobserve(region);
        onScreen.delete(region);
      }
    for (const region of mounted.keys())
      if (!anchorsByRegion.has(region)) observer?.observe(region);
    anchorsByRegion = mounted;
  };
  const followCoveredTop = () => {
    const next = coveredTop(page);
    if (next === top) return;
    top = next;
    build();
  };

  build();
  rescan();

  observeDiffs(
    page.diffs,
    () => {
      rescan();
      followCoveredTop();
      showIfChanged();
    },
    { signal },
  );
  observeCoveredTop(page.diffs.ownerDocument, followCoveredTop, { signal });
  signal.addEventListener("abort", () => observer?.disconnect());

  return {
    sections(sections) {
      paths = pathsByAnchor(sections);
      showIfChanged();
    },
  };
}
