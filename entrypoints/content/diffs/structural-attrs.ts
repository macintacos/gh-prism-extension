/**
 * The attributes the structural painter writes on GitHub's diff tables and rows. Imports nothing,
 * so Node-side e2e and bench code can read the names without loading the painter's stylesheet.
 */

export const TABLE_ATTR = "data-gh-prism-structural";
export const QUIET_ATTR = "data-gh-prism-quiet";
export const MOVED_ATTR = "data-gh-prism-moved";

/** Every attribute the painter writes. */
export const STRUCTURAL_ATTRS = [TABLE_ATTR, QUIET_ATTR, MOVED_ATTR] as const;
