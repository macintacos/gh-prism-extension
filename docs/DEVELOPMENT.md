# Development

*Audience: people building, testing, and changing gh-prism on their own machine.*

This page covers everything past the first run: the dev browser, the task catalog, tests,
the benchmark, git hooks, CI, and patched dependencies.

## Setup

gh-prism pins its tools with mise, a tool version manager, and its JavaScript packages
with Bun. From a fresh clone, run:

```sh
mise install && mise run setup
```

`mise install` installs the pinned tools, Bun among them, and registers the git hooks.
`mise run setup` then runs `bun install`, whose `postinstall` step runs `wxt prepare` to
generate WXT's types. Later, `mise run setup` alone is enough: it repeats `mise install`
first, so it also picks up a changed tool pin.

## The dev browser

`mise run dev` builds the extension, opens it in Chrome, and reloads it when a file
changes. Chrome runs on a dedicated profile at
`~/.local/share/gh-prism-extension/chrome-profile`, set in
[`wxt.config.ts`](../wxt.config.ts). The profile lives outside the repository, so your
GitHub sign-in survives `wxt clean` and is shared by every worktree. Because every
worktree uses the same profile, only one dev session runs at a time.

## Tasks

`mise tasks` lists every task. Each one is a script in
[`.mise/tasks/`](../.mise/tasks/).

| Task | What it does |
| --- | --- |
| `mise run setup` | Installs the pinned tools and dependencies, and registers the git hooks. |
| `mise run dev` | Builds the extension and opens it in the dev profile, reloading on change. |
| `mise run test [filter] [-w]` | Runs Vitest, only on test files whose path contains `filter`; `-w` reruns on change. |
| `mise run e2e` | Builds the extension and runs the Playwright smoke suite against it. |
| `mise run bench [--entry-size n]` | Times the diff order, section trees, and intent read on large synthetic diffs. |
| `mise run format` | Formats every file. |
| `mise run format-check` | Checks formatting without writing. |
| `mise run lint` | Runs the linters, read-only. |
| `mise run preflight` | Runs `format-check`, `lint`, and `test`; run it before you push. |

## Tests

Unit tests use Vitest with happy-dom as the DOM. They live in `tests/`, mirroring the
source tree, and read HTML fixtures from `tests/fixtures/`. Run them with `mise run test`.

End-to-end tests use Playwright. They live in `e2e/` as `*.e2e.ts` files, so Vitest does
not collect them. `mise run e2e` builds the extension into `.output/chrome-mv3`, installs
Chromium, and loads the extension there. The smoke suite routes GitHub URLs to local
fixtures, so it needs no network or sign-in.

The rules for writing tests are in
[`docs/agents/testing-rules.md`](agents/testing-rules.md).

## Benchmark

`mise run bench` times the real diff order, section trees, and intent read in headless
Chromium on synthetic diffs of 100, 300, and 1,000 files. `--entry-size n` sets how many
elements each synthetic diff entry has, its wrapper included; the default is 95. The
benchmark lives in `bench/` and runs outside CI, Vitest, and Playwright.

## A sandbox repository

`scripts/create-sandbox.sh <owner>/<repo>` creates a private repository under an account
you control, with three open pull requests: small, large, and complicated. Use it to
survey GitHub's Files view on pull requests you own. It needs the `gh` CLI signed in. It
skips the repository and each pull request that already exists, so a rerun picks up where
it left off. A pull request that failed midway is the exception: fix it by hand.

## Git hooks

hk, a git hook manager configured in [`hk.pkl`](../hk.pkl), runs two hooks:

- **pre-commit** formats and lints the staged files, so every commit stays formatted and
  clean.
- **pre-push** runs `mise run test` when a pushed change touches TypeScript, JavaScript,
  `package.json`, or `bun.lock`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull
request. It installs the pinned tools and dependencies, runs `mise run preflight`, builds
the extension, then runs `mise run e2e`.

## Patched dependencies

Two dependencies carry local patches in [`patches/`](../patches/), which Bun applies on
install through `patchedDependencies` in [`package.json`](../package.json):

- `@pierre/trees` adds a row decoration's title to the row's accessible label.
- `wxt` escapes the entrypoint path in a regular expression, so a checkout whose path
  holds a character such as `+` still builds.

A patch is pinned to one exact version. When you upgrade a patched dependency, regenerate
its patch with `bun patch`, or drop the patch once upstream fixes the issue.
