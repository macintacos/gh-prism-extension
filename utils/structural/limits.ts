// Imported by the background as a value: import the engine only as a type, or it bundles into background.js.
import type { EngineLimits } from "./engine";

/** The limits the background sends with every request; a sender never supplies its own. */
export const DEFAULT_LIMITS: EngineLimits = Object.freeze({
  /** About 1.5 times the largest file measured (170,549 bytes). */
  maxTextLength: 256_000,
  /** One parse is one uninterruptible stage. */
  maxParseMs: 100,
  /** The leaf walk costs about as much as the parse; the largest file seen had 12,483. */
  maxTokens: 20_000,
  /** Giving up at 1,000 costs about 46 ms on two unrelated 3,000-token sides. */
  maxEditLength: 1_000,
  /** With one region's worst case, keeps the diff stage near 100 ms. */
  maxDiffMs: 50,
});
