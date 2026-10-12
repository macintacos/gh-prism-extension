import type {
  FileLines,
  IntentProgress,
  IntentResult,
  IntentSection,
  PendingIntent,
  Placement,
} from "../../utils/intent";

export const whole = (section: IntentSection): Placement => ({ kind: "whole", section });

export const landedWith = (
  placements: ReadonlyMap<string, Placement> = new Map(),
  lines: ReadonlyMap<string, FileLines> = new Map(),
): IntentResult => ({ ok: true, placements, lines });

export /** An intent that settles when the test resolves it, and reports progress when told to. */
function pendingIntent() {
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
