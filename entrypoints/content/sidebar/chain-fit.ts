/** Which folders a flattened chain shows at rest: the first unless `first` is false, a `…` when
 * anything hides, and every folder from index `from` to the deepest. `{ first: true, from: 1 }`
 * shows it whole. */
export interface ChainFit {
  readonly first: boolean;
  readonly from: number;
}

/**
 * Fits a chain into `room`: everything when it fits; else the first folder, `…`, and as many
 * trailing folders as fit; else `…` and the deepest alone, which then middle-truncates.
 * `units[i]` is folder i's natural width, its leading separator included (none on the first);
 * `ellipsis` is the `…` unit's width, its separator included. Widths in CSS px.
 */
export function fitChain(units: readonly number[], ellipsis: number, room: number): ChainFit {
  const sum = (from: number) => units.slice(from).reduce((total, width) => total + width, 0);
  if (sum(0) <= room) return { first: true, from: 1 };

  for (let from = 2; from < units.length; from++) {
    if ((units[0] ?? 0) + ellipsis + sum(from) <= room) return { first: true, from };
  }
  return { first: false, from: units.length - 1 };
}

// Hidden units stay laid out, so the next fit can still measure them.
const HIDDEN = "position:absolute;visibility:hidden";

/**
 * The rule that shows `fit` in the row of `rowPath`, whose folders are `unitPaths`; empty when
 * nothing hides.
 */
export function chainRule(rowPath: string, unitPaths: readonly string[], fit: ChainFit): string {
  const row = `[data-type="item"][data-item-path="${CSS.escape(rowPath)}"]`;
  const hidden = unitPaths.slice(fit.first ? 1 : 0, fit.from);
  if (!hidden.length) return "";

  const ellipsis = `${row} [data-item-flattened-ellipsis]`;
  const units = hidden.map((path) => `${row} [data-item-flattened-subitem="${CSS.escape(path)}"]`);
  return (
    `${units.join(",")}{${HIDDEN}}` +
    // inherit, not visible, so the row's revealed full name can hide it too.
    `${ellipsis}{position:static;visibility:inherit}` +
    (fit.first ? "" : `${ellipsis}>[data-item-flattened-separator]{${HIDDEN}}`)
  );
}
