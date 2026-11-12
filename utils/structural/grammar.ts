import { extensionOf } from "../hunk-rules/head-scan";

/** Names a tree-sitter grammar; `packaged.ts` maps each to its `.wasm`. */
export type GrammarId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "rust"
  | "go"
  | "css"
  | "markdown"
  | "json"
  | "yaml"
  | "toml"
  | "bash"
  | "c"
  | "cpp"
  | "lua"
  | "java"
  | "php"
  | "ruby"
  | "c_sharp"
  | "html"
  | "kotlin"
  | "swift";

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

/** Each of `extensions` mapped to `language`. */
const each = (language: Grammar, extensions: readonly string[]) =>
  extensions.map((ext) => [ext, language] as const);

// A dotfile's name after its dot is its extension, so `.bashrc` is listed as `bashrc`.
const GRAMMAR_BY_EXTENSION = new Map<string, Grammar>([
  ...["ts", "mts", "cts"].map((ext) => [ext, TYPESCRIPT] as const),
  ["tsx", grammar("tsx")],
  ...["js", "mjs", "cjs", "jsx"].map((ext) => [ext, JAVASCRIPT] as const),
  ...["py", "pyi"].map((ext) => [ext, PYTHON] as const),
  ["rs", grammar("rust")],
  ["go", grammar("go")],
  ["css", grammar("css")],
  // A nested list item's depth is its indentation.
  ...each(grammar("markdown", true), ["md", "markdown"]),
  ...each(grammar("json"), ["json", "jsonc", "geojson", "webmanifest", "babelrc"]),
  ...each(grammar("yaml", true), ["yml", "yaml", "clang-format", "clang-tidy"]),
  ["toml", grammar("toml")],
  ...each(grammar("bash"), ["sh", "bash", "zsh", "bashrc", "bash_profile", "bash_aliases"]),
  ...each(grammar("bash"), ["profile", "zshrc", "zshenv", "zprofile", "envrc"]),
  ["c", grammar("c")],
  // `.h` reads as C++, which parses a C header too; the C grammar fails on a C++ one.
  ...each(grammar("cpp"), ["h", "cc", "cpp", "cxx", "hpp", "hh", "hxx", "ipp", "tpp", "inl"]),
  ...each(grammar("lua"), ["lua", "rockspec"]),
  ["java", grammar("java")],
  ...each(grammar("php"), ["php", "phtml"]),
  ...each(grammar("ruby"), ["rb", "rake", "gemspec", "ru", "podspec"]),
  ...each(grammar("c_sharp"), ["cs", "csx"]),
  ...each(grammar("html"), ["html", "htm", "xhtml"]),
  ...each(grammar("kotlin"), ["kt", "kts"]),
  ["swift", grammar("swift")],
]);

/** The grammar for `path`'s extension; `undefined` for an extension with none. */
export const grammarOf = (path: string): Grammar | undefined =>
  GRAMMAR_BY_EXTENSION.get(extensionOf(path));
