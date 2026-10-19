/**
 * Path rules ported from changeset.nvim's `lua/changeset/sections.lua` at
 * macintacos/changeset.nvim@2b6115db3a5394a207836afdeaa8237225b8de93 — the glob strings are
 * copied verbatim, plus the `e2e` test dir, `*.e2e.*` test files, and `*.config.*` tool configs
 * such as `vite.config.ts`, so diff that file against this one when syncing. Upstream's labels
 * and icons are not ported; this sidebar's own live in `entrypoints/content/ui/section-catalog.ts`.
 * Upstream's `test_rule` is ported in `utils/hunk-rules/inline-tests.ts`.
 */

/** The sidebar's sections, in display order. */
export const SECTIONS = ["implementation", "tests", "docs", "config", "generated"] as const;

/** Names one of the sidebar's sections, in the order {@link SECTIONS} lists them. */
export type SectionKey = (typeof SECTIONS)[number];

const GENERATED_FILES = glob("{*.lock,*-lock.json,*-lock.yaml,go.sum}");
const TEST_DIRS = new Set(["tests", "test", "spec", "__tests__", "testdata", "e2e"]);
const TEST_FILES = glob(
  "{*_spec.*,*_test.*,*.test.*,*.spec.*,*.e2e.*,test_*.py,conftest.py,*.bats}",
);
const DOC_FILES = glob("{*.md,*.mdx,*.rst,README*,CHANGELOG*}");
const DOC_DIRS = new Set(["doc", "docs"]);
const CONFIG_FILES = glob(
  "{*.toml,*.yaml,*.yml,*.pkl,*.json,*.ini,*.cfg,*.config.*,.*,Makefile,Dockerfile,go.mod}",
);
const CONFIG_DIRS = new Set([".github"]);
const SCRIPT_FILES = glob("{*.sh,*.bash,*.py,*.js,*.ts,*.rs,*.go,*.lua}");

/**
 * The section a changed file belongs in, from its repo-relative `/`-separated path.
 * Generated wins, then Tests, Docs & Comments and Config in that order; anything unmatched is
 * Implementation.
 *
 * @param generated - Whether the file is known to be generated, e.g. from a
 *   `linguist-generated` attribute or a Go `// Code generated … DO NOT EDIT.` header;
 *   `classify` reads only the path.
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

// ponytail: accepts only upstream's `{a,b}` form with `*`, and throws on anything else.
function glob(pattern: string): RegExp {
  const body = /^\{([^{}?[\]]*)\}$/.exec(pattern)?.[1];
  if (body === undefined) throw new Error(`Unsupported glob: ${pattern}`);
  const alternatives = body
    .split(",")
    .map((alt) => alt.replace(/[.+?^$()|[\]\\]/g, "\\$&").replaceAll("*", ".*"));
  return new RegExp(`^(?:${alternatives.join("|")})$`, "s");
}
