import { type LineCounts, type PrFileDiff, type PrHunk, parsePrHunks } from "../github/pr-diff";
import {
  type CommentSyntax,
  commentSyntaxOf,
  FILE_START,
  type LineKind,
  type ScannedHead,
  type ScanPosition,
  type ScanState,
  scanLine,
} from "./head-scan";

/**
 * Judges whether a diff changes only comments and docstrings, by scanning lines rather than
 * tokens. A patch hides the state a hunk starts in, so each hunk is judged from every start its
 * lines make plausible, and consults the head file's scan only when those starts disagree. Prose
 * with no delimiter or gutter in view has only the code start, so it stays "path" without a scan,
 * by design. A renamed file is never "docs": moving a module can break its imports.
 */

/**
 * - `"docs"`: every change is a comment or docstring.
 * - `"path"`: keep the path section.
 * - `"needs-content"`: only the head file's text can tell.
 */
export type DocVerdict = "docs" | "path" | "needs-content";

/**
 * Judges one hunk. Without a head scan, every start state the hunk could begin in must agree; with
 * one, the start state is the scan's state just above the hunk. The extension of `path` picks the
 * comment syntax, and an unsupported extension is `"path"`.
 */
export function docHunkVerdict(path: string, hunk: PrHunk): DocVerdict;
export function docHunkVerdict(path: string, hunk: PrHunk, head: ScannedHead): "docs" | "path";
export function docHunkVerdict(path: string, hunk: PrHunk, head?: ScannedHead): DocVerdict {
  const syntax = commentSyntaxOf(path);
  if (syntax === undefined) return "path";

  if (head !== undefined) return hunkVerdictFrom(syntax, hunk, headStart(hunk, head));

  const verdicts = new Set(
    plausibleStarts(syntax, hunk).map((start) => hunkVerdictFrom(syntax, hunk, start)),
  );
  if (verdicts.size > 1) return "needs-content";
  return verdicts.has("docs") ? "docs" : "path";
}

/**
 * The changed lines of `hunk` the comment scan confirms are comments or docstrings, by side.
 * Without a head scan, every plausible start must give the same counts; with one, the start is
 * the scan's state just above the hunk. A hunk that reshapes a block, or an unsupported
 * extension, counts zero.
 */
export function commentLineCounts(path: string, hunk: PrHunk): LineCounts | "needs-content";
export function commentLineCounts(path: string, hunk: PrHunk, head: ScannedHead): LineCounts;
export function commentLineCounts(
  path: string,
  hunk: PrHunk,
  head?: ScannedHead,
): LineCounts | "needs-content" {
  const syntax = commentSyntaxOf(path);
  if (syntax === undefined) return { added: 0, removed: 0 };

  if (head !== undefined) return countsFrom(syntax, hunk, headStart(hunk, head));

  const [first, ...rest] = plausibleStarts(syntax, hunk).map((start) =>
    countsFrom(syntax, hunk, start),
  );
  const agree = rest.every(
    (counts) => counts.added === first?.added && counts.removed === first.removed,
  );
  return agree && first !== undefined ? first : "needs-content";
}

/**
 * One verdict per hunk, aligned with `parsePrHunks(file.patch)`; `[]` for a binary or renamed file.
 * With a head scan, only the hunks that need content are judged again, against it.
 */
export function docHunkVerdicts(file: PrFileDiff): DocVerdict[];
export function docHunkVerdicts(file: PrFileDiff, head: ScannedHead): ("docs" | "path")[];
export function docHunkVerdicts(file: PrFileDiff, head?: ScannedHead): DocVerdict[] {
  if (file.kind === "binary" || file.previousPath !== undefined) return [];
  return parsePrHunks(file.patch).map((hunk) => {
    const verdict = docHunkVerdict(file.path, hunk);
    if (verdict !== "needs-content" || head === undefined) return verdict;
    return docHunkVerdict(file.path, hunk, head);
  });
}

interface HunkLine {
  readonly marker: string;
  readonly text: string;
}

function bodyOf(hunk: PrHunk): HunkLine[] {
  return hunk.lines
    .filter((line) => !line.startsWith("\\"))
    .map((line) => ({ marker: line.charAt(0), text: line.slice(1) }));
}

/** The head's scan state just above `hunk`. */
function headStart(hunk: PrHunk, head: ScannedHead): ScanState {
  // `linesAbove` is clamped into `starts`, so the `??` fallback never applies.
  const linesAbove = Math.min(Math.max(hunk.newStart - 1, 0), head.lines.length);
  return head.starts[linesAbove] ?? FILE_START;
}

interface ChangedLine {
  readonly marker: "-" | "+";
  readonly kind: LineKind;
}

/**
 * Scans both sides of the hunk from `start`, returning each changed line's kind. A context line
 * that reads differently on the two sides, with code on either, means the change altered its
 * block: "reshaped".
 */
function scanChanges(
  syntax: CommentSyntax,
  hunk: PrHunk,
  start: ScanState,
): ChangedLine[] | "reshaped" {
  // The old side reuses the head's start state: only the head file can be read.
  let before = start;
  let after = start;
  const changed: ChangedLine[] = [];

  for (const { marker, text } of bodyOf(hunk)) {
    if (marker === "-") {
      const scanned = scanLine(syntax, before, text);
      before = scanned.state;
      changed.push({ marker, kind: scanned.kind });
    } else if (marker === "+") {
      const scanned = scanLine(syntax, after, text);
      after = scanned.state;
      changed.push({ marker, kind: scanned.kind });
    } else {
      const old = scanLine(syntax, before, text);
      const now = scanLine(syntax, after, text);
      before = old.state;
      after = now.state;
      if (old.kind !== now.kind && (old.kind === "code" || now.kind === "code")) return "reshaped";
    }
  }

  return changed;
}

function hunkVerdictFrom(syntax: CommentSyntax, hunk: PrHunk, start: ScanState): "docs" | "path" {
  const changed = scanChanges(syntax, hunk, start);
  if (changed === "reshaped") return "path";
  const kinds = changed.map(({ kind }) => kind);
  return kinds.includes("code") || !kinds.includes("comment") ? "path" : "docs";
}

function countsFrom(syntax: CommentSyntax, hunk: PrHunk, start: ScanState): LineCounts {
  const changed = scanChanges(syntax, hunk, start);
  if (changed === "reshaped") return { added: 0, removed: 0 };
  const comments = changed.filter(({ kind }) => kind === "comment");
  return {
    added: comments.filter(({ marker }) => marker === "+").length,
    removed: comments.filter(({ marker }) => marker === "-").length,
  };
}

/**
 * The start states a hunk could begin in, judged from its patch alone. Whether a line-start
 * triple quote opens a docstring depends on the unseen start, so every position is tried both
 * ways.
 */
function plausibleStarts(syntax: CommentSyntax, hunk: PrHunk): ScanState[] {
  if (hunk.newStart <= 1) return [FILE_START];

  const body = bodyOf(hunk);
  const positions: ScanPosition[] = ["code"];
  for (const block of syntax.blocks) {
    if (!body.some(({ text }) => text.includes(block.closer))) continue;
    positions.push({ closer: block.closer, kind: "comment" });
    if (block.delimitsStrings) positions.push({ closer: block.closer, kind: "string" });
  }

  const gutterBlock = syntax.blocks.find(
    (block) => block.gutter !== undefined && isGutterRun(body, block.gutter),
  );
  if (gutterBlock !== undefined) positions.push({ closer: gutterBlock.closer, kind: "comment" });

  return positions.flatMap((position) => [
    { position, docstringMayOpen: true },
    { position, docstringMayOpen: false },
  ]);
}

/** Whether every non-blank line starts with `gutter`: a block's middle with no delimiter in view. */
function isGutterRun(body: readonly HunkLine[], gutter: string): boolean {
  const nonBlankLines = body.map(({ text }) => text.trim()).filter((text) => text !== "");
  return nonBlankLines.length > 0 && nonBlankLines.every((text) => text.startsWith(gutter));
}
