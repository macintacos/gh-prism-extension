import type {
  FileLines,
  IntentProgress,
  IntentResult,
  IntentSection,
  PendingIntent,
  Placement,
} from "../../utils/intent/read";

/** A placement putting a whole file in `section`. */
export const whole = (section: IntentSection): Placement => ({ kind: "whole", section });

/** A successful intent result with `placements` and per-file `lines`, both empty by default. */
export const landedWith = (
  placements: ReadonlyMap<string, Placement> = new Map(),
  lines: ReadonlyMap<string, FileLines> = new Map(),
): IntentResult => ({ ok: true, placements, lines });

/** An intent that settles when the test resolves it, and reports progress when told to. */
export function pendingIntent() {
  const deferred = Promise.withResolvers<IntentResult>();

  let report: (progress: IntentProgress) => void = () => {
    throw new Error("the view has not asked for the intent yet");
  };
  const intent: PendingIntent = (onProgress) => {
    report = onProgress;
    return deferred.promise;
  };

  return {
    intent,
    resolve: deferred.resolve,
    progress: (progress: IntentProgress) => report(progress),
  };
}
