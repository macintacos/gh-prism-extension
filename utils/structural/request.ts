import type { ChangedRegion, EngineLimits, EngineResult } from "./engine";
import type { Grammar } from "./grammar";

/** One file's structural diff, as plain data a message can carry. */
export interface StructuralRequest {
  readonly oldText: string;
  readonly newText: string;
  /** `undefined` when `grammarOf` found none; the engine then refuses `unsupported`. */
  readonly grammar: Grammar | undefined;
  readonly regions: readonly ChangedRegion[];
  readonly limits: EngineLimits;
}

/** Runs one request. Rejects with `signal.reason` when the signal aborts, as `structuralChanges` does. */
export type EngineRun = (request: StructuralRequest, signal: AbortSignal) => Promise<EngineResult>;
