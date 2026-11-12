import { describe, expect, it } from "vitest";
import { grammarOf } from "../../../utils/structural/grammar";

describe("grammarOf", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["a.d.ts", "typescript"],
    ["a.mts", "typescript"],
    ["a.cts", "typescript"],
    ["App.tsx", "tsx"],
    ["a.js", "javascript"],
    ["a.mjs", "javascript"],
    ["a.cjs", "javascript"],
    ["a.jsx", "javascript"],
    [".eslintrc.js", "javascript"],
    ["a.py", "python"],
    ["a.pyi", "python"],
    ["src/main.rs", "rust"],
    ["main.go", "go"],
    ["a.css", "css"],
    ["README.md", "markdown"],
    ["a.markdown", "markdown"],
    ["package.json", "json"],
    ["tsconfig.jsonc", "json"],
    ["a.geojson", "json"],
    ["a.webmanifest", "json"],
    [".babelrc", "json"],
    ["a.yml", "yaml"],
    ["a.yaml", "yaml"],
    [".clang-format", "yaml"],
    [".clang-tidy", "yaml"],
    ["Cargo.toml", "toml"],
    ["a.sh", "bash"],
    ["a.bash", "bash"],
    ["a.zsh", "bash"],
    [".bashrc", "bash"],
    [".bash_profile", "bash"],
    [".bash_aliases", "bash"],
    [".profile", "bash"],
    [".zshrc", "bash"],
    [".zshenv", "bash"],
    [".zprofile", "bash"],
    [".envrc", "bash"],
    ["a.c", "c"],
    ["a.h", "cpp"],
    ["a.cc", "cpp"],
    ["a.cpp", "cpp"],
    ["a.cxx", "cpp"],
    ["a.hpp", "cpp"],
    ["a.hh", "cpp"],
    ["a.hxx", "cpp"],
    ["a.ipp", "cpp"],
    ["a.tpp", "cpp"],
    ["a.inl", "cpp"],
    ["a.lua", "lua"],
    ["a.rockspec", "lua"],
    ["A.java", "java"],
    ["a.php", "php"],
    ["a.phtml", "php"],
    ["a.rb", "ruby"],
    ["a.rake", "ruby"],
    ["a.gemspec", "ruby"],
    ["config.ru", "ruby"],
    ["a.podspec", "ruby"],
    ["A.cs", "c_sharp"],
    ["a.csx", "c_sharp"],
    ["a.html", "html"],
    ["a.htm", "html"],
    ["a.xhtml", "html"],
    ["A.kt", "kotlin"],
    ["build.gradle.kts", "kotlin"],
    ["A.swift", "swift"],
    ["Makefile", undefined],
    ["Gemfile", undefined],
    ["a.scss", undefined],
    ["a.txt", undefined],
    ["x.TSX", undefined],
  ])("maps %s to %s", (path, id) => {
    expect(grammarOf(path)?.id).toBe(id);
  });

  it("marks the grammars whose block depth is indentation as indentation-sensitive", () => {
    const paths = ["a.ts", "a.tsx", "a.js", "a.py", "a.rs", "a.go", "a.css", "a.md", "a.json"]
      .concat(["a.yaml", "a.toml", "a.sh", "a.c", "a.cpp", "a.lua", "a.java", "a.php", "a.rb"])
      .concat(["a.cs", "a.html", "a.kt", "a.swift"]);

    const sensitive = paths.filter((path) => grammarOf(path)?.indentationSensitive);

    expect(sensitive).toEqual(["a.py", "a.md", "a.yaml"]);
  });
});
