import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
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
