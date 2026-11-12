import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { diffLines } from "diff";
import { Language, Parser } from "web-tree-sitter";
import type { TokenSpan } from "../../utils/structural/changes";
import {
  type ChangedRegion,
  DEFAULT_LIMITS,
  type EngineInput,
} from "../../utils/structural/engine";
import type { GrammarId } from "../../utils/structural/grammar";

const require = createRequire(import.meta.url);
const WASM: Record<GrammarId, string> = {
  typescript: "tree-sitter-typescript/tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript/tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript/tree-sitter-javascript.wasm",
  python: "tree-sitter-python/tree-sitter-python.wasm",
};

await Parser.init();

/** A parser loaded with `id`'s grammar from `node_modules`. */
export async function parserFor(id: GrammarId): Promise<Parser> {
  const parser = new Parser();
  parser.setLanguage(await Language.load(require.resolve(WASM[id])));
  return parser;
}

const EXTENSION: Record<GrammarId, string> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  python: "py",
};

/** The old and new texts of the fixture pair `name` under `grammar`'s directory. */
export function readPair(grammar: GrammarId, name: string): { oldText: string; newText: string } {
  const read = (side: string) =>
    readFileSync(
      new URL(`structural/${grammar}/${name}.${side}.${EXTENSION[grammar]}.txt`, import.meta.url),
      "utf8",
    );
  return { oldText: read("old"), newText: read("new") };
}

/** The changed line runs `diffLines` finds: each maximal run of removed and added parts. */
export function regionsOf(oldText: string, newText: string): ChangedRegion[] {
  const regions: ChangedRegion[] = [];
  let oldLine = 1;
  let newLine = 1;
  let open: { oldStart: number; oldEnd: number; newStart: number; newEnd: number } | undefined;
  for (const part of diffLines(oldText, newText)) {
    if (!part.added && !part.removed) {
      open = undefined;
      oldLine += part.count;
      newLine += part.count;
      continue;
    }

    if (!open) {
      open = { oldStart: oldLine, oldEnd: oldLine, newStart: newLine, newEnd: newLine };
      regions.push(open);
    }
    if (part.removed) oldLine += part.count;
    else newLine += part.count;
    open.oldEnd = oldLine;
    open.newEnd = newLine;
  }
  return regions;
}

export const swapped = (regions: readonly ChangedRegion[]): ChangedRegion[] =>
  regions.map((region) => ({
    oldStart: region.newStart,
    oldEnd: region.newEnd,
    newStart: region.oldStart,
    newEnd: region.oldEnd,
  }));

/** Each span's text, sliced from its line of `text`. */
export function spanTexts(text: string, spans: readonly TokenSpan[]): string[] {
  const lines = text.split("\n");
  return spans.map((span) => (lines[span.line - 1] ?? "").slice(span.startCol, span.endCol));
}

/** An engine input with default limits, a live signal, a frozen clock, and an immediate pause. */
export const inputFor = (
  overrides: Pick<EngineInput, "oldText" | "newText" | "language" | "regions"> &
    Partial<EngineInput>,
): EngineInput => ({
  limits: DEFAULT_LIMITS,
  signal: new AbortController().signal,
  now: () => 0,
  pause: () => Promise.resolve(),
  ...overrides,
});
