# Development

*Audience: people building, testing, and changing gh-prism on their own machine.*

gh-prism is a Chrome and Firefox extension. This page covers everything past the first
run: the dev browser, the task catalog, tests, the benchmark, git hooks, CI, and patched
dependencies.

## Setup

gh-prism pins its tools with mise, a tool version manager, and its JavaScript packages
with Bun. From a fresh clone, run:

```sh
mise install && mise run setup
```

`mise install` installs the pinned tools, Bun among them, and registers the git hooks.
`mise run setup` then runs `bun install`, whose `postinstall` step downloads the two
grammar files no npm package carries into `.grammars/` (`fetch-grammars` in
[`scripts/tasks/cli.ts`](../scripts/tasks/cli.ts)) and runs `wxt prepare` to generate
WXT's types. Later, `mise run setup` alone is enough: it repeats `mise install` first, so
it also picks up a changed tool pin.

`mise run dev` needs both Chrome and Firefox installed, unless a `web-ext.config.ts` turns
launching off (see [The dev browser](#the-dev-browser)).

## The dev browser

`mise run dev` builds the extension twice, opens one build in Chrome and the other in
Firefox, and reloads both when a file changes. Each browser runs on a dedicated profile,
set in [`wxt.config.ts`](../wxt.config.ts): Chrome at
`~/.local/share/gh-prism-extension/chrome-profile` and Firefox at
`~/.local/share/gh-prism-extension/firefox-profile`. The profiles live outside the
repository, so your GitHub sign-in survives `wxt clean` and is shared by every worktree.
Because every worktree uses the same profiles, only one dev session runs at a time.

If a Chrome or Firefox already has its dev profile open, `mise run dev` names its process
ID and offers to close it before it builds, because neither browser opens a profile twice.
That browser is either another dev session or a dev window an earlier `mise run dev` left
open. `mise run dev --yes` closes it without asking. Without a terminal to ask in, the
task exits instead, unless you pass `--yes`.

To build without opening either browser, create a gitignored `web-ext.config.ts` at the
repository root:

```ts
import { defineWebExtConfig } from "wxt";

export default defineWebExtConfig({ disabled: true });
```

To preview the sidebar's what's-new block, pass release notes into the build:
`WXT_RELEASE_NOTES="$(cat notes.md)" mise run dev`. A fresh install, a dismissal, or a
3-day-old first view hides it. If it doesn't show, run
`chrome.storage.local.remove("whatsNewSeen")` in the extension's service-worker console in
Chrome, or `browser.storage.local.remove("whatsNewSeen")` in the console that gh-prism's
**Inspect** opens in Firefox's `about:debugging`. Then reload a Files view.

## Tasks

`mise tasks` lists every task. Each one is a script in
[`.mise/tasks/`](../.mise/tasks/).

| Task | What it does |
| --- | --- |
| `mise run setup` | Installs the pinned tools and dependencies, and registers the git hooks. |
| `mise run dev [--yes]` | Builds the extension and opens it in the dev Chrome and Firefox profiles, reloading on change; `--yes` closes a Chrome or Firefox already using its profile without asking. |
| `mise run build` | Builds the extension into `.output/chrome-mv3` and `.output/firefox-mv3`, ready to load in Chrome or Firefox. |
| `mise run test [filter] [-w]` | Runs Vitest, only on test files whose path contains `filter`; `-w` reruns on change. |
| `mise run e2e [browser]` | Builds the extension and runs the Playwright smoke suite against it in Chromium and Firefox, or only in `browser`. |
| `mise run bench [--entry-size n]` | Times the diff order, section trees, a sidebar resize, and intent read on large synthetic diffs. |
| `mise run format` | Formats every file. |
| `mise run format-check` | Checks formatting without writing. |
| `mise run lint` | Runs the linters, read-only. |
| `mise run lint-firefox` | Builds the extension and lints the Firefox build with `web-ext lint`, the linter AMO runs on every upload. |
| `mise run preflight` | Runs `format-check`, `lint`, and `test`; run it before you push. |
| `mise run release <patch\|minor\|major> [--notes-file <path>]`, `mise run release --firefox-only <version> [--notes-file <path>]` | Dispatches the release workflow on main, or a Firefox-only re-run of an existing version; see [Releases](#releases). |

## Tests

Unit tests use Vitest with happy-dom as the DOM. They live in `tests/`, mirroring the
source tree, and read HTML fixtures from `tests/fixtures/`. Run them with `mise run test`.

End-to-end tests use Playwright. They live in `e2e/` as `*.e2e.ts` files, so Vitest does
not collect them. `mise run e2e` builds `.output/chrome-mv3` and `.output/firefox-mv3`,
installs Chromium and Firefox, and runs the one suite once per browser, as the `chromium`
and `firefox` projects. `mise run e2e firefox` runs one browser. Firefox loads the add-on
as a temporary add-on through playwright-webextext. A test skips in Firefox only for a
harness limit, something Playwright can't reach in Firefox. Two limits skip four tests.
Playwright's Firefox exposes no service worker, so the tests that read gh-prism's session
rules or seed its intent cache skip. It also can't route an add-on's background fetch, so
the two commit tests that route the commit's `.diff` skip. Firefox sends those background
fetches to a proxy on a port nothing listens on, so they fail at once instead of reaching
the real github.com. Every other Firefox failure is fixed, never skipped. The smoke suite
routes GitHub pages to local fixtures, so it needs no sign-in, and neither run needs the
network.

The rules for writing tests are in
[`docs/agents/testing-rules.md`](agents/testing-rules.md).

## Benchmark

`mise run bench` times the real diff order, section trees, and intent read in headless
Chromium on synthetic diffs of 100, 300, and 1,000 files. Its resize case narrows the
sidebar 20 times, one step per frame, and reports each step's p50 and p95 time, folder
chain refits included. `--entry-size n` sets how many elements each synthetic diff entry
has, its wrapper included; the default is 95. The benchmark lives in `bench/` and runs
outside CI, Vitest, and Playwright, beside `bench/bundle.ts`, the bundler it shares with
the structural painter's e2e spec.

`bun bench/structural-live.ts --browser <chromium|firefox> --state <path> [--url <url>]`
runs the structural painter on live GitHub and checks that it leaves the accessibility
tree, copy, find, line selection, comments, and replies alone. It needs a signed-in
Playwright `storageState` file. The default URL is sandbox PR #3 in Split and runs every
check; another `--url` paints, counts, and stops. It opens comment and reply forms and
cancels them, never submitting one. Its last line reads `parity: all checks passed` when
every check ran, and `parity: <N> checks passed, <M> not driven` otherwise.

`bun bench/structural-host.ts <chromium|firefox>` benches the structural engine's host in
the built extension: that the engine loads only on first use, a cold and a warm run, how
long a PR data port message waits while a run is in flight (at most 25 ms), that a run
succeeds after the background restarts, and that the engine's context is gone after 35
idle seconds. In Chromium it also checks that the `offscreen` permission adds no install
warning. It builds a scratch copy of the working tree with `bench/scratch-build.ts`,
adding a test-only background addition and a relay content script, prints one JSON object,
and exits 1 when a check fails. Like the rest of `bench/`, it stays out of CI.
`bench/structural-host/results/*.json` hold one run per browser, written by
`bun bench/structural-host.ts chromium > bench/structural-host/results/chromium.json` (and
likewise for `firefox`); they are a dated record, not a baseline anything compares
against.

`bun bench/structural-caps.ts <chromium|firefox>` benches the structural engine's caps in
the built extension, through the same scratch copy as `bench/structural-host.ts`. Its
samples are every fixture pair under `tests/fixtures/structural/`, the 40 largest changed
TypeScript, JavaScript, and Python files of nodejs/node#66212 (read with `gh` and raw
GitHub URLs, never stored), a size ladder of a TypeScript and a Python file repeated to
50,000 through 300,000 UTF-16 units, and two unrelated sides of 1,000, 2,000, and 3,000
tokens. Each sample runs 20 times at `DEFAULT_LIMITS`, counted by outcome, and 5 times
with every cap lifted, beside 5 identical-sides runs that time the parses alone; it
reports each side's text length and tokens, the parse time per side, and the diff stage's
time. In Chromium it also reports the offscreen document's JS heap. It prints one JSON
object and exits 1 when a sample within the size caps answers `too-slow`, which holds only
on a quiet machine. `bench/structural-caps/results/*.json` hold a quiet and a loaded
(`<browser>-loaded.json`) run per browser; they are a dated record, not a baseline.

`bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]` checks
Structural mode in the built extension on live GitHub. It needs a signed-in Playwright
`storageState` file; the default URLs are sandbox PRs #3 and #4 and two sandbox commits,
all in Split. It builds a scratch copy with `bench/scratch-build.ts`, adding a bench-only
content script that sets and reads the preference and asks the port for a file's answer.
It runs five passes: with the preference off, no URL shows any structural trace, notices
included; on the pairing pull request,
<https://github.com/macintacos/gh-prism-sandbox/pull/11>, which runs whatever URLs you
pass, new line 138 sits opposite old line 121 in one added row with no numbered filler,
Split restores GitHub's row count, and an expanded hunk re-pairs the block once; with the
preference on, each on-screen file is painted or skipped for a reason, and an unsupported
file shows its notice and a painted one none; choosing Unified from the gear turns the
preference off; and the diff view control drives both. The Unified pass changes the
signed-in account's saved Layout, then chooses the original again before the run ends, on
failure too; `bun bench/structural-mode-live/restore-check.ts` proves that restore
offline. It prints one line per check, ends the second pass with `mismatch: <n> of <m>`,
and exits 1 when a check fails. `bench/structural-mode-live/results/*.txt` hold one run
per browser, written by
`bun bench/structural-mode-live.ts chromium <path> > bench/structural-mode-live/results/chromium.txt`
(and likewise for `firefox`); they are a dated record, not a baseline. Its diff view
control pass ends each URL with a round trip from Unified through Structural, Unified, and
Split, checking the gear's Layout and the count of `POST /users/diffview` after each
press.

`bun bench/structural-parity-live.ts <chromium|firefox> <storage-state path> [--trunk <built extension directory>]`
runs Structural mode's parity checklist in the built extension on live GitHub: sandbox
pull requests 3 and 4, the two sandbox commits, a gh-prism-extension commit's line link,
the codeowners sandbox's large pull request, and nodejs/node#66212, where it only reads,
scrolls, and loads diffs. Its strongest check compares a page signature (each diff table's
markup without the painter's attributes, the sidebar's text, the file order, each file
header's controls, and one table's accessibility tree) with Split and with Structural;
with `--trunk`, it also compares this checkout's build, mode off, against a build of
`main`. It opens comment, reply, and suggestion forms and cancels each; it starts a review
and discards it; it resolves and unresolves the sandbox thread, marks a file Viewed and
unmarks it, and restores the account's Layout, all in a `finally`. That cleanup reverts
only what the run changed: through `gh api` it deletes only pending reviews the run
created and reopens only threads the run resolved, leaving earlier ones alone. It stops
before any check when `gh` is signed in to an account other than the storage state's. It
prints one line per check, `<id> <name>: ok`, `: FAILED <what was seen>`, or
`: not driven (<reason>)`, ends with `parity: <N> ok, <F> failed, <M> not driven`, and
exits 1 when F is not 0. Lines `L`, `M`, and `N` report measurements and count in no
tally. `bench/structural-parity-live/results/*.txt` hold one run per browser, a dated
record.

`bun bench/structural-perf-live.ts <chromium|firefox> <storage-state path> [--runs <n>] [--url <url>] [--start <file path>] [--label <text>] [--trunk <built extension directory>]`
times a signed-in page, nodejs/node#66212 by default, over 5 runs by default. Each run
loads the page once per variant, each in a fresh profile, rotating the order from run to
run: `trunk` (the `--trunk` build of `main`, skipped without it), `mode-off`, and
`mode-on` (both this checkout's `.output/<browser>-mv3`, found beside the bench). Every
variant first opens sandbox PR #4, so all start from the same warmed cache; there
`mode-on` also presses Structural so the profile saves it. It measures navigation to the
first diff table and, on a pull request, load until the diff list stays unchanged for 2 s
(`n/a` on any other page, whose load bar is skipped); a load that does not settle within
120 s fails the run. GitHub mounts files only as you scroll, so it then scrolls untimed
until the `--start` file mounts and puts it at the top: by default
`deps/npm/tap-snapshots/test/lib/cli/exit-handler.js.test.cjs`, which opens the default
page's longest run of modified JavaScript, since its first stretch holds only files
without a grammar; any other `--url` starts at the top. From there it times frame deltas
while scrolling at 3,000 px/s for at most 20 s, and counts page errors and, for `mode-on`,
painted files and notices. It prints `--label`'s text first, `uptime` before and after, a
table of medians, and one `bar <name>: ok` or `: FAILED` line per bar, `mode-on` against
`mode-off` and `mode-off` against `trunk`: median load at most the baseline's plus max(100
ms, 5%), scroll p95 at most plus 2 ms, frames over 16.7 ms at most plus 2 points, and no
page error with this checkout's build; and `mode-on painted`, which fails when the median
`mode-on` run painted no file. Beside each load bar, a `paired` line gives the median of
each run's own difference; it decides nothing. It exits 1 when a bar fails. A timing bar
that fails over 5 runs is rerun once with `--runs 9`, which decides. Headless frame timing
differs from a real device's, equally for every variant.
`bench/structural-perf-live/results/*.txt` are a dated record per browser of up to three
blocks: a 5-run on nodejs/node#66212; a 9-run rerun when a timing bar failed there, which
then decides; and one run on a large virtualized commit page.

## Sandbox repositories

`scripts/create-sandbox.sh <owner>/<repo>` creates a private repository under an account
you control, with ten open pull requests. Small, large, and complicated survey GitHub's
Files view on pull requests you own. Four more, one per comment syntax (Python, C-like,
Go, and Lua), mix code with comment and docstring lines. Two more add files with long
paths and a long file name, for checking how the comment-lines sub-section's tree and
Implementation show them. The bodies of these six list the counts gh-prism should show for
Implementation, Tests, and Docs & Comments, worked out by hand, so you can check them
against the sidebar in either dev browser. The tenth, structural pairing, changes one
Python file whose changed blocks GitHub pairs line by line from the top; its body lists
the rows Structural mode should show in Split instead. On `macintacos/gh-prism-sandbox` it
is <https://github.com/macintacos/gh-prism-sandbox/pull/11>, a number the live check and
the pairing fixture hard-code. It needs the `gh` CLI signed in. It skips the repository
and each pull request that already exists, so a rerun picks up where it left off. A pull
request that failed midway is the exception: fix it by hand.

`scripts/create-codeowners-sandbox.sh excessive-dev/gh-prism-codeowners-sandbox` creates
the code-owners sandbox, a public repository under the `excessive-dev` organization. It is
public and org-owned because team entries in CODEOWNERS only resolve in an organization's
repository, and GitHub Free applies code owners only to public repositories. It has two
teams with write access: `frontend`, whose only member is you, and `platform`, which has
no members. The CODEOWNERS on `main` has a path for each case: one team, your account, a
team and you, a later rule overriding an earlier one, and no owner. Three pull requests
cover every case. One edits CODEOWNERS in its own diff, and one is large enough that
GitHub loads its diffs lazily. Their bodies list each file's owners and what "Only files
owned by…" should list. GitHub keeps a request to a team whose only member is the pull
request's author, so on your own pull requests `frontend` still shows as requested.

Commits use your GitHub noreply address. Creating the teams needs the `admin:org` scope,
so run `gh auth refresh -s admin:org` first and drop it afterwards with
`gh auth refresh -r admin:org`. The script pushes through git, so a git credential helper
without access to the organization makes the pushes fail; `gh auth setup-git` fixes that.
A rerun skips the repository, the teams, and each pull request that already exists, and
brings each body up to date.

## Git hooks

hk, a git hook manager configured in [`hk.pkl`](../hk.pkl), runs two hooks:

- **pre-commit** formats and lints the staged files, so every commit stays formatted and
  clean. When a workflow or the lockfile is staged, it also runs
  `gh actions-lock --verify-local`, which fails when a `uses:` line has no lockfile entry.
- **pre-push** runs `mise run test` when a pushed change touches TypeScript, JavaScript,
  `package.json`, or `bun.lock`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull
request, as three jobs, and `e2e` fans out to one job per browser. `check` and `e2e`
install the pinned tools and dependencies and cache bun's package cache, keyed on
`bun.lock`. `check` runs `mise run preflight` then `mise run lint-firefox`. `e2e` runs as
`e2e (chromium)` and `e2e (firefox)`, each with `mise run e2e <browser>`, and each caches
only its own Playwright browser, keyed on the browser and `bun.lock`. Both e2e jobs skip
`playwright install-deps`: the runner image already has Chromium's and Firefox's system
libraries, and that step's apt downloads sometimes stall for minutes.

The third, `lockfile`, runs `gh actions-lock --verify`. The workflows reference actions by
tag, and [`.github/workflows/actions.lock`](../.github/workflows/actions.lock) pins each
tag to a commit, which is what the runner executes. After you add or change a `uses:`
line, run `gh actions-lock` to update the lockfile. It needs the
[gh-actions-lock](https://github.com/github/gh-actions-lock) extension:
`gh extension install github/gh-actions-lock`.

## Releases

In Claude Code, run `/release-gh-prism [patch|minor|major]`. The skill computes the next
version, writes the release notes, asks you once to confirm both, then runs the release
below and reports the GitHub Release.

`mise run release <bump> [--notes-file <path>]` runs `gh workflow run` on
[`.github/workflows/release.yml`](../.github/workflows/release.yml). On main, the workflow
runs these steps in order:

1. Check the stores. It stops when a store secret is missing, naming each one, or when AMO
   refuses the Firefox credentials or has no gh-prism listing yet.
2. Run `preflight`, then bump `package.json`'s version.
3. Resolve the release notes: the notes file, or GitHub's generated notes when you pass
   none.
4. Zip the extension for Chrome and for Firefox with those notes inside, so the sidebar
   can show them under "What's new". The Firefox zip comes with a sources zip, which AMO
   reviewers build from.
5. Check the sources zip. It unzips the sources zip, rebuilds the extension from it, and
   fails unless the result matches `.output/firefox-mv3`.
6. Commit `chore: bump version to X.Y.Z` to main through GitHub's API so GitHub signs it,
   and tag it `vX.Y.Z`.
7. Submit the Chrome zip to the Chrome Web Store with `wxt submit`.
8. Submit the Firefox zip and its sources zip to AMO (addons.mozilla.org) with
   `wxt submit`, as a listed version, which AMO reviews and shows on the add-on's public
   page.
9. Create the `vX.Y.Z` GitHub Release with the same notes as its body. A failed submit
   stops the run first, so the Release exists only when both stores took the version.

When the Chrome submit went through but the AMO submit failed, finish that version with a
Firefox-only re-run: `mise run release --firefox-only <version> --notes-file <path>`. It
checks out `v<version>` and skips the bump, the commit and tag, and the Chrome submit. It
still runs preflight and checks the sources zip. It fails early, at "Check the stores",
when AMO already has that version. Pass the same notes file, so the Firefox build and the
Release carry the notes Chrome shipped. If AMO took the version before the submit failed,
the re-run stops there, so create the Release by hand:
`gh release create v<version> --verify-tag --notes-file <path>`.

Only the repository owner can run it. It uses the `chrome-web-store` environment, which
allows only main and holds six secrets: `CHROME_EXTENSION_ID`, `CHROME_PUBLISHER_ID`,
`CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL`, `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`,
`FIREFOX_JWT_ISSUER`, and `FIREFOX_JWT_SECRET`. The workflow uses the Chrome Web Store's
v2 API with a Google Cloud service account, and AMO's API with the two Firefox keys.

To rotate the Chrome key, create a new JSON key for the service account in Google Cloud,
set `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` in the environment to its `private_key`, then
delete the old key.

## Patched dependencies

Five dependencies carry local patches in [`patches/`](../patches/), which Bun applies on
install through `patchedDependencies` in [`package.json`](../package.json):

- `@pierre/trees` adds a row decoration's title to the row's accessible label, and renders
  a checkbox beside a row whose decoration asks for one, and a code owners shield on a row
  whose decoration asks for one (over a file's icon, at a folder row's end). It also
  renders a flattened row's folders as whole units around a hidden `…`, and gives every
  row an `aria-hidden` copy of its full name. It parses icon sprite sheets and the header
  slot's markup with `DOMParser`, not `innerHTML`, which AMO's linter flags. It passes the
  focused row's guide style to its `<style>` as text, not through
  `dangerouslySetInnerHTML`, which the `preact` patch below makes render nothing.
- `mdast-util-from-markdown` binds micromark's document tokenizer to a local before
  calling its `write`. AMO's linter flags any `.write()` call whose object's source text
  contains `document`, so it reads `parse(options).document().write(…)` as a DOM
  `document.write`; the local's name must not contain `document` either. After upgrading
  the package, regenerating its patch, or changing the bundler, check that
  `mise run lint-firefox` reports no `document().write` warning. Drop the patch once the
  package stops chaining `.document().write(…)`.
- `preact` drops its diff's `dangerouslySetInnerHTML` branch and the `innerHTML = ""`
  clear before the children diff, so the children diff always runs and the prop renders
  nothing; nothing in the bundle may pass it. AMO's linter flags that branch's `innerHTML`
  assignment whether or not anything passes the prop. The patch edits only
  `dist/preact.mjs`, the build the bundler imports. After upgrading Preact or
  `@pierre/trees`, regenerating the patch, or changing the bundler, check that
  `tests/patches.test.ts` passes and that `mise run lint-firefox` reports no
  `Unsafe assignment to innerHTML` warning. Drop the patch once nothing in the bundle
  imports Preact.
- `web-tree-sitter` replaces its loader's two `eval` calls with a throw. They run only for
  a grammar that exports `EM_ASM` or `EM_JS` code, which none of the grammars gh-prism
  ships does, and AMO's linter flags them (`DANGEROUS_EVAL`) whether or not they run.
  After upgrading the package or a grammar, or regenerating the patch, check that
  `tests/patches.test.ts` passes and that `mise run lint-firefox` reports no
  `DANGEROUS_EVAL` warning. Drop the patch once the package stops calling `eval`.
- `wxt` escapes the entrypoint path in a regular expression, so a checkout whose path
  holds a character such as `+` still builds.

A patch is pinned to one exact version. When you upgrade a patched dependency, regenerate
its patch with `bun patch`, or drop the patch once upstream fixes the issue. Bun's
isolated linker trips on `bun patch --commit`: it leaves `node_modules/<pkg>` a real
directory, so the package's own dependencies stop resolving, and it adds a `.bun-tag-*`
file to the patch. Delete that file's hunk from the patch, then run
`rm -rf node_modules/<pkg> && bun install` to restore the isolated layout.

`tslib` is a devDependency only because playwright-webextext 0.0.5 requires it at runtime
without declaring it; drop it once playwright-webextext declares it.

[`wxt.config.ts`](../wxt.config.ts) aliases `decode-named-character-reference` to its
non-DOM `index.js`, because the entry its `browser` condition picks decodes by assigning
`innerHTML`, which AMO flags. The alias resolves the package from
`mdast-util-from-markdown` and sends every importer to that copy. If an upgrade makes the
build fail with `Cannot find module 'decode-named-character-reference'`, resolve it from
another package that imports it. Drop the alias once that `browser` entry stops assigning
`innerHTML`, or once nothing in the bundle imports the package.
