/**
 * Changed files grouped under their folders, as gh-prism's popups and dialogs list them.
 * No sheet of its own: every caller's sheet must `@source` this file for its utilities.
 */

import { el } from "./dom";

/** A folder, named by its path with a trailing slash, or a file, named by its base name. */
export type PathNode =
  | { readonly folder: string; readonly children: readonly PathNode[] }
  | { readonly name: string; readonly path: string };

// A folder's key ends in "/" and a file's never does, so the two never collide.
type Draft = Map<string, Draft | string>;

/**
 * `paths` grouped into folders in the order each first appears, a folder that holds only
 * another folder merged into it, as the sidebar's tree flattens them.
 */
export function pathTree(paths: readonly string[]): PathNode[] {
  const root: Draft = new Map();
  for (const path of paths) {
    const segments = path.split("/");
    const name = segments.pop() ?? path;
    const folder = segments.reduce<Draft>((parent, segment) => {
      const key = `${segment}/`;
      const child = parent.get(key);
      if (child instanceof Map) return child;
      const made: Draft = new Map();
      parent.set(key, made);
      return made;
    }, root);
    folder.set(name, path);
  }
  return nodesOf(root);
}

function nodesOf(draft: Draft): PathNode[] {
  return [...draft].map(([key, value]) =>
    typeof value === "string" ? { name: key, path: value } : merged(key, nodesOf(value)),
  );
}

function merged(folder: string, children: PathNode[]): PathNode {
  const [only] = children;
  return children.length === 1 && only && "folder" in only
    ? { folder: folder + only.folder, children: only.children }
    : { folder, children };
}

const LIST = "tw:mx-0 tw:mb-0 tw:py-0 tw:pr-0 tw:list-none tw:flex tw:flex-col tw:gap-1";

/** `paths` as nested lists of muted folder paths and their files, `under` adding rows below each file's name. */
export function fileList(
  doc: Document,
  paths: readonly string[],
  under: (path: string) => readonly Node[] = () => [],
): HTMLUListElement {
  const items = (nodes: readonly PathNode[]): HTMLLIElement[] =>
    nodes.map((node) =>
      "folder" in node
        ? el(
            doc,
            "li",
            "",
            el(
              doc,
              "div",
              "tw:font-mono tw:text-fg-muted",
              ...(node.folder.match(/[^/]*\//g) ?? []).flatMap((segment) => [
                segment,
                doc.createElement("wbr"),
              ]),
            ),
            el(doc, "ul", `${LIST} tw:pl-4 tw:mt-1`, ...items(node.children)),
          )
        : el(doc, "li", "", el(doc, "div", "tw:font-mono", node.name), ...under(node.path)),
    );
  return el(
    doc,
    "ul",
    `${LIST} tw:mt-0 tw:pl-0 tw:text-body-small tw:leading-body-small`,
    ...items(pathTree(paths)),
  );
}
