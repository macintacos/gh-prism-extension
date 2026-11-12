// Imported by the background as a value: import the engine only as a type, or it bundles into background.js.
import type { EngineLimits } from "./engine";

/** The limits the background sends with every request; a sender never supplies its own. */
export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** Firefox parses a 500,000-unit side of the slowest grammar, Ruby, in about 120 ms. */
  maxTextLength: 500_000,
  /** One parse is one uninterruptible stage; twice what the longest side within the caps takes. */
  maxParseMs: 250,
  /** Firefox walks a 150,000-token side for its tokens and its units in about 240 ms. */
  maxTokens: 150_000,
  /** What an answer may carry across the port and into the cache. */
  maxChangedTokens: 20_000,
  /** At 750, Firefox gives up on unrelated sides within the 50 ms diff deadline. */
  maxEditLength: 750,
  /** With one region's worst case, keeps the diff stage near 100 ms. */
  maxDiffMs: 50,
});
