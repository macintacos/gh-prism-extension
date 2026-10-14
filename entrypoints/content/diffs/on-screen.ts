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
function pathsByAnchor(sections: readonly FileSection[]): Map<string, string> {
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

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
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
  let regions = new Map<Element, string>();
  const onScreen = new Set<Element>();
  let shown: ReadonlySet<string> = new Set();
  let top = coveredTop(page);
  let observer: IntersectionObserver | undefined;

  const emit = () => {
    const next = pathsOf(onScreen, regions, paths);
    if (sameSet(next, shown)) return;
    shown = next;
    show(next);
  };
  const intersect: IntersectionObserverCallback = (entries) => {
    for (const { target, isIntersecting } of entries)
      if (isIntersecting) onScreen.add(target);
      else onScreen.delete(target);
    emit();
  };
  const build = () => {
    observer?.disconnect();
    observer = new IntersectionObserver(intersect, { rootMargin: `-${top}px 0px 0px 0px` });
    for (const region of regions.keys()) observer.observe(region);
  };
  // An observer never reports a removed node, so a region that left is dropped here.
  const rescan = () => {
    const next = new Map([...mountedDiffs(page)].map(([anchor, region]) => [region, anchor]));
    for (const region of regions.keys())
      if (!next.has(region)) {
        observer?.unobserve(region);
        onScreen.delete(region);
      }
    for (const region of next.keys()) if (!regions.has(region)) observer?.observe(region);
    regions = next;
  };
  const retop = () => {
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
      retop();
      emit();
    },
    { signal },
  );
  observeCoveredTop(page.diffs.ownerDocument, retop, { signal });
  signal.addEventListener("abort", () => observer?.disconnect());

  return {
    sections(sections) {
      paths = pathsByAnchor(sections);
      emit();
    },
  };
}
