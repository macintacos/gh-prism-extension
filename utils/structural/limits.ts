// Imported by the background as a value: import the engine only as a type, or it bundles into background.js.
import type { EngineLimits } from "./engine";

/** The limits the background sends with every request; a sender never supplies its own. */
export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** Firefox parses a token-dense 150,000-unit Python side in over 50 ms, half the deadline. */
  maxTextLength: 100_000,
  /** One parse is one uninterruptible stage. */
  maxParseMs: 100,
  /** Every measured side under both size caps parsed in 50 ms or less. */
  maxTokens: 20_000,
  /** At 750, Firefox gives up on unrelated sides within the 50 ms diff deadline. */
  maxEditLength: 750,
  /** With one region's worst case, keeps the diff stage near 100 ms. */
  maxDiffMs: 50,
});
