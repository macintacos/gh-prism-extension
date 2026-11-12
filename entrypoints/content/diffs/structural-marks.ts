import type { ColumnRange } from "@/utils/structural/changes";

/** Whether `range` lies inside `text` and isn't empty. */
const inText = (text: string, { startCol, endCol }: ColumnRange) =>
  startCol >= 0 && startCol < endCol && endCol <= text.length;

/**
 * The marks to draw on a line of `text` whose changed tokens are `ranges`, in column order: ranges
 * with only whitespace between them join into one mark, and a range outside `text` is dropped. A
 * line changed in full gets no mark when `inFull` is `"tint"`, since its line tint already says
 * so, and one mark over its text when `inFull` is `"mark"`.
 */
export function markRanges(
  text: string,
  ranges: readonly ColumnRange[],
  inFull: "tint" | "mark" = "tint",
): ColumnRange[] {
  const marks: ColumnRange[] = [];
  for (const range of ranges) {
    if (!inText(text, range)) continue;
    const last = marks.at(-1);
    if (last && text.slice(last.endCol, range.startCol).trim() === "")
      marks[marks.length - 1] = {
        startCol: last.startCol,
        endCol: Math.max(last.endCol, range.endCol),
      };
    else marks.push(range);
  }

  if (inFull === "mark") return marks;

  const [only, second] = marks;
  const whole =
    only !== undefined &&
    second === undefined &&
    text.slice(0, only.startCol).trim() === "" &&
    text.slice(only.endCol).trim() === "";
  return whole ? [] : marks;
}

/** A rectangle in CSS pixels, from the top left corner of the text it marks. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * One box per visual line of a mark, from its text's client `rects`, measured from `origin`. A
 * range yields a rect per syntax span it crosses, and more when its line wraps.
 */
export function lineBoxes(
  origin: { readonly left: number; readonly top: number },
  rects: Iterable<Edges>,
): Box[] {
  const lines: Edges[] = [];
  for (const rect of rects) {
    if (rect.right <= rect.left) continue;
    const index = lines.findIndex((line) => rect.top < line.bottom && line.top < rect.bottom);
    const line = lines[index];
    if (!line) lines.push(rect);
    else
      lines[index] = {
        left: Math.min(line.left, rect.left),
        top: Math.min(line.top, rect.top),
        right: Math.max(line.right, rect.right),
        bottom: Math.max(line.bottom, rect.bottom),
      };
  }

  return lines.map(({ left, top, right, bottom }) => ({
    x: left - origin.left,
    y: top - origin.top,
    width: right - left,
    height: bottom - top,
  }));
}

// How far a mark reaches past its text on every side, and its corner. The text's 20px line leaves
// the room, so no mark touches the next line's.
const PAD = 2;
const RADIUS = 3;

const px = (value: number) => Math.round(value * 100) / 100;

/**
 * A CSS `url()` of an image that is opaque over `boxes`, each padded and rounded, for
 * `mask-image`; `undefined` for no boxes. A box never reaches left of the text's own box, which
 * clips there.
 */
export function maskOf(boxes: readonly Box[]): string | undefined {
  if (boxes.length === 0) return undefined;

  const padded = boxes.map(({ x, y, width, height }) => {
    const left = Math.max(0, x - PAD);
    return { x: left, y: y - PAD, width: x + width + PAD - left, height: height + 2 * PAD };
  });
  const width = Math.max(...padded.map((box) => box.x + box.width));
  const height = Math.max(...padded.map((box) => box.y + box.height));
  const rects = padded.map(
    (box) =>
      `<rect x='${px(box.x)}' y='${px(box.y)}' width='${px(box.width)}' height='${px(box.height)}' rx='${RADIUS}'/>`,
  );
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${px(width)}' height='${px(height)}'>${rects.join("")}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
