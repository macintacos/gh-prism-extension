/**
 * Path rules ported from changeset.nvim's `lua/changeset/sections.lua` at
 * macintacos/changeset.nvim@2b6115db3a5394a207836afdeaa8237225b8de93 — the glob strings are
 * copied verbatim, so diff that file against this one when syncing.
 */

export const SECTIONS = [
  { key: "implementation", label: "Implementation" },
  { key: "tests", label: "Tests" },
  { key: "docs", label: "Documentation" },
  { key: "config", label: "Config" },
  { key: "generated", label: "Generated / lockfiles" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

const GENERATED_FILES = glob("{*.lock,*-lock.json,*-lock.yaml,go.sum}");
const TEST_DIRS = new Set(["tests", "test", "spec", "__tests__", "testdata"]);
const TEST_FILES = glob("{*_spec.*,*_test.*,*.test.*,*.spec.*,test_*.py,conftest.py,*.bats}");
const DOC_FILES = glob("{*.md,*.mdx,*.rst,README*,CHANGELOG*}");
const DOC_DIRS = new Set(["doc", "docs"]);
const CONFIG_FILES = glob(
  "{*.toml,*.yaml,*.yml,*.pkl,*.json,*.ini,*.cfg,.*,Makefile,Dockerfile,go.mod}",
);
const CONFIG_DIRS = new Set([".github"]);
const SCRIPT_FILES = glob("{*.sh,*.bash,*.py,*.js,*.ts,*.rs,*.go,*.lua}");

/**
 * The section a changed file belongs in, from its repo-relative `/`-separated path.
 *
 * @param generated - Whether the caller knows the file is generated. Upstream also
 *   reads a Go `// Code generated` header, which needs file contents and isn't ported.
 */
export function classify(path: string, generated = false): SectionKey {
  const dirs = path.split("/").slice(0, -1);
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (generated || GENERATED_FILES.test(name)) return "generated";
  if (hasDir(dirs, TEST_DIRS) || TEST_FILES.test(name)) return "tests";
  if (DOC_FILES.test(name) || (name.endsWith(".txt") && hasDir(dirs, DOC_DIRS))) return "docs";
  if (CONFIG_FILES.test(name) || (hasDir(dirs, CONFIG_DIRS) && !SCRIPT_FILES.test(name))) {
    return "config";
  }
  return "implementation";
}

function hasDir(dirs: readonly string[], names: ReadonlySet<string>): boolean {
  return dirs.some((dir) => names.has(dir));
}

// ponytail: handles only the `{a,b}` and `*` syntax upstream's globs use; extend if a sync adds more.
function glob(pattern: string): RegExp {
  const alternatives = pattern
    .slice(1, -1)
    .split(",")
    .map((alt) => alt.replace(/[.+?^$()|[\]\\]/g, "\\$&").replaceAll("*", ".*"));
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}
