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

To preview the sidebar's what's-new block, pass release notes into the build:
`WXT_RELEASE_NOTES="$(cat notes.md)" mise run dev`. A fresh install, a dismissal, or a
3-day-old first view hides it. If it doesn't show, run
`chrome.storage.local.remove("whatsNewSeen")` in the extension's service-worker console,
then reload a Files view.

## Tasks

`mise tasks` lists every task. Each one is a script in
[`.mise/tasks/`](../.mise/tasks/).

| Task | What it does |
| --- | --- |
| `mise run setup` | Installs the pinned tools and dependencies, and registers the git hooks. |
| `mise run dev` | Builds the extension and opens it in the dev profile, reloading on change. |
| `mise run build` | Builds the extension into `.output/chrome-mv3`, ready for Chrome's **Load unpacked**. |
| `mise run test [filter] [-w]` | Runs Vitest, only on test files whose path contains `filter`; `-w` reruns on change. |
| `mise run e2e` | Builds the extension and runs the Playwright smoke suite against it. |
| `mise run bench [--entry-size n]` | Times the diff order, section trees, a sidebar resize, and intent read on large synthetic diffs. |
| `mise run format` | Formats every file. |
| `mise run format-check` | Checks formatting without writing. |
| `mise run lint` | Runs the linters, read-only. |
| `mise run preflight` | Runs `format-check`, `lint`, and `test`; run it before you push. |
| `mise run release <patch\|minor\|major> [--notes-file <path>]` | Dispatches the release workflow on trunk; see [Releases](#releases). |

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
Chromium on synthetic diffs of 100, 300, and 1,000 files. Its resize case narrows the
sidebar 20 times, one step per frame, and reports each step's p50 and p95 time, folder
chain refits included. `--entry-size n` sets how many elements each synthetic diff entry
has, its wrapper included; the default is 95. The benchmark lives in `bench/` and runs
outside CI, Vitest, and Playwright.

## A sandbox repository

`scripts/create-sandbox.sh <owner>/<repo>` creates a private repository under an account
you control, with nine open pull requests. Small, large, and complicated survey GitHub's
Files view on pull requests you own. Four more, one per comment syntax (Python, C-like,
Go, and Lua), mix code with comment and docstring lines. The last two add files with long
paths and a long file name, for checking how the comment-lines sub-section's tree and
Implementation show them. The bodies of these six list the counts gh-prism should show for
Implementation, Tests, and Docs & Comments, worked out by hand, so you can check them
against the sidebar. It needs the `gh` CLI signed in. It skips the repository and each
pull request that already exists, so a rerun picks up where it left off. A pull request
that failed midway is the exception: fix it by hand.

## Git hooks

hk, a git hook manager configured in [`hk.pkl`](../hk.pkl), runs two hooks:

- **pre-commit** formats and lints the staged files, so every commit stays formatted and
  clean.
- **pre-push** runs `mise run test` when a pushed change touches TypeScript, JavaScript,
  `package.json`, or `bun.lock`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull
request, as two parallel jobs that each install the pinned tools and dependencies: `check`
runs `mise run preflight`, and `e2e` runs `mise run e2e`. Both cache bun's package cache,
and `e2e` also caches Playwright's browsers, each keyed on `bun.lock`.

## Releases

In Claude Code, run `/release-gh-prism [patch|minor|major]`. The skill computes the next
version, writes the release notes, asks you once to confirm both, then runs the release
below and reports the GitHub Release.

`mise run release <bump> [--notes-file <path>]` runs `gh workflow run` on
[`.github/workflows/release.yml`](../.github/workflows/release.yml). On trunk, the
workflow runs `preflight` and bumps `package.json`'s version. It then resolves the release
notes: the notes file, or GitHub's generated notes when you pass none. It zips the
extension with those notes inside, so the sidebar can show them under "What's new". It
commits `chore: bump version to X.Y.Z` to trunk through GitHub's API so GitHub signs it,
tags it `vX.Y.Z`, then submits the zip to the Chrome Web Store with `wxt submit`. Last, it
creates the `vX.Y.Z` GitHub Release with the same notes as its body.

Only the repository owner can run it. It uses the `chrome-web-store` environment, which
allows only trunk and holds four secrets: `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`,
`CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, and `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`. The
workflow uses the store's v2 API with a Google Cloud service account.

To rotate the key, create a new JSON key for the service account in Google Cloud, set
`CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` in the environment to its `private_key`, then delete
the old key.

## Patched dependencies

Two dependencies carry local patches in [`patches/`](../patches/), which Bun applies on
install through `patchedDependencies` in [`package.json`](../package.json):

- `@pierre/trees` adds a row decoration's title to the row's accessible label, and renders
  a checkbox beside a row whose decoration asks for one. It also renders a flattened row's
  folders as whole units around a hidden `…`, and gives every row an `aria-hidden` copy of
  its full name.
- `wxt` escapes the entrypoint path in a regular expression, so a checkout whose path
  holds a character such as `+` still builds.

A patch is pinned to one exact version. When you upgrade a patched dependency, regenerate
its patch with `bun patch`, or drop the patch once upstream fixes the issue. Bun's
isolated linker trips on `bun patch --commit`: it leaves `node_modules/<pkg>` a real
directory, so the package's own dependencies stop resolving, and it adds a `.bun-tag-*`
file to the patch. Delete that file's hunk from the patch, then run
`rm -rf node_modules/<pkg> && bun install` to restore the link.
