// Imported by the background as a value: import the engine only as a type, or it bundles into background.js.
import type { EngineLimits } from "./engine";

/** The limits the background sends with every request; a sender never supplies its own. */
export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** Firefox parses a token-dense 150,000-unit Python side in over 50 ms, half the deadline. */
  maxTextLength: 100_000,
  /** One parse is one uninterruptible stage. */
  maxParseMs: 100,
  /** No measured side under 20,000 tokens and this text cap parsed in over 50 ms. */
  maxTokens: 20_000,
  /** Firefox gives up at 1,000 in about 78 ms on unrelated sides, at 750 in about 45 ms. */
  maxEditLength: 750,
  /** With one region's worst case, keeps the diff stage near 100 ms. */
  maxDiffMs: 50,
});
