import { extensionOf } from "../hunk-rules/head-scan";

/** Names a tree-sitter grammar; `packaged.ts` maps each to its `.wasm`. */
export type GrammarId = "typescript" | "tsx" | "javascript" | "python";

/** A language the structural engine can parse. */
export interface Grammar {
  readonly id: GrammarId;
  /** Whether a line's block depth is part of its first token, so a dedent is a change. */
  readonly indentationSensitive: boolean;
}

const grammar = (id: GrammarId, indentationSensitive = false): Grammar => ({
  id,
  indentationSensitive,
});

const TYPESCRIPT = grammar("typescript");
const JAVASCRIPT = grammar("javascript");
const PYTHON = grammar("python", true);

const GRAMMAR_BY_EXTENSION = new Map<string, Grammar>([
  ...["ts", "mts", "cts"].map((ext) => [ext, TYPESCRIPT] as const),
  ["tsx", grammar("tsx")],
  ...["js", "mjs", "cjs", "jsx"].map((ext) => [ext, JAVASCRIPT] as const),
  ...["py", "pyi"].map((ext) => [ext, PYTHON] as const),
]);

/** The grammar for `path`'s extension; `undefined` for an extension with none. */
export const grammarOf = (path: string): Grammar | undefined =>
  GRAMMAR_BY_EXTENSION.get(extensionOf(path));
