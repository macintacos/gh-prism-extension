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
the page's embedded data, from which it reads the diff pin, the head SHA, and each file's
Viewed state. **A new page kind (pull request, commit) is a new entry in `PAGE_KINDS` in
`files-page.ts`, not a branch on kind** elsewhere in the code. Features read each kind's
selectors from that table, so a new kind touches one place. Each section below states
facts about GitHub that held when written, and ends with how to re-check them;
[§ Re-checking GitHub](#re-checking-github) has the methods.

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

## The classic Files changed page

- **Expect some viewers to get a pull request's classic Files changed page,
  `/pull/<n>/files`, which `findFilesPage` doesn't match.** GitHub serves it to every
  signed-out viewer, even on a public pull request: `/changes` answers with a 302 to
  `/files`. Signed in, the Feature preview entry "New Files Changed Experience" decides.
  It is on by default, and a viewer who turns it off gets the classic page.
- **Expect the classic page for one of a pull request's commits at
  `/pull/<n>/commits/<sha>`, under the same two conditions.** The toolbar's commit menu
  leads there. An abbreviated SHA answers with a 302 to the full one.
- **Read both classic paths as the Files changed tab, because GitHub redirects them to the
  new page's.** Signed in with the preview on, `/files` redirected to `/changes`, and
  `/commits/<sha>` to `/changes/<sha>`, when checked on 2026-10-17. So `readFilesRoute`
  reads `/commits/<sha>` as a commit filter, as it reads `/changes/<sha>`, and the classic
  watcher shares its routes with the new page's.
- **Find the classic page by its toolbar, `#files_bucket .pr-toolbar`, and the toolbar's
  `.pr-review-tools`.** The review tools are the toolbar's trailing group: empty signed
  out, the review controls signed in. The per-commit page carries the same toolbar, with
  the commit's header below it.
- **Read whether the viewer is signed in from `meta[name="user-login"]`'s `content`.**
  GitHub leaves it empty for a signed-out viewer, and GitHub's own runtime counts an empty
  login as anonymous.
- **Expect a signed-out classic page to be reached by full loads.** Signed out, the pull
  request's tabs and the toolbar's commit menu loaded a new document, not a soft
  navigation, when checked on 2026-10-17. The watcher still follows soft navigation.
- **Keep the dialog's copy in
  [`classic/notice.ts`](../../entrypoints/content/classic/notice.ts) in step with these
  facts.** It tells a viewer of the classic page why gh-prism is off and how to get the
  new page.
- **Re-check:** curl a public pull request's `/changes` with no cookies and read the 302's
  `location`. Curl its `/files` and a `/commits/<sha>`, and find `#files_bucket`,
  `.pr-toolbar`, `.pr-review-tools`, and the empty `user-login` meta. Signed in with the
  preview on, load `/files` and `/commits/<sha>` and read where each lands. Grep the
  page's `app-runtime` asset for `meta[name="user-login"]`. Signed in, open the profile
  menu's Feature preview dialog and find the entry by name. Load the classic page in
  Playwright, set a `window` property, click a tab, and check whether the property
  survives.

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
  file**, with the region `#diff-…` as its direct child. Both the wrapper and the region
  are styled `content-visibility: auto`. GitHub loads files lazily in 4-file
  `diff_entries` batches, which replace the region inside a kept wrapper, never the
  wrapper or the list.
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
- **Expect GitHub to bind `j` and `k` to files only in single-file mode.** They are the
  toolbar's Previous and Next file buttons' `data-hotkey`, rendered only with route data's
  `isSingleFileMode`, and they step in GitHub's order. Refined GitHub binds them on every
  Files view: it walks `div[class*="targetable" i][id^="diff-"]` in DOM order from
  `:target`, so CSS `order` doesn't reach it, and a tree click's `replaceState` leaves
  `:target` behind. [`diffs/file-keys.ts`](../../entrypoints/content/diffs/file-keys.ts)
  takes the keys first.
- **Re-check:** load a pull request with few files, and a public commit touching more than
  40 files, and inspect the list's markup. Search the page's embedded data for
  `virtualizeDiffEntries`, and watch the network panel for `diff_entries` requests while
  scrolling. Read the mount-time scrolls from GitHub's bundle. Grep the bundle for
  `"data-hotkey":"j"` and read the `isSingleFileMode` gate around it.

## Sticky headers

- **Read the band GitHub's sticky chrome covers from a file header's computed `top`.**
  Each file header (`[class*="diffHeaderWrapper__"]`, the region's first child) is sticky
  at a `top` equal to that band, on both page kinds. The `__` suffix keeps
  `diffHeaderWrapperWithMiniHeaderAndToolbar__` out.
- **Expect a pull request's `top` to follow `--base-sticky-header-height`,** which GitHub
  writes on `body`'s `style`, so watch that attribute and window resizes for changes.
- **Don't measure the sticky bar itself.** The commit page's bar has no stable hook, and
  the pull request's is `height: 0` until stuck.
- **Re-check:** on a public commit page, read the file header's computed `top` and compare
  it with the sticky bar's height, at both sides of the 1011px breakpoint. On a signed-in
  pull request, watch `body`'s `style` for `--base-sticky-header-height` while crossing
  1011px, and compare it with a file header's computed `top`.

## The header counter

- **Expect a pull request's lines-changed counter to mount after the tree and diffs.** The
  server renders the header's `rightContentWrapper__` slot with a skeleton (`skeleton__`)
  in it. The counter is a client-only child that waits on its own `page_data/diffstat`
  request, so on a large pull request it lands long after a cached intent does.
  `showCounter` in
  [`header/diffstat-view.ts`](../../entrypoints/content/header/diffstat-view.ts) follows
  the slot through `observeDiffstat` for this reason. A commit page server-renders its
  counter.
- **Expect the header to outlive the tab.** It belongs to the pull request's layout route,
  which Conversation, Commits, Checks, and Files changed share, so a soft navigation from
  Conversation finds the counter already mounted.
- **Expect no counter when the diff changes no lines**, as with only renames or binary
  files, or when the diffstat request fails.
- **Expect the counter elsewhere under GitHub's `overview` feature.** With route data's
  `featureStates.overview` `"ENABLED"`, the slot stays empty and the counter renders in
  the subtitle row ("wants to merge…"), where `diffstatSlot` doesn't find it. This was
  read from the bundle, not observed, on 2026-10-19.
- **Re-check:** curl a public pull request's Conversation page signed out and read the
  `rightContentWrapper__` slot's child, then curl a public commit page and find its
  counter's "Lines changed" text. Grep the assets for `page_data/diffstat` and
  `PullRequestHeaderDiffStat`, as [§ Re-checking GitHub](#re-checking-github) describes.

## The filter row and repo visibility

- **Expect one filter row shape on both kinds.** A pull request and a commit page both
  render `#diff-file-tree-filter` with the filter input and, in a `.position-relative`
  wrapper, the filter-options `IconButton` (`aria-haspopup="true"`). The narrow layout's
  overlay copies the row with the same ids, so scope lookups to the docked sidebar.
- **Read a repo's visibility from two `<head>` metas.**
  `octolytics-dimension-repository_public` (`"true"`/`"false"`) and
  `octolytics-dimension-repository_nwo` are served on pull request `/changes` and `/files`
  and on commit pages, signed in or out. A soft navigation may leave another repo's metas
  behind (inferred, not observed), so treat the repo as public only when `nwo` matches the
  route's repo.
- **Re-check:** curl a public commit page and grep `octolytics-dimension-repository_` and
  `diff-file-tree-filter`, and curl a public pull request's `/files` (signed out,
  `/changes` 302s there) for the metas. Signed in with the saved `storageState`, load a
  pull request's `/changes` in Playwright, read both metas and `#diff-file-tree-filter`'s
  markup, then below 1012px open the overlay and find its copy of the row.

## Viewed state

- **Read every file's initial Viewed state from route data.** The Files view's
  `react-app.embeddedData` holds `payload.pullRequestsChangesRoute.diffSummaries[]`, each
  with `path`, `pathDigest`, and `markedAsViewed`, for every file before its diff mounts,
  virtualized or not. `pathDigest` joins an entry to the DOM: the file's region id and
  tree link are both `diff-<pathDigest>`.
- **Trust route data only on the visit a full load started.** The embedded script reflects
  the last full load only, and only until the first toggle; a soft navigation never
  replaces it. gh-prism makes no network requests of its own, so it seeds from route data
  only on the visit the full load started, before GitHub's first navigation
  (`soft-nav:end` or `popstate`), and only when that data names the visit's pull request;
  any visit after a navigation reads headers alone, even the content script's first. A
  re-request of the page's path with `accept: application/json` would return the same key
  path, fresh (verified from the page's main world only). Read
  `user.shouldShowViewedFilesCount` from the same route data as the seed.
- **Follow toggles through the header's button, not the tree or `diff_entries`.** Tree
  rows carry no Viewed mark, and `diff_entries` batches carry no Viewed field. A header
  exists only for a mounted diff, so it gives no coverage, but it tracks every toggle.
- **Use the "N / M viewed" counter only as a totals cross-check.** Its screen-reader text
  reads "N of M files viewed". The counter, `[class*="ProgressContainer__"]` inside
  `[class*="file-controls__"]`, follows the header buttons, not the server.
- **Find the Viewed toggle as
  `[class*="diff-file-header__"] button[aria-pressed][aria-label$="Viewed"]`.** It is a
  Primer button, not a checkbox: `aria-pressed` holds the state, and `aria-label` reads
  "Viewed" or "Not Viewed". Other header buttons carry `aria-pressed` too.
- **Expect a scripted `click()` to be honored.** An untrusted click (`isTrusted: false`)
  toggles the button, sends `POST <pull>/file_review` with `{"path":…,"viewed":"viewed"}`
  (unview: `DELETE` with `"_method":"delete"`), gets 200, and survives a reload. GitHub's
  `onClick` has no `isTrusted` check; its only guard is the button's `inactive` prop.
- **Expect no in-flight mark while `file_review` is pending.** The toggle flips
  `aria-pressed`, `aria-label`, and its `viewed__` class at once, before the save answers.
  `aria-disabled`, `disabled`, `data-inactive`, and `data-loading` (`"false"`) stay
  unchanged throughout. A click during the pending save is not ignored: it flips the
  button back and sends a second `file_review`. A caller that must not toggle twice guards
  the click itself.
- **Treat `user.shouldShowViewedFilesCount` as the page-wide signal that Viewed is
  offered.** In the DOM, the same signal is a header Viewed button or the counter. The
  full view (`pullRequestsChangesRoute`) has it `true`. The commit-filtered view
  (`/pull/<n>/changes/<sha>`, route `pullRequestsChangesWithRangeRoute`,
  `comparison.viewing: "COMMIT"`) has it `false`, with no Viewed buttons and no counter,
  though `markedAsViewed` is still present (all `false` in the survey, with none of the
  commit's files viewed; whether it reflects server state is untested). A commit page
  offers no Viewed, signed in or signed out. A pull request signed out redirects
  `/changes` to the classic `/files`, which offers no Viewed and which `findFilesPage`
  doesn't match.
- **Expect unloaded diffs to keep their Viewed button.** A "Load Diff" placeholder, for a
  large diff or a generated file, replaces only the body; the header keeps its button.
  Generated files' headers aren't collapsed by default.
- **Read state after a click, not synchronously.** React flips the toggle asynchronously,
  in the microtask after the click. A click collapses the diff at once, before the save
  returns: the header gains `[class*="collapsed__"]`, the button gains
  `[class*="viewed__"]`, and the counter increments. Unviewing expands it again. With
  route data's `isSingleFileMode`, a click navigates to the next file instead (read from
  the bundle, not observed). The survey ran with the "Viewed files" filter on; with it off
  (`showViewedFiles: false`), viewed files drop from the list, which was not surveyed.
- **Click the toggle outside another element's click dispatch.** React flips it in the
  microtask after the click, so a toggle clicked from inside another click's dispatch
  flips before that dispatch ends, and a caller that cancels its own click undoes the
  render that the flip caused. Defer the click past the dispatch (`setTimeout`).
- **Don't expect GitHub to revert a failed save.** When `file_review` fails (a 500), the
  button stays pressed, the diff stays collapsed, and the counter keeps the increment,
  with no visible error, because the mutation's `onError` is a no-op. The page diverges
  from the server until a reload.
- **Re-check:** use the sandbox pull requests from `scripts/create-sandbox.sh`, in a
  Playwright session that loads a signed-in `storageState`. Search the embedded data for
  `pullRequestsChangesRoute.diffSummaries` and `markedAsViewed`. Read
  `user.shouldShowViewedFilesCount` and the route key on `/pull/<n>/changes` and on
  `/pull/<n>/changes/<sha>`, and count header Viewed buttons. Load a commit page signed in
  and signed out, and a pull request signed out, and confirm none offers Viewed. Scroll #2
  to its +3000-line file, and read #3's generated files' headers. Toggle a file with a
  page-script `click()` from the page's main world (`page.evaluate`), never Playwright's
  trusted click, and watch the network for `file_review`. For the pending save, route
  `file_review` with a delayed fulfil, click twice from the main world 300 ms apart, and
  sample the toggle's `aria-*`, `disabled`, `data-loading`, `data-inactive`, and
  `className` every 25 ms. For the microtask flip, click the toggle from inside another
  element's `click` listener and read `aria-pressed` before the listener returns. After a
  soft navigation, re-request the path with `accept: application/json` and compare its
  `markedAsViewed` with a header's `aria-pressed`. Fail the save with a `route` that
  answers 500, click, and read the header and counter. Find the handler by grepping
  GitHub's assets for `file_review`, as [§ Re-checking GitHub](#re-checking-github)
  describes. Restore every toggled file.

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

## The narrow layout's overlay

Below 1012px, a pull request's tree toggle opens the file tree as a "Files" overlay.

- **Find it as `[role="dialog"] #pr-file-tree`.** The overlay is a Primer `Dialog` in a
  portal under `body` (`#__primerPortalRoot__`), which precedes the page in document
  order. It holds its own copy of `#pr-file-tree`, filter and `ul[role=tree]` included,
  with the docked tree's ids, so a bare `querySelector('#pr-file-tree')` returns the
  overlay's copy while it is open. Its rows have the docked tree's shape.
- **Expect a fresh subtree on each open.** Closing unmounts it. The docked `#pr-file-tree`
  stays mounted and hidden throughout, as the same node, so no page change happens.
- **Expect a file click to close the overlay** and reveal the diff, trusted or synthetic,
  on the overlay's link or the hidden docked one. A directory click keeps it open.
- **Read the edge it opens from off `data-position-regular="left"`:** Primer sets the
  backdrop's `justify-content` and the dialog's hash-named slide-in keyframes from it, at
  768px and wider; below 768px Primer shows the overlay fullscreen with its own
  scale-fade, which gh-prism leaves alone.
- **Never write Primer's `data-position-*` attributes from script; React owns them.**
  Override the edge in CSS instead.
- **Expect no dialog on a commit page.** Its narrow overlay is the same `#diff_file_tree`,
  repositioned.
- **Re-check:** signed in with the saved `storageState`, load a pull request's Files
  changed tab below 1012px wide, click `[class*="MobileTreeToggle"]`, and read
  `#__primerPortalRoot__`'s markup.

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
