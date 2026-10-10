import { describe, expect, it } from "vitest";
import type { SectionKey } from "../utils/sections";
import { classify, SECTIONS } from "../utils/sections";

const cases: Record<SectionKey, string[]> = {
  generated: [
    "package-lock.json",
    "tests/fixtures/package-lock.json",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "yarn.lock",
    "go.sum",
    "nvim-pack-lock.json",
    ".github/flake.lock",
  ],
  tests: [
    "tests/fixtures/data.json",
    "tests/README.md",
    "lua/plugins/test/init.lua",
    "spec/models/user.rb",
    "src/__tests__/a.js",
    "pkg/testdata/in.txt",
    "auth_spec.lua",
    "auth_test.go",
    "auth.test.ts",
    "auth.spec.ts",
    "test_auth.py",
    "conftest.py",
    "run.bats",
  ],
  docs: [
    "README.md",
    "README",
    "CHANGELOG",
    "guide.mdx",
    "index.rst",
    "nested/dir/notes.md",
    "docs/usage.txt",
    "doc/help.txt",
    ".github/CONTRIBUTING.md",
  ],
  config: [
    "a.toml",
    "a.yaml",
    "a.yml",
    "hk.pkl",
    "a.json",
    "setup.cfg",
    "tox.ini",
    ".gitignore",
    ".editorconfig",
    ".github/workflows/ci.yml",
    ".github/CODEOWNERS",
    "Makefile",
    "Dockerfile",
    "go.mod",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "tsconfig.json",
    "lock.json",
  ],
  implementation: [
    "plugin/lsp.lua",
    ".mise/tasks/test",
    "lua/plugins/changeset/init.lua",
    "notes.txt",
    ".github/scripts/a.sh",
    ".github/scripts/a.bash",
    ".github/scripts/a.py",
    ".github/scripts/a.js",
    ".github/scripts/a.ts",
    ".github/scripts/a.rs",
    ".github/scripts/a.go",
    ".github/scripts/a.lua",
    "a.json5",
    "notes.md.orig",
    "latest.ts",
    "contest.py",
    "testing/a.lua",
    "mydocs/a.txt",
  ],
};

describe("classify", () => {
  for (const [section, paths] of Object.entries(cases)) {
    it.each(paths)(`puts %s in ${section}`, (path) => expect(classify(path)).toBe(section));
  }

  it.each(["tests/a_spec.lua", "README.md", "api.go"])("puts flagged %s in generated", (path) =>
    expect(classify(path, true)).toBe("generated"),
  );

  it("leaves an unflagged source file in implementation", () => {
    expect(classify("api.go", false)).toBe("implementation");
  });
});

describe("SECTIONS", () => {
  it("lists sections in sidebar display order", () => {
    expect(SECTIONS.map((s) => s.label)).toEqual([
      "Implementation",
      "Tests",
      "Documentation",
      "Config",
      "Generated / lockfiles",
    ]);
  });
});
