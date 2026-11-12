import type { GrammarId } from "./grammar";

/** The directory in the built extension that holds the engine's WebAssembly. */
export const WASM_DIR = "structural";

/** web-tree-sitter's runtime. */
export const RUNTIME_WASM = "web-tree-sitter.wasm";

/** Each grammar's packaged `.wasm`. */
export const GRAMMAR_WASM: Readonly<Record<GrammarId, string>> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
};

/** Each packaged file's npm package; the build copies `<package>/<file>` from node_modules. */
export const WASM_SOURCES: readonly (readonly [pkg: string, file: string])[] = [
  ["web-tree-sitter", RUNTIME_WASM],
  ["tree-sitter-typescript", GRAMMAR_WASM.typescript],
  ["tree-sitter-typescript", GRAMMAR_WASM.tsx],
  ["tree-sitter-javascript", GRAMMAR_WASM.javascript],
  ["tree-sitter-python", GRAMMAR_WASM.python],
];
