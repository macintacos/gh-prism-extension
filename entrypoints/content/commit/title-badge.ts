/**
 * A conventional commit title's badge: its type as one of GitHub's labels, then its scope in muted
 * text. The prefix is read as Refined GitHub reads it on a commits list, so a title looks the same
 * in both places. `title-badge.css` colours each type.
 */
import { el } from "../ui/dom";

/** Refined GitHub's types and the names it shows for them. */
const LABELS = {
  feat: "Feature",
  fix: "Fix",
  chore: "Chore",
  revert: "Revert",
  style: "Style",
  docs: "Docs",
  build: "Build",
  refactor: "Refactor",
  test: "Test",
  ci: "CI",
  perf: "Performance",
} as const;

/** A conventional commit type, in lower case. */
export type CommitType = keyof typeof LABELS;

const isCommitType = (type: string): type is CommitType => Object.hasOwn(LABELS, type);

/** A commit title that opens with a conventional commit prefix, as `parseConventionalTitle` reads it. */
export interface ConventionalTitle {
  /** The type, which `title-badge.css` colours or leaves neutral. */
  readonly type: CommitType;
  /** The type's name, ending in `!` for a breaking change. */
  readonly label: string;
  readonly scope: string | undefined;
  /** The title after its prefix; never empty. */
  readonly rest: string;
}

const PREFIX = /^(\w+)(?:\((.+?)\))?(!)?: */;

/**
 * `title` split at its conventional commit prefix, or `undefined` when it has none, names a type
 * outside `LABELS`, or holds nothing after the prefix.
 */
export function parseConventionalTitle(title: string): ConventionalTitle | undefined {
  const match = PREFIX.exec(title);
  if (!match) return undefined;
  const type = match[1]?.toLowerCase() ?? "";
  const rest = title.slice(match[0].length);
  if (!isCommitType(type) || !rest) return undefined;
  return { type, label: `${LABELS[type]}${match[3] ?? ""}`, scope: match[2], rest };
}

/**
 * `title`'s label and, when `scope` holds any, the scope and its colon, as content of `doc` to
 * lead the title's description with. `scope` is the scope's text and GitHub's links.
 */
export function titleBadge(
  doc: Document,
  title: Pick<ConventionalTitle, "type" | "label">,
  scope: readonly (Node | string)[],
): (Node | string)[] {
  // GitHub's label classes, which colour it from the --label-* properties of its type.
  const label = el(doc, "span", "gh-prism-commit-type IssueLabel hx_IssueLabel", title.label);
  label.dataset.type = title.type;
  if (scope.length === 0) return [label, " "];
  return [label, " ", el(doc, "span", "gh-prism-commit-scope", ...scope, ": ")];
}
