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
  const widthFrom = (from: number) => units.slice(from).reduce((total, width) => total + width, 0);
  if (widthFrom(0) <= room) return { first: true, from: 1 };

  for (let from = 2; from < units.length; from++) {
    if ((units[0] ?? 0) + ellipsis + widthFrom(from) <= room) return { first: true, from };
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
  const rowSelector = `[data-type="item"][data-item-path="${CSS.escape(rowPath)}"]`;
  const hiddenPaths = unitPaths.slice(fit.first ? 1 : 0, fit.from);
  if (!hiddenPaths.length) return "";

  const ellipsisSelector = `${rowSelector} [data-item-flattened-ellipsis]`;
  const hiddenUnitSelectors = hiddenPaths.map(
    (path) => `${rowSelector} [data-item-flattened-subitem="${CSS.escape(path)}"]`,
  );
  return (
    `${hiddenUnitSelectors.join(",")}{${HIDDEN}}` +
    // inherit, not visible, so the row's revealed full name can hide it too.
    `${ellipsisSelector}{position:static;visibility:inherit}` +
    (fit.first ? "" : `${ellipsisSelector}>[data-item-flattened-separator]{${HIDDEN}}`)
  );
}
