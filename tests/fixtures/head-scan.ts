import { type ScannedHead, scanHeadText } from "../../utils/hunk-rules/head-scan";

/** Joins `text` into one newline-separated string, as a patch or file body. */
export const lines = (...text: string[]): string => text.join("\n");

/** The head scan of `text` at `path`; throws when `path` has no comment syntax. */
export function headOf(path: string, text: string): ScannedHead {
  const head = scanHeadText(path, text);
  if (head === undefined) throw new Error(`no comment syntax for ${path}`);
  return head;
}
