import { extensionOf } from "../hunk-rules/head-scan";
import type { Token } from "./tokens";
import { wordTokens } from "./words";

/** Stands in for a grammar on a file the engine reads as words alone, with no parse. */
export const PLAIN_TEXT = "plain-text";
export type PlainText = typeof PLAIN_TEXT;

/** Whether `path` is a file to read as plain text. */
export const isPlainText = (path: string): boolean => extensionOf(path) === "txt";

/** `text`'s words as tokens, their spacing and line breaks ignored. `undefined` past `maxTokens`. */
export function plainTextTokens(text: string, maxTokens: number): Token[] | undefined {
  const tokens = wordTokens(text, { start: 0, end: text.length }, "text", "ignored");
  return tokens.length > maxTokens ? undefined : tokens;
}
