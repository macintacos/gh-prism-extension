/**
 * The attributes the structural painter writes on GitHub's diff tables and rows. Imports nothing,
 * so Node-side e2e and bench code can read the names without loading the painter's stylesheet.
 */

export const TABLE_ATTR = "data-gh-prism-structural";
export const QUIET_ATTR = "data-gh-prism-quiet";
export const PART_ATTR = "data-gh-prism-part";
export const MARKS_ATTR = "data-gh-prism-marks";
/** Marks an empty cell gh-prism created while re-pairing a changed block. */
export const FILLER_ATTR = "data-gh-prism-filler";
/** Marks a row gh-prism added while re-pairing a changed block. */
export const ADDED_ROW_ATTR = "data-gh-prism-added-row";

/** Every attribute structural mode writes. */
export const STRUCTURAL_ATTRS = [
  TABLE_ATTR,
  QUIET_ATTR,
  PART_ATTR,
  MARKS_ATTR,
  FILLER_ATTR,
  ADDED_ROW_ATTR,
] as const;
