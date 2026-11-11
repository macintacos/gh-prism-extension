import type { FileSection } from "../../entrypoints/content/visit/land";

/** Mounts each fixture's table in its own region, all inside one diffs container. */
export function mountDiffs(...htmls: string[]): HTMLElement {
  const diffs = document.createElement("div");
  for (const html of htmls) {
    const region = document.createElement("div");
    region.innerHTML = html;
    diffs.append(region);
  }
  document.body.replaceChildren(diffs);
  return diffs;
}

export const tables = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLTableElement>("table[data-diff-anchor]"),
];

export const tableAt = (root: ParentNode, index = 0): HTMLTableElement => {
  const table = tables(root)[index];
  if (!table) throw new Error(`no table ${index}`);
  return table;
};

export const anchorOfTable = (table: HTMLTableElement) => table.dataset.diffAnchor ?? "";

/** One section listing each table's file, its path being the table's anchor. */
export function sectionsOf(root: ParentNode): FileSection[] {
  const entries = tables(root).map((table) => {
    const link = document.createElement("a");
    link.setAttribute("href", `#${anchorOfTable(table)}`);
    const file = {
      path: anchorOfTable(table),
      link,
      active: false,
      status: undefined,
      comments: null,
    };
    return { section: "implementation", lines: undefined, file } as const;
  });
  return [{ key: "implementation", entries }];
}
