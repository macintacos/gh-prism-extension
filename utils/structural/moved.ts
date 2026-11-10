import type { AnnotationsByLine, StructuralFile, TextByLine } from "./changes";

/** The moved lines of one file, as line numbers on each side. */
export interface MovedLines {
  readonly old: ReadonlySet<number>;
  readonly new: ReadonlySet<number>;
}

/**
 * Pairs each removed line with an added line of the same trimmed text: one copy for one copy, in
 * line order. A blank line never moves, and neither does a quiet line.
 */
export function movedLines(file: StructuralFile): MovedLines {
  const unpaired = removedByText(file.text.old, file.annotations.old);

  const old = new Set<number>();
  const added = new Set<number>();
  for (const [line, text] of movableLines(file.text.new, file.annotations.new)) {
    const partner = unpaired.get(text)?.shift();
    if (partner === undefined) continue;
    old.add(partner);
    added.add(line);
  }

  return { old, new: added };
}

/** The removed lines that could move, by trimmed text, each list in ascending line order. */
function removedByText(text: TextByLine, annotations: AnnotationsByLine): Map<string, number[]> {
  const byText = new Map<string, number[]>();
  for (const [line, trimmed] of movableLines(text, annotations)) {
    const lines = byText.get(trimmed);
    if (lines) lines.push(line);
    else byText.set(trimmed, [line]);
  }
  return byText;
}

/** One side's non-blank, non-quiet lines as `[line, trimmed text]`, in ascending line order. */
function movableLines(
  text: TextByLine,
  annotations: AnnotationsByLine,
): (readonly [number, string])[] {
  return Object.entries(text)
    .map(([line, content]) => [Number(line), content.trim()] as const)
    .filter(([line, trimmed]) => trimmed !== "" && annotations[line]?.quiet !== true)
    .sort(([a], [b]) => a - b);
}
