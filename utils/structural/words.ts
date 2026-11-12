import type { Token } from "./tokens";

/**
 * How the whitespace around a word enters its key:
 * - `ignored`: not at all, so a re-wrap or re-spacing changes no token.
 * - `collapsed`: as one space, so only gaining or losing a gap changes a token.
 * - `exact`: as written.
 */
export type Spacing = "ignored" | "collapsed" | "exact";

/** A run of letters, digits, and `_`, apostrophes inside it included; or one other character. */
const WORD = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}]+)*|[^\s\p{L}\p{M}\p{N}_]/gu;

/**
 * The words of `text` from `start` to `end` as tokens of `type`, each placed at its word. A kept
 * spacing joins the key of the word after it, and the last word's key takes the spacing that
 * ends the range; a range of kept spacing alone is one token.
 */
export function wordTokens(
  text: string,
  { start, end }: { readonly start: number; readonly end: number },
  type: string,
  spacing: Spacing,
): Token[] {
  const spaceOf = (from: number, to: number) => {
    if (spacing === "ignored" || to === from) return "";
    return spacing === "exact" ? text.slice(from, to) : " ";
  };
  const tokens: Token[] = [];
  let covered = start;

  for (const match of text.slice(start, end).matchAll(WORD)) {
    const wordStart = start + match.index;
    const wordEnd = wordStart + match[0].length;
    tokens.push({
      start: wordStart,
      end: wordEnd,
      key: `${spaceOf(covered, wordStart)}${match[0]}`,
      type,
    });
    covered = wordEnd;
  }

  const trailing = spaceOf(covered, end);
  const last = tokens.pop();
  if (last) tokens.push({ ...last, key: `${last.key}${trailing}` });
  else if (trailing) tokens.push({ start, end, key: trailing, type });
  return tokens;
}
