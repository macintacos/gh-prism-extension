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
  rust: "tree-sitter-rust.wasm",
  go: "tree-sitter-go.wasm",
  css: "tree-sitter-css.wasm",
  markdown: "tree-sitter-markdown.wasm",
  json: "tree-sitter-json.wasm",
  yaml: "tree-sitter-yaml.wasm",
  toml: "tree-sitter-toml.wasm",
  bash: "tree-sitter-bash.wasm",
  c: "tree-sitter-c.wasm",
  cpp: "tree-sitter-cpp.wasm",
  lua: "tree-sitter-lua.wasm",
  java: "tree-sitter-java.wasm",
  php: "tree-sitter-php.wasm",
  ruby: "tree-sitter-ruby.wasm",
  c_sharp: "tree-sitter-c_sharp.wasm",
  html: "tree-sitter-html.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
  swift: "tree-sitter-swift.wasm",
};

/** Each packaged file's npm package; the build copies `<package>/<file>` from node_modules. */
export const WASM_SOURCES: readonly (readonly [pkg: string, file: string])[] = [
  ["web-tree-sitter", RUNTIME_WASM],
  ["tree-sitter-typescript", GRAMMAR_WASM.typescript],
  ["tree-sitter-typescript", GRAMMAR_WASM.tsx],
  ["tree-sitter-javascript", GRAMMAR_WASM.javascript],
  ["tree-sitter-python", GRAMMAR_WASM.python],
  ["tree-sitter-rust", GRAMMAR_WASM.rust],
  ["tree-sitter-go", GRAMMAR_WASM.go],
  ["tree-sitter-css", GRAMMAR_WASM.css],
  ["tree-sitter-json", GRAMMAR_WASM.json],
  ["@tree-sitter-grammars/tree-sitter-yaml", GRAMMAR_WASM.yaml],
  ["@tree-sitter-grammars/tree-sitter-toml", GRAMMAR_WASM.toml],
  ["tree-sitter-bash", GRAMMAR_WASM.bash],
  ["tree-sitter-c", GRAMMAR_WASM.c],
  ["tree-sitter-cpp", GRAMMAR_WASM.cpp],
  ["@tree-sitter-grammars/tree-sitter-lua", GRAMMAR_WASM.lua],
  ["tree-sitter-java", GRAMMAR_WASM.java],
  ["tree-sitter-php", GRAMMAR_WASM.php],
  ["tree-sitter-ruby", GRAMMAR_WASM.ruby],
  ["tree-sitter-c-sharp", GRAMMAR_WASM.c_sharp],
  ["tree-sitter-html", GRAMMAR_WASM.html],
  ["@tree-sitter-grammars/tree-sitter-kotlin", GRAMMAR_WASM.kotlin],
];

/** A packaged file that no npm package carries: a download of its project's own release. */
export interface FetchedWasm {
  /** The project's name, as `public/third-party-notices.txt` heads it. */
  readonly pkg: string;
  readonly version: string;
  readonly file: string;
  readonly url: string;
  /** The download's SHA-256 in hex; `bun install` refuses any other bytes. */
  readonly sha256: string;
}

/** The packaged files `bun install` downloads, which `scripts/tasks/grammars.ts` saves and finds. */
export const FETCHED_WASM: readonly FetchedWasm[] = [
  {
    pkg: "tree-sitter-markdown",
    version: "0.5.4",
    file: GRAMMAR_WASM.markdown,
    url: "https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.4/tree-sitter-markdown.wasm",
    sha256: "16180dbb66f40dcb540fc76075f35f528b6686b7c8db0aaacb3b55d1a1098f26",
  },
  {
    pkg: "tree-sitter-swift",
    version: "0.7.3",
    file: GRAMMAR_WASM.swift,
    url: "https://github.com/alex-pinkus/tree-sitter-swift/releases/download/0.7.3/tree-sitter-swift.wasm",
    sha256: "0258a7ef17303a8079ffe0748b3583d59656b5c3e8653fca7b6451b3e6689eb2",
  },
];
