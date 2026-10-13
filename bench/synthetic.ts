import type { ChangedFile, FileStatus } from "@/entrypoints/content/files-page";
import type { PrFileDiff } from "@/utils/pr-diff";

/** One changed file of the synthetic PR: its path and its diff's anchor. */
export interface SyntheticFile {
  readonly path: string;
  readonly anchor: string;
}

const pathOf = (i: number): string => {
  if (i % 10 === 0) return `docs/guide-${i % 4}/page-${i}.md`;
  if (i % 5 === 1) return `crates/pkg-${i % 8}/tests/case-${i}.rs`;
  return `crates/pkg-${i % 8}/src/mod-${Math.floor(i / 8) % 6}/file-${i}.rs`;
};

/** `count` files spanning Implementation, Tests and Documentation, with nested directories. */
export const syntheticFiles = (count: number): SyntheticFile[] =>
  Array.from({ length: count }, (_, i) => ({
    path: pathOf(i),
    // GitHub's anchors are 64 hex digits.
    anchor: `diff-${i.toString(16).padStart(64, "0")}`,
  }));

/** Whether intent needs `path`'s head: an Implementation Rust file. */
export const needsHead = (path: string): boolean => path.includes("/src/") && path.endsWith(".rs");

/** Replaces `doc`'s body with the markup a pull request's Files changed view is found by. */
export function mountShell(doc: Document): void {
  // 900 px: the sidebar height EXC-1970's rendered-row criterion assumes. GitHub's CSS makes the
  // diff list a flex column, which `order` needs; the shell has no GitHub CSS.
  doc.body.innerHTML = `
    <div id="pr-file-tree" style="height: 900px; overflow-y: auto"><ul role="tree"></ul></div>
    <div data-testid="diff-content">
      <div data-testid="progressive-diffs-list" style="display: flex; flex-direction: column"></div>
    </div>`;
}

/**
 * A diff list entry for `anchor` of exactly `entrySize` elements, its wrapper included: lines of a
 * `<div>` and two `<span>`s, padded with `<span>`s.
 */
function diffEntry(doc: Document, anchor: string, entrySize: number): HTMLElement {
  const region = doc.createElement("div");
  region.setAttribute("role", "region");
  region.id = anchor;
  const inner = entrySize - 2;
  for (let line = 0; line < Math.floor(inner / 3); line++) {
    const row = doc.createElement("div");
    row.append(doc.createElement("span"), doc.createElement("span"));
    region.append(row);
  }
  for (let pad = 0; pad < inner % 3; pad++) region.append(doc.createElement("span"));
  const entry = doc.createElement("div");
  entry.append(region);
  return entry;
}

/** Fills the shell's diff list with an entry per file. */
export function mountDiffs(doc: Document, files: readonly SyntheticFile[], entrySize: number) {
  const list = doc.querySelector('[data-testid="progressive-diffs-list"]');
  list?.append(...files.map(({ anchor }) => diffEntry(doc, anchor, entrySize)));
}

/** The native tree's view of `files`, each with `status`. */
export const changedFiles = (
  doc: Document,
  files: readonly SyntheticFile[],
  status: FileStatus,
): ChangedFile[] =>
  files.map(({ path, anchor }) => {
    const link = doc.createElement("a");
    link.href = `#${anchor}`;
    return { path, link, active: false, status, comments: null };
  });

const FUNCTION_COUNT = 50;

/** A Rust head of three-line functions, then a `mod tests` block. */
const rustHead = (): string =>
  [
    ...Array.from({ length: FUNCTION_COUNT }, (_, k) => [
      `pub fn f${k}() -> u32 {`,
      `    ${k}`,
      "}",
    ]),
    [
      "#[cfg(test)]",
      "mod tests {",
      "    use super::*;",
      "    #[test]",
      "    fn checks() {",
      "        assert_eq!(f0(), 0);",
      "    }",
      "}",
    ],
  ]
    .flat()
    .join("\n");

// One code hunk and one test-block hunk, so every src/ file reads its head and splits across
// Implementation and Tests: f0's body, and the assertion inside `mod tests`.
const CODE_LINE = 2;
const TEST_LINE = FUNCTION_COUNT * 3 + 6;

const RUST_PATCH = [
  `@@ -${CODE_LINE},1 +${CODE_LINE},1 @@`,
  "-    9",
  "+    0",
  `@@ -${TEST_LINE},1 +${TEST_LINE},1 @@`,
  "-        assert_eq!(f0(), 9);",
  "+        assert_eq!(f0(), 0);",
].join("\n");

const PROSE_PATCH = [
  "@@ -1,1 +1,1 @@",
  "-Old words about the guide.",
  "+New words about the guide.",
].join("\n");

/** The PR's diff as intent reads it, and the head of each file that needs one. */
export function intentDiff(files: readonly SyntheticFile[]): {
  diffs: PrFileDiff[];
  heads: Map<string, string>;
} {
  const diffs = files.map(
    ({ path }): PrFileDiff => ({
      kind: "text",
      path,
      status: "modified",
      patch: path.endsWith(".md") ? PROSE_PATCH : RUST_PATCH,
    }),
  );
  const head = rustHead();
  const heads = new Map(
    files.filter(({ path }) => needsHead(path)).map(({ path }) => [path, head]),
  );
  return { diffs, heads };
}
