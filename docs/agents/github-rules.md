# GitHub Rules

*Audience: coding agents changing how gh-prism reads or reshapes GitHub's pages, and the
people who maintain these rules.*

These rules govern
[`entrypoints/content/files-page.ts`](../../entrypoints/content/files-page.ts), every
sheet's `GitHub hooks:` header, `entrypoints/content/diffs/`,
`entrypoints/content/visit/`, and `utils/github/`.
**GitHub selectors live only in `files-page.ts` and in sheets' `GitHub hooks:` headers.**
GitHub changes its markup without notice, so keeping its selectors in one seam keeps a
breakage to one place to fix. The one exception is
[`utils/github/pr-ref.ts`](../../utils/github/pr-ref.ts), which keeps its own selector for
the page's embedded data. **A new page kind (pull request, commit) is a new entry in
`PAGE_KINDS` in `files-page.ts`, not a branch on kind** elsewhere in the code. Features
read each kind's selectors from that table, so a new kind touches one place. Each section
below states facts about GitHub that held when written, and ends with how to re-check
them; [§ Re-checking GitHub](#re-checking-github) has the methods.

## Class names

- **Match GitHub's app CSS-module classes by local name: `[class*="localName__"]`.** The
  modules emit `localName__hash` (`rightContentWrapper__DE7XPN`), and the hash changes
  with GitHub's builds. Some local names are shared by several modules (`toolbar__`), so
  pair such a match with a parent or role.
- **Match Primer classes by substring of their stable part:
  `[class*="PageLayout-PaneWrapper"]`.** Primer emits `prc-<Component>-<local>-<hash>`
  (`prc-PageLayout-PaneWrapper-pHPop`), and the hash changes with its builds.
- **Don't take a passing test as proof that a selector matches.** Fixtures in
  `tests/fixtures/` can lag GitHub's live markup.
- **Re-check:** load a public commit page in Playwright and collect the `githubassets.com`
  asset URLs from its `response` events. One shared bundle holds the PR header's map too,
  so a commit page is enough. Curl the assets and grep the module's export map for
  `"localName__hash"`.

## The commit page

- **Treat a disconnected tree as a new page.** The commit page is server-rendered, and
  hydration re-renders the tree in place: the same `#diff_file_tree`, with a new list
  inside. [`visit/watch.ts`](../../entrypoints/content/visit/watch.ts) checks
  `isConnected` for this reason.
- **Find a commit's diff region by the link in its header.** Commit diff regions have no
  ids; each header links to `#diff-…`.
- **On a commit page, navigate to a file by hash, not by a synthetic `click()` on a tree
  row.** With no element matching the hash, the router's scroll restoration races GitHub's
  scroll. A trusted click wins that race, and a synthetic one often lands at the top.
  GitHub's own helper sets the hash with `history.replaceState`, then dispatches
  `hashchange`. The tree's current file ignores an unchanged hash.
- **Match the placeholder text case-insensitively.** A commit's placeholder reads "Load
  diff", and a pull request's reads "Load Diff".
- **Expect smooth scrolling.** `html` has `scroll-behavior: smooth`, except under reduced
  motion.
- **Re-check:** load a public commit page and a pull request. Read the placeholder text
  and `getComputedStyle(document.documentElement).scrollBehavior` from the DOM. Read the
  hydration re-render and the nav helper from GitHub's bundle as
  [§ Re-checking GitHub](#re-checking-github) describes.

## Diff lists

- **On a pull request's progressive list, expect one `diffEntry__<hash>` wrapper per
  file**, styled `content-visibility: auto`, with the region `#diff-…` as its direct
  child. GitHub loads files lazily in 4-file `diff_entries` batches, which replace the
  region inside a kept wrapper, never the wrapper or the list.
- **Don't assume a file count virtualizes a pull request's list.** Virtualization follows
  the route data's `virtualizeDiffEntries` flag, with no client-side threshold. A
  virtualized list renders only the rows near the viewport, as absolutely placed rows
  carrying `data-index` and `data-path-digest`.
- **Don't read list churn on a hard load as a new page.** A pull request's `diffEntry`
  wrappers stream in, and hydration removes and re-adds a few of the list's children, so
  an observer of the list (as in
  [`diffs/order.ts`](../../entrypoints/content/diffs/order.ts)) must handle repeat
  mutations idempotently.
- **On a commit, expect each region in a padding-top `div`,** and over 40 files a
  virtualized list of `data-index` rows placed by `translateY`.
- **Never scroll the window before GitHub mounts.** On mount GitHub's router calls
  `scrollTo(0, 0)`, which undoes an early scroll. Instead, `retakeHash` in
  [`diffs/reveal.ts`](../../entrypoints/content/diffs/reveal.ts) re-announces the hash so
  GitHub lands deep links itself.
- **Reorder diffs with CSS `order`.** GitHub's tree click scrolls by
  `getBoundingClientRect`, so it stays correct after a CSS reorder.
- **Re-check:** load a pull request with few files, and a public commit touching more than
  40 files, and inspect the list's markup. Search the page's embedded data for
  `virtualizeDiffEntries`, and watch the network panel for `diff_entries` requests while
  scrolling. Read the mount-time scrolls from GitHub's bundle.

## PR base data

- **Treat a pull request's diff as running from the merge base, not the base tip.**
  `pull/<n>.diff` diffs against the merge base, and REST `base.sha` stays at it.
  [`utils/github/pr-ref.ts`](../../utils/github/pr-ref.ts) pins a page's diff as a
  `DiffPin` (`readDiffPin`). The Files data's `comparison.baseOid` is the base tip at the
  last head push, so it can't stand in for the merge base.
- **Don't expect a base SHA in signed-out page data.** It names `baseBranch` and
  `headSha`, but no base SHA. That data is the Conversation page's
  `react-app.embeddedData`, under `payload.pullRequestsLayoutRoute.pullRequest`, which
  `pr-ref.ts` reads.
- **Never pin a diff by branch name alone.** Merging into the base, or force-pushing it,
  moves the merge base without changing the head or the name.
- **Re-check:** get the merge base with
  `gh api repos/<o>/<r>/compare/<base>...<head> --jq .merge_base_commit.sha`, then compare
  the `.diff`'s `index <a>..` blob with
  `gh api "repos/<o>/<r>/contents/<path>?ref=<sha>" --jq .sha` at that SHA, and compare it
  with REST `base.sha` from `gh api repos/<o>/<r>/pulls/<n> --jq .base.sha`. For the
  signed-out data, load the pull request signed out and search its embedded data for a
  base SHA.

## Re-checking GitHub

GitHub's React code ships as public assets on `https://github.githubassets.com/assets/`,
which you can fetch without a session.

1. In a browser console, in the page's main world, patch the call you care about
   (`window.scrollTo`, `Element.prototype.focus`) to log `new Error().stack`. The stack
   names the asset URL and offset.
2. Curl the asset into its own scratch directory.
3. Grep the minified source around the call, for example
   `rg -o '.{0,200}scrollTo\(.{0,200}' <asset>.js`. BSD or GNU `grep -oE` takes the same
   pattern; ugrep rejects it.

Read the results with care:

- **The probe can't see gh-prism's calls.** The content script runs in an isolated world,
  so an unexplained scroll with no logged call is likely gh-prism's.
- **A logged `focus()` isn't focus.** GitHub's diff regions have no `tabindex`, so no
  `focusin` fires.
- **Mirror GitHub's timing in Playwright stand-ins, and give stand-in diffs no
  `tabindex`.** A stand-in that differs passes where GitHub fails.

For a live check in a real browser, see
[`testing-rules.md`](testing-rules.md#verifying-in-a-real-browser).
