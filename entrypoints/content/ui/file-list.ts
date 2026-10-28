/**
 * Changed files grouped under their folders, as gh-prism's popups and dialogs list them.
 * No sheet of its own: every caller's sheet must `@source` this file for its utilities.
 */

import { el } from "./dom";

/**
 * A folder, named by its path below its parent folder (one or more segments, each ending in
 * "/"), or a file, named by its base name and keeping its full path.
 */
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
    const folder = segments.reduce(subfolder, root);
    folder.set(name, path);
  }

  return nodesOf(root);
}

/** `parent`'s folder named `segment`, made if it has none yet. */
function subfolder(parent: Draft, segment: string): Draft {
  const key = `${segment}/`;
  const child = parent.get(key);
  if (child instanceof Map) return child;
  const made: Draft = new Map();
  parent.set(key, made);
  return made;
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

/**
 * `paths` as nested lists of muted folder paths and their files' names. `under` gets each
 * file's path exactly as given in `paths` and returns rows to show below its name.
 */
export function fileList(
  doc: Document,
  paths: readonly string[],
  under: (path: string) => readonly Node[] = () => [],
): HTMLUListElement {
  const item = (node: PathNode): HTMLLIElement =>
    "folder" in node
      ? el(
          doc,
          "li",
          "",
          folderLabel(doc, node.folder),
          el(
            doc,
            "ul",
            "tw:mt-1 tw:mb-0 tw:mx-0 tw:py-0 tw:pl-4 tw:pr-0 tw:list-none tw:flex tw:flex-col tw:gap-1",
            ...node.children.map(item),
          ),
        )
      : el(doc, "li", "", el(doc, "div", "tw:font-mono", node.name), ...under(node.path));

  return el(
    doc,
    "ul",
    "tw:m-0 tw:p-0 tw:list-none tw:flex tw:flex-col tw:gap-1 tw:text-body-small tw:leading-body-small",
    ...pathTree(paths).map(item),
  );
}

/** `folder` in muted monospace, able to break only after each slash. */
function folderLabel(doc: Document, folder: string): HTMLElement {
  const segments = folder.match(/[^/]*\//g) ?? [];
  return el(
    doc,
    "div",
    "tw:font-mono tw:text-fg-muted",
    ...segments.flatMap((segment) => [segment, doc.createElement("wbr")]),
  );
}
