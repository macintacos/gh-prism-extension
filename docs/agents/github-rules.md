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
- **Find a large pull request's virtualized list as
  `[data-testid="virtualized-diffs-list"]`**, its rows `[data-index][data-path-digest]`,
  the digest being the region id without `diff-`. The rows mount and unmount as you
  scroll. Load Diff replaces the region but keeps its id and its row. The virtualizer
  re-measures a `display: none` row to nothing, closing its slot.
- **On a progressive list, hide a diff by its entry, not its region.** The list is a flex
  column with a 16px row gap, and an emptied entry still takes a gap.
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
  `"data-hotkey":"j"` and read the `isSingleFileMode` gate around it. On the code-owners
  sandbox's PR #3, hide a row with `[data-path-digest=…] { display: none !important }` and
  scroll the list for gaps; on PR #1, hide a region alone, then its entry, and measure the
  gap each leaves.

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
  Conversation finds the counter already mounted. gh-prism stands in for it on all four:
  `findHeaderPage` finds the same `prPage.diffstatSlot` on the three header tabs. Each
  holds one `[class*="rightContentWrapper__"]` slot whose `:scope > .d-flex` child is the
  counter; on Commits and Checks it mounts after a skeleton. Their route data has
  `pullRequestsLayoutRoute.pullRequest.headSha` but no
  `pullRequestsChangesRoute.diffContents`, so carries no diff pin, and their intent read
  always lists the files (checked 2026-10-27).
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
  Signed in, load `/pull/<n>`, `/pull/<n>/commits`, and `/pull/<n>/checks`. Find the
  slot's counter on each, and confirm their embedded data has no
  `pullRequestsChangesRoute.diffContents`.

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
  replaces it. gh-prism doesn't re-request route data, so it seeds from route data only on
  the visit the full load started, before GitHub's first navigation (`soft-nav:end` or
  `popstate`), and only when that data names the visit's pull request; any visit after a
  navigation reads headers alone, even the content script's first. A re-request of the
  page's path with `accept: application/json` would return the same key path, fresh
  (verified from the page's main world only). Read `user.shouldShowViewedFilesCount` from
  the same route data as the seed.
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

## Code owners and reviewers

- **Send `X-Requested-With: XMLHttpRequest` to read `page_data/codeowners` and
  `page_data/review_requests` as JSON.** Without it, or with `Accept: application/json`
  alone, both answer 406 with HTML.
- **`page_data/codeowners` lists every changed path.** `ownershipByPath` maps each path to
  `owners`, CODEOWNERS tokens in the rule's order, and `isOwnedByViewer`, true through a
  team you belong to. A path no rule matches has `owners: []`. Owners come from the base
  branch's CODEOWNERS, not the pull request's. On the code-owners sandbox's 152-file PR #3
  it lists all 152 paths, including one behind "Load Diff", with no paging. A repository
  without CODEOWNERS answers `isEnabled: false` and an empty `ownershipByPath`. It answers
  signed out on a public repository.
- **Read PR reviewers from `page_data/review_requests`, not `page_data/merge_box`.** It is
  the source of GitHub's React reviewer list, and it answers signed out on a public
  repository, where `merge_box` answers 404. It lists reviews that only commented, which
  `merge_box`'s `latestOpinionatedReviews` leaves out. Its `isCodeOwner` is `true` for the
  two shielded teams on PR #1 of `excessive-dev/gh-prism-codeowners-sandbox`, where
  `merge_box`'s is `false`.
- **Expect two lists, each left out when empty.** `pendingReviewRequests[]` has `reviewer`
  and `isCodeOwner`; `completedReviews[]` has `reviewer` and `state`, such as
  `REVIEW_STATE_APPROVED` or `REVIEW_STATE_COMMENTED`. A `reviewer` has `displayLogin` and
  `reviewerType` (`User` or `Team`), and a team's `displayLogin` is `org/slug`. A pull
  request with no requests or reviews answers `{}`.
- **Expect GitHub to name the team behind a reviewer only to a viewer who can see it.**
  Signed in outside the organization, on
  [nodejs/node#67086](https://github.com/nodejs/node/pull/67086), a pending team request
  is missing altogether and the endpoint answers `{}`; on
  [nodejs/node#67056](https://github.com/nodejs/node/pull/67056), user requests carry no
  `isCodeOwner`. Three fields are read from GitHub's bundle, not observed, because the
  sandbox has one account, which authored its pull requests:
  `pendingReviewRequests[].delegatedFromTeam`, the team a request was assigned from,
  `isCodeOwnerFromDelegation`, and `completedReviews[].onBehalfOfTeams[]`, the teams a
  review was on behalf of. Each team has the `reviewer` shape.
- **Read a team's members from `/orgs/<org>/teams/<slug>/members` with
  `Accept: application/json`.** It answers `{"total": N, "members": [logins]}`, the JSON
  GitHub's team-mention tooltips read; with `X-Requested-With` alone it answers HTML. A
  team bigger than its list shows the rest as "N more" in GitHub's own tooltip, so the
  list holds only the first members. A viewer outside the organization gets 404, from the
  team's `/hovercard` too, and a user's hovercard names organizations, not teams.
- **Re-check:** compare

  ```sh
  curl -s -H 'X-Requested-With: XMLHttpRequest' \
    https://github.com/excessive-dev/gh-prism-codeowners-sandbox/pull/3/page_data/codeowners \
    | jq '.ownershipByPath | length'
  ```

  against
  `gh api repos/excessive-dev/gh-prism-codeowners-sandbox/pulls/3 --jq .changed_files`,
  and run the same curl without the header for the 406. Curl a public pull request's
  `page_data/review_requests` with the header and compare `completedReviews` with
  `gh api repos/<owner>/<repo>/pulls/<n>/reviews`. Grep GitHub's assets for
  `onBehalfOfTeams` and `delegatedFromTeam`, as
  [§ Re-checking GitHub](#re-checking-github) describes, to find the reviewer list that
  reads them.

## The Reviewers lists

GitHub draws a pull request's reviewers in one of two lists. The classic sidebar is
server-rendered in `#partial-discussion-sidebar`. GitHub's pull request overview, which
route data's `featureStates.overview` turns on, draws a React list instead. The overview
read `"UNAVAILABLE"` on the code-owners sandbox and on nodejs/node for the saved account,
so its facts below come from GitHub's bundle and from a maintainer's screenshot of a work
pull request, taken 2026-10-28, not from a capture.

- **Find a classic row as
  `#partial-discussion-sidebar form[id^="pull-request-reviewers-form-"] .css-truncate > div`.**
  Its first link goes to the reviewer: `/<login>`, or `/orgs/<org>/teams/<slug>` for a
  team. Suggested reviewers, such as Copilot, share the list and link to `/apps/<slug>`.
- **Expect the classic sidebar to be replaced, not updated.** GitHub swaps it out on every
  soft navigation back to Conversation and on its `reviewers_updated` socket event, so a
  listener bound to its nodes goes stale. Listen on `document` and match the target with
  `closest()` instead.
- **Find a classic code-owner shield as `button[id^="codeowner-"]`.** Its id names the
  reviewer: `codeowner-<org>/<slug>` for a team. A user's `codeowner-<login>` is inferred,
  not observed, since the sandbox can't request a user who owns files. The button is
  `mr-2 btn-link muted-icon` around `span.reviewers-status-icon` and a 16px
  `octicon-shield-lock`, placed in the row after the status icon's `tool-tip`, which flex
  order puts it before.
- **Expect the classic shield's `tool-tip` to name it.** A Primer
  `<tool-tip for="codeowner-…" popover="manual">` reads "… is a code owner" and is the
  shield's accessible name through `aria-labelledby`.
- **Expect GitHub's hovercard on the reviewer's `span[data-hovercard-url]`, never on the
  shield.** The span wraps the avatar and name; the shield sits outside it, after the
  status dot.
- **Find an overview row as `[class*="reviewerList__"] li[class*="reviewerRow__"]`, and
  its icons in `[class*="indicators__"]`.** Its identity link goes to the reviewer as a
  classic row's does, though a team's link uses the team's name, which can differ from its
  slug. The icons are Primer's small invisible `IconButton`s, labelled "Re-request review
  from …" or "… is a code owner", and 16px `span[role="img"]` status icons, the status
  last.
- **Expect GitHub to shield only a pending code owner.** The overview draws its shield
  from a pending request's `isCodeOwner`, and not for a request assigned from a team, so a
  code owner who has reviewed has none. The maintainer's screenshot shows reviewed code
  owners with only the re-request and status icons, and a pending one with the shield.
- **Expect `page_data/codeowners` to answer from the Conversation page**, with the same
  JSON as from Files changed.
- **Re-check:** signed in with the saved `storageState`, load the Conversation view of the
  code-owners sandbox's PR #1. Read `#partial-discussion-sidebar`'s Reviewers item, hover
  a team's name and its shield to see which opens the hovercard, and fetch
  `page_data/review_requests` and `page_data/codeowners`, with the `X-Requested-With`
  header, from that page. Grep GitHub's assets for `reviewerRow__` and `is a code owner`
  for the overview's list, as [§ Re-checking GitHub](#re-checking-github) describes, and
  read `featureStates.overview` from a pull request's route data.

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

## Files changed filters

- **Expect GitHub's filter menu to rewrite the URL with one `replaceState`.** "Only files
  owned by you" writes `owned-by%5B%5D=<viewer login>`, and an extension writes
  `file-filters%5B%5D=<.ext>`, with no `pushState` and no `soft-nav:end`.
- **Expect a filter to remove tree rows and diff entries in place**, keeping the tree and
  list nodes. The header counters don't change.
- **Don't name another owner in `owned-by[]`.** It honours only the viewer's own login; a
  team or another login shows every file.
- **Expect an unknown parameter such as `gh-prism-owner` to survive** the load and every
  filter change, re-encoded (`/` as `%2F`), so read it with `URLSearchParams`. GitHub's
  links to other pages drop it.
- **Re-check:** on the code-owners sandbox's PR #1 and PR #3, signed in with the saved
  `storageState`, install `pushState`/`replaceState` wrappers and a `soft-nav:end`
  listener, then pick "Only files owned by you" and toggle an extension. Count the tree
  rows and diff entries, and read the header counter.

## The filter-options menu

- **Expect the filter-options menu to mount in `#__primerPortalRoot__` on each open and
  unmount on close.** Its `ul[role="menu"]` is labelled by the filter row's button, and
  its ids regenerate on every open, so match on `data-component` and roles, never ids.
- **Expect GitHub's owned-by group, and the divider before it, only when you own a changed
  file.** It is absent when you own none, and in a repository without CODEOWNERS. GitHub
  mounts it only once its own code-owners read lands, so a menu opened right after load
  lacks it: a capture waits for `[aria-keyshortcuts="o"]`, not `networkidle`, which never
  settles on GitHub.
- **Expect items appended to the menu to join Primer's arrow-key cycle.** Enter, Space,
  and click on one reach only its own listeners: Primer neither picks nor closes. An
  `Escape` keydown dispatched on it closes the menu and returns focus to the trigger.
- **Disable a hidden menu item, don't only hide it.** A `display:none` item traps the
  arrow keys; Primer's focus zone skips an item only once it carries `disabled`.
  `.click()` on a hidden, disabled item still picks it as GitHub does.
- **Re-check:** on the code-owners sandbox's PR #1, signed in, open the filter menu and
  read its markup under `#__primerPortalRoot__`; with gh-prism loaded, arrow through every
  item both ways and pick "Me" and a reviewer with Enter. Repeat on a pull request where
  the account owns no file.

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
