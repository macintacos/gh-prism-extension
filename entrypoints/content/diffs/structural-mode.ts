import { currentLayout, type FilesPage, observeDiffs, showsUnified } from "../files-page";
import type { FileSection, LandingView } from "../visit/land";
import { paintStructural } from "./structural";
import type { StructuralFiles } from "./structural-files";

/** What a visit gives each of its pages to show Structural mode. */
export interface StructuralMode {
  readonly files: StructuralFiles;
  /** Aborts when the visit ends or the mode turns off. */
  readonly until: AbortSignal;
  readonly commit: boolean;
  /** The page's current `location.search`. */
  readonly search: () => string;
  /** Called once when GitHub's Unified layout is seen. */
  readonly unifiedSeen: () => void;
}

/** The painter's view, plus the tap `showVisit` feeds the on-screen paths into. */
export type StructuralView = LandingView & { onScreen(paths: ReadonlySet<string>): void };

/**
 * Shows Structural mode on `page` until `signal` or `mode.until` aborts: requests the on-screen
 * files while the diffs read Split, and paints each answer as it settles. Mounts nothing when the
 * page already shows Unified, and tells `mode.unifiedSeen` once Unified is seen.
 */
export function showStructural(
  page: Pick<FilesPage, "diffs">,
  signal: AbortSignal,
  mode: StructuralMode,
): StructuralView {
  const live = AbortSignal.any([signal, mode.until]);
  const unified = () => showsUnified(page.diffs, { commit: mode.commit, search: mode.search() });
  if (live.aborted) return { onScreen: () => {} };
  if (unified()) {
    mode.unifiedSeen();
    return { onScreen: () => {} };
  }

  const painter = paintStructural(page.diffs, live, {
    annotationsOf: (path) => {
      const answer = mode.files.answerOf(path);
      return answer?.ok ? answer.file : undefined;
    },
    report: mode.files.report,
  });
  let onScreen: ReadonlySet<string> = new Set();
  let lastSections: [readonly FileSection[], ReadonlySet<string>] | undefined;
  const requestIfSplit = () => {
    if (currentLayout(page.diffs) === "split") mode.files.request(onScreen);
  };

  let seen = false;
  observeDiffs(
    page.diffs,
    () => {
      if (seen) return;
      if (unified()) {
        seen = true;
        mode.unifiedSeen();
      } else requestIfSplit();
    },
    { signal: live },
  );

  return {
    onScreen(paths) {
      onScreen = paths;
      if (!live.aborted) requestIfSplit();
    },
    sections(...args) {
      // The painter repaints only when told; a settled answer tells it through this re-call.
      if (!lastSections)
        mode.files.onAnswer(() => lastSections && painter.sections?.(...lastSections), live);
      lastSections = args;
      painter.sections?.(...args);
    },
  };
}
