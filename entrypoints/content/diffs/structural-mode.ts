import { currentLayout, type FilesPage, observeDiffs, showsUnified } from "../files-page";
import type { FileSection, LandingView } from "../visit/land";
import { paintStructural } from "./structural";
import type { StructuralFiles } from "./structural-files";
import { noticeOf, showStructuralNotices } from "./structural-notices";

/** What a visit gives each of its pages to show Structural mode. */
export interface StructuralMode {
  readonly files: StructuralFiles;
  /** Aborts when the visit ends or the mode turns off. */
  readonly until: AbortSignal;
  /** Whether the visit is a commit's page, where three columns always mean Unified. */
  readonly commit: boolean;
  /** The page's current `location.search`. */
  readonly search: () => string;
  /** Called once when GitHub's Unified layout is seen; must turn the mode off, aborting `until`. */
  readonly unifiedSeen: () => void;
}

/** Whether Structural mode is on, shared by every visit. */
export interface StructuralChoice {
  readonly on: boolean;
  /** Aborts when the mode next turns off; a new signal each time it turns on. */
  readonly whileOn: AbortSignal;
  /** Sets and saves the mode; turning it off aborts `whileOn`. */
  set(on: boolean): void;
}

/** A Structural choice starting at `on`, saving each change through `save`. */
export function structuralChoiceOf(on: boolean, save: (on: boolean) => void): StructuralChoice {
  let current = on ? new AbortController() : undefined;
  let whileOn = current?.signal ?? AbortSignal.abort();
  return {
    get on() {
      return current !== undefined;
    },
    get whileOn() {
      return whileOn;
    },
    set(next) {
      if (next && !current) {
        current = new AbortController();
        whileOn = current.signal;
      } else if (!next) {
        current?.abort();
        current = undefined;
      }
      save(next);
    },
  };
}

/** Structural mode's view on a page, plus the tap `showVisit` feeds the on-screen paths into. */
export type StructuralView = LandingView & { onScreen(paths: ReadonlySet<string>): void };

/**
 * Shows Structural mode on `page` until `signal` or `mode.until` aborts: requests the on-screen
 * files while the diffs read Split, paints each answer as it settles, and shows each file's notice
 * or held-back loading line beside its diff. Mounts nothing when the page already shows Unified or
 * either signal has already aborted, and tells `mode.unifiedSeen` once Unified is seen.
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

  const notices = showStructuralNotices(page.diffs, live, (path) =>
    mode.files.pending(path)
      ? "pending"
      : noticeOf(mode.files.answerOf(path), mode.files.outcomeOf(path)),
  );
  const painter = paintStructural(page.diffs, live, {
    annotationsOf: (path) => {
      const answer = mode.files.answerOf(path);
      return answer?.ok ? answer.file : undefined;
    },
    // Nothing else announces an outcome change to the notices.
    report: (path, outcome) => {
      mode.files.report(path, outcome);
      notices.refresh();
    },
  });

  let onScreen: ReadonlySet<string> = new Set();
  let lastSections: [readonly FileSection[], ReadonlySet<string>] | undefined;
  // ponytail: every path that crosses the screen is asked once, never narrowed to painted (Split,
  // text) files nor cancelled when it leaves; drop or deprioritise off-screen requests if a fast
  // scroll through a large pull request backs up the background's gate.
  const requestIfSplit = () => {
    if (currentLayout(page.diffs) !== "split") return;
    mode.files.request(onScreen);
    notices.refresh();
  };

  observeDiffs(page.diffs, () => (unified() ? mode.unifiedSeen() : requestIfSplit()), {
    signal: live,
  });
  // The painter repaints only when told; a settled answer tells it through this re-call.
  mode.files.onAnswer(() => {
    if (lastSections) painter.sections?.(...lastSections);
    notices.refresh();
  }, live);

  return {
    onScreen(paths) {
      onScreen = paths;
      if (!live.aborted) requestIfSplit();
    },
    sections(...args) {
      lastSections = args;
      painter.sections?.(...args);
      notices.sections?.(...args);
    },
  };
}
