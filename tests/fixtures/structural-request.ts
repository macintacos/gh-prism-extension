import { DEFAULT_LIMITS, type EngineResult } from "../../utils/structural/engine";
import type { StructuralRequest } from "../../utils/structural/request";

/** A request with no grammar, so any engine that runs it answers `unsupported`. */
export const REQUEST: StructuralRequest = {
  oldText: "a",
  newText: "b",
  grammar: undefined,
  regions: [],
  limits: DEFAULT_LIMITS,
};
/** An engine's answer to `REQUEST`. */
export const RESULT: EngineResult = { ok: false, reason: "unsupported" };
/** The result a request resolves with when its engine fails. */
export const FAILED: EngineResult = { ok: false, reason: "failed" };
