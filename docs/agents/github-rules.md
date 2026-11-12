# GitHub Rules

*Audience: coding agents changing how gh-prism reads or reshapes GitHub's pages, and the
people who maintain these rules.*

These rules govern
[`entrypoints/content/files-page.ts`](../../entrypoints/content/files-page.ts), every
sheet's `GitHub hooks:` header, `entrypoints/content/diffs/`,
`entrypoints/content/visit/`, and `utils/github/`. **GitHub selectors live only in
`files-page.ts`, in sheets' `GitHub hooks:` headers, and in the two parsers below.**
GitHub changes its markup without notice, so keeping its selectors in one seam keeps a
breakage to one place to fix. There are two exceptions.
[`utils/github/pr-ref.ts`](../../utils/github/pr-ref.ts) keeps its own selector for the
page's embedded data, from which it reads the diff pin, the head SHA, each file's Viewed
state, and GitHub's generated flags; it reads JSON, not markup a feature hooks.
[`utils/github/team-roster.ts`](../../utils/github/team-roster.ts) keeps its own selectors
because it parses a fetched members page, not the live page. **A new page kind (pull
request, commit) is a new entry in `PAGE_KINDS` in `files-page.ts`, not a branch on kind**
elsewhere in the code. Features read each kind's selectors from that table, so a new kind
touches one place. Each section below states facts about GitHub that held when written,
and ends with how to re-check them; [§ Re-checking GitHub](#re-checking-github) has the
methods.

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
- **Find the commit message box by `[class*="commitMessageContainer__"]`.** Its first
  `span` holds the title in a `div`. The body is a sibling
  `span.extended-commit-description-container`, absent for a subject-only message. Both
  are `ws-pre-wrap` text with literal newlines. The box sits in a card beside the branch
  row, `[class*="commitBranchContainer__"]`, which holds links of its own, so don't search
  the whole card.
- **Expect GitHub's links in the box to carry absolute `href`s.** `#123` is
  `a.issue-link.js-issue-link` with `data-hovercard-*` attributes, `@user` is
  `a.user-mention` with `data-hovercard-type="user"`, and a SHA is `a.commit-link` holding
  a `<tt>` short SHA. A plain URL becomes an `<a>` with no class and no hovercard. Inside
  `[text](url)`, GitHub's `<a>` covers exactly the URL, and the `(` and `)` stay text
  outside it. A compare URL becomes an `a.commit-link` reading
  `owner/repo@<tt>sha...sha</tt>`, not the URL, with no hovercard.
- **Expect the message's card in PageLayout's Header, above the flex row
  `[class*="PageLayout-PageLayoutContent"]`.** The row holds the tree's pane wrapper
  (`order` 1; gh-prism's right dock moves it to PageLayout's `--region-order-pane-end`, 3)
  and the diffs' ContentWrapper (`order` 2). The pane wrapper is
  `position: sticky; top: 0; height: 100vh`, and the window, not the row, scrolls.
  `findCommitColumnRow` finds the row from the sidebar.
- **Find a commit's toolbar row as
  `#diff-content-parent > * > :has([aria-controls="diff_file_tree"])`.** The row is a
  `position: sticky; top: 0` flex row with an 8px gap, first in the wrapper that
  `#diff-content-parent` holds. Its first child wraps the two tree toggles, and its second
  is a full-width group holding the code search and the settings button. The sidebar
  carries a copy of the row inside a `d-md-none` wrapper, for the layout below 768px, so
  scope the match to `#diff-content-parent`. `findFilesToolbar` finds the row, and the
  commit message's toggle starts it.
- **Read the message from the box, not the embedded page data.** The data holds it only as
  HTML (`shortMessageMarkdown`, `bodyMessageHtml`), never as raw text.
- **Read a commit's first parent from `a[data-hotkey="p"]` in the card's row
  `[class*="commitBranchContainer__"] > pre`.** The row reads "1 parent", "2 parents" with
  the second parent's link bound to `o`, or "0 parents" for a root commit, then "commit"
  and the short SHA, and ends in the button that copies the full SHA. Each parent link's
  `href` is `/<owner>/<repo>/commit/<full sha>`.
- **Expect hydration to replace the whole commit card in the same frame as the tree.** On
  cli/cli@189706b at 1440px, the parents row, the message box, and the tree's list were
  all new nodes about 325 ms after load. Whatever gh-prism put in the card goes with it,
  and the watcher's new page puts it back.
- **Expect a plain `<a href>` that gh-prism appends inside the card to navigate softly.**
  GitHub's router takes its click: `soft-nav:end` fires, and the document stays.
- **Rely on GitHub's `markdown-body` sheet.** It loads on commit pages, so a
  `div.markdown-body` gets GitHub's README styling with no sheet of gh-prism's. Task lists
  rely on its classes too: `message.ts` writes `contains-task-list`, `task-list-item`, and
  `task-list-item-checkbox`, so if checkboxes or bullets lose their styling, check those
  classes in GitHub's sheet first.
- **Rely on GitHub's label sheet.** `.IssueLabel` and `.hx_IssueLabel` load on commit
  pages, from GitHub's `primer` and `global` sheets (observed 2026-11-10). A
  `span.IssueLabel.hx_IssueLabel` is a 12px medium-weight pill, and `hx_IssueLabel` paints
  it from six custom properties, `--label-r`, `--label-g`, `--label-b`, `--label-h`,
  `--label-s`, and `--label-l`: a solid fill in a light theme, and an 18% fill with
  lightened text in a dark one. `commit/title-badge.css` sets the six per type.
- **Never rewrite the title's text in GitHub's box; stand a copy in front of it.** React
  owns the title `div`. `commit/subject-badge.ts` inserts a `span` before it, which
  `findCommitMessage`'s `> div` skips, and `subject-badge.css` hides the `div`.
- **Expect Refined GitHub to badge commit lists only.** Its conventional-commits feature
  runs on `isCommitList` pages and leaves a commit's own page as GitHub drew it (Refined
  GitHub 26.11.6, observed 2026-11-10), so gh-prism's type label is the only one there.
- **Re-check:** load a public commit page and a pull request. Read the placeholder text
  and `getComputedStyle(document.documentElement).scrollBehavior` from the DOM. Read the
  hydration re-render and the nav helper from GitHub's bundle as
  [§ Re-checking GitHub](#re-checking-github) describes. Signed out, load the five commits
  named in the `tests/fixtures/commit-message-*.html` header comments, and compare each
  page's message card with its fixture. Check a scratch `div.markdown-body`'s computed
  `font-size` reads `16px`, and that a scratch `ul.contains-task-list > li.task-list-item`
  drops its bullet. On a public commit page at ≥ 1268px, read the computed `order` of
  `[class*="PageLayout-PageLayoutContent"]`'s children, the pane wrapper's `position`,
  `top`, and `height`, and confirm `document.scrollingElement` is what scrolls. Read the
  parents row of a merge (cli/cli@0cf1092) and a root commit
  (octocat/Hello-World@553c207). Read the parent and grandparent of each
  `[aria-controls="diff_file_tree"]` button, and the row's computed `position`, `top`, and
  `gap`, at 1600px and 600px. At both widths, two buttons sit under `#diff-content-parent`
  with one grandparent, which is a child of `#diff-content-parent`'s child and computes
  `sticky`, `0px`, and `8px`. On a commit page, append an `<a>` to another commit inside
  the parents row, click it, and check that a `window` property survives. Append a scratch
  `span.IssueLabel.hx_IssueLabel` with the six `--label-*` properties set, and read its
  computed `background-color` in a light and a dark theme. With Refined GitHub loaded
  beside gh-prism, load a conventional commit's page and count
  `[rgh-conventional-commits]`.

## A commit's next commit

No commit records its children, so gh-prism reads them from three JSON endpoints that
github.com's own pages read. Each answers JSON only with `Accept: application/json`, and
its page's HTML without it. Each answers signed out on a public repository and signed in
on a private one.

- **Find a commit's children on the default branch with commit search.**
  `/search?q=repo:<owner>/<repo> parent:<sha>&type=commits&s=committer-date&o=asc` answers
  `payload.blackbirdSearchRoute.results[].sha`, earliest committer date first. `parent:`
  matches either parent of a merge, and takes an abbreviated SHA. Search covers only the
  default branch: a child on any other branch never shows.
- **Read the branches holding a commit from `/<owner>/<repo>/branch_commits/<sha>`.** It
  answers `{"branches": [{"branch", "prs"}], "tags": [...]}`, naming only the default
  branch when that branch holds the commit. GitHub doesn't say how it orders several other
  branches, so take its first as it comes. GitHub's commit card requests it to show the
  branch.
- **Read a branch's newest commits from `/<owner>/<repo>/commits/<branch>`.** It answers
  `payload.commitsRefRoute.commitGroups[].commits[].oid`, 35 to a page, newest first. A
  `/` in the branch name may be `%2F`. The entries carry no parents, and on a branch that
  takes merges, a pull request's commits sit between the branch's own, so the entry above
  a commit isn't always its child. Its cursors (`after=<head>+<n>`) count from the
  branch's head, and `before=` with any other commit lists nothing, so no request jumps to
  a commit's place in the list.
- **Don't expect a compare to list commits between distant commits.**
  `/compare/<sha>...<branch>` answered "This comparison is taking too long to generate"
  for cli/cli@189706b against `trunk`, six weeks of history apart.
- **Re-check:** curl each endpoint for cli/cli with the header, then without it.
  `parent:9eb4db2` finds 189706b and 0cf1092. Commit 307d529, on `attester/multi-tenant`
  alone, finds no children in search but lists that branch in `branch_commits`. Curl
  `/cli/cli/compare/189706b...trunk` for the timeout. Signed in with the saved
  `storageState`, fetch the search for a private repository's commit from its page.

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
  GitHub can land a deep link again.
- **Land a line link yourself after the cover lifts.** GitHub scrolls to a deep link once,
  as it mounts, measuring a target gh-prism's cover may hide, and the pull request Files
  view ignores a later `hashchange`. So `retakeHash` lands a deep link only on commit
  pages, and `holdHashLine` in the same file lands a line link, or a range's first line,
  itself and holds it until the user takes the scroll. On a commit page GitHub's client
  mount replaces the Files markup and scrolls to the top when the window has scrolled, so
  the hold lasts the visit, not the page.
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
  scrolling. Read the mount-time scrolls from GitHub's bundle. On a pull request's Files
  changed opened at a line link, dispatch `hashchange` after load and confirm nothing
  scrolls; grep the commit page's bundle for the mount effect that calls `scrollTo(0, 0)`
  when `scrollY > 0`. Grep the bundle for `"data-hotkey":"j"` and read the
  `isSingleFileMode` gate around it. On the code-owners sandbox's PR #3, hide a row with
  `[data-path-digest=…] { display: none !important }` and scroll the list for gaps; on PR
  #1, hide a region alone, then its entry, and measure the gap each leaves.

## Diff lines

- **Find a changed cell as `td.diff-text-cell` holding `code.diff-text.addition` or
  `code.diff-text.deletion`.** A context cell is the same `td` whose `code.diff-text`
  carries neither class. Each hunk header is a `td.diff-hunk-cell`.
- **Read a cell's line from the `data-line-anchor` suffix on the `td`:**
  `diff-<sha256 of the path>R<n>` for the new side, `…L<n>` for the old. On a pull
  request, context cells anchor as `R<n>`, the left cell of a split row included. On a
  commit, a split row's left context cell anchors as `L<n>`.
- **Read a cell's side from `data-diff-side` on a pull request, and from the anchor suffix
  on a commit; a changed cell's suffix is right on both.** A pull request's context cells
  anchor as `R<n>` on both sides, so the suffix misleads there. Pull request cells carry
  `data-diff-side="left|right"`, `data-line-number`, and
  `data-diff-line-key="b:<n>-l:<old>-r:<new>"`; commit cells carry none of the three. A
  commit's text cells also carry `left-side-diff-cell` or `right-side-diff-cell` in both
  layouts, so those classes say nothing about the layout.
- **Expect a pull request hunk header to anchor as `R<first line − 1>`.** The anchor sits
  on the `td.diff-hunk-cell`: `@@ -11,5 +11,5 @@` anchors as `…R10`, and only a hunk
  starting at line 1, or context expanded to the top, gives `R0`. That anchor passes
  `isLineAnchor`. A commit's hunk header carries no anchor, as on
  [sandbox commit `8d807ee`](https://github.com/macintacos/gh-prism-sandbox/commit/8d807ee).
  On both pages the hunk cell holds `code.diff-text-cell.hunk > div.diff-text-inner`, so a
  bare `.diff-text-cell` or `.diff-text-inner` also matches hunk headers.
- **Read `data-grid-cell-id` as `diff-<hash>-<old>-<new>-<column>`** on both pages, where
  a split row's missing opposite line reads `empty`.
- **Find the code text in `.diff-text-inner`, after `span.diff-text-marker`,** the two
  being the `code`'s only children. A context line has `.diff-text-inner` and no marker.
  GitHub's word marks are `.x.x-first.x-last` on the syntax span inside
  `.diff-text-inner`.
- **Scope a line's text reads to its `code`, not its `td`.** A mounted review thread sits
  inside the line's `td.diff-text-cell`, as the `code`'s next sibling
  (`div.d-flex.pt-1 > div[class*="markersWrapper__"] > … [data-testid="review-thread"]`),
  not in a row of its own. A `td`'s `textContent`, or a text-node walk rooted at the `td`,
  takes in the comment.
- **Expect up to two text cells per row in split, and one in unified, but don't read the
  layout from that count.** A commit's one-sided split table holds at most one
  `td.diff-text-cell` per row; read the layout from the columns instead (see
  [§ Diff layout](#diff-layout)). On a pull request, a one-sided split row holds one
  `td.diff-text-cell`, and its other side holds `td.empty-diff-line` cells. A pull
  request's unified cells carry `left-side` alone, whatever their side, so don't read the
  side from a class there.
- **Collect changed cells with `changedCells` in `files-page.ts`, and collect again on
  each `observeDiffs` report.** It finds them as the bullets above describe and reads the
  old or new side and the line from the anchor suffix, which is safe only because it
  yields changed cells, never the context cells or hunk headers whose suffix misleads.
  Don't hold cells across a report, since tables or their rows are replaced.
- **Find a renamed file's region by the hash of its new path:**
  [`macintacos/gh-prism-sandbox` PR #3](https://github.com/macintacos/gh-prism-sandbox/pull/3/changes)'s
  `src/util.rs` renamed to `src/helpers.rs` is `#diff-c2a0fff5…`. Region ids and their
  absence on a commit are under [§ Viewed state](#viewed-state) and
  [§ The commit page](#the-commit-page). On both page kinds the diff's `table` carries the
  hash as `data-diff-anchor="diff-<hash>"`, one hook for both (Chromium 157 and Firefox
  157, 2026-11-10).
- **Don't look for a mark on expanded context.** Expanding `src/engine.rs` on sandbox PR
  #3 took its table from anchors R16–R24 to R0–R24, and rows R1–R15 carry the same classes
  as any context row (Chromium 157, 2026-11-10).
- **Expect `?w=1` to keep the anchors of the rows it leaves.** On
  [cli/cli@aac4387](https://github.com/cli/cli/commit/aac43870d4526ebc88ee0ec5151f0bf857483e19)
  it drops the changed cells from 25 to 3, keeping `L144`, `R144`, and `R145`
  unrenumbered; the whitespace-only lines show as context (Chromium 157, 2026-11-10).
- **Don't hold a diff line's text node across a context expansion or a file collapse; look
  it up again.** In Chromium 157 and Firefox 157 on 2026-11-10, on sandbox PR #3's
  `src/engine.rs` and on commit `8d807ee`, expanding context replaced the region's
  element, table, and every text node. Collapsing a file with its header chevron
  (`.octicon-chevron-down`, no `aria-expanded`) unmounted the table, and re-opening it
  mounted a new one. Hovering a row, clicking its line number, and scrolling far away and
  back kept every node. Expanded context does not survive a reload, and neither does a
  collapse: commit `8d807ee` collapsed and reloaded comes back open with its table mounted
  (Chromium 157, 2026-11-10).
- **Expect every row of a file to mount at once, even past 1,328 lines.** On
  [sandbox PR #2](https://github.com/macintacos/gh-prism-sandbox/pull/2/changes),
  `web/src/data/catalog.ts` (+3000) is PR #2's only file over 1,328 lines and its only
  file behind the Load Diff button, so it answers both. After the click, its region held
  3001 `tr.diff-line-row` and 3001 anchors. Scrolling to the middle, the bottom, and back
  unmounted and reused none of them, in Chromium 157 and Firefox 157 on 2026-11-10. Load
  Diff replaced the region's element but kept its id. The page-level
  `[data-testid="virtualized-diffs-list"]` virtualizes files, not rows.
- **Expect a merge commit's page and its `.diff` to show the first-parent diff.**
  [cli/cli@1837454](https://github.com/cli/cli/commit/18374541e44ad568208c2f45b14cc51c201121bd)
  (parents `679ca5f` and `ebec795`) shows the same 5 files as its `.diff` and as a compare
  against `679ca5f`, and each loaded file's addition and deletion cells match its `.diff`
  counts (Chromium 157, signed in, 2026-11-10). Count tables only after loading every
  file: its generated `issue-triage.lock.yml` sits behind Load diff, so a first count
  finds 4 tables for 5 files.
- **Paint over a cell's text with the CSS Custom Highlight API from a constructed sheet.**
  A `::highlight()` rule in a `CSSStyleSheet` added through `document.adoptedStyleSheets`
  applies under GitHub's CSP. A Highlight paints over the `.x` word mark's background, and
  a translucent one (`rgba(255,0,255,.4)`) lets the mark's tint show through; the mark's
  computed background stays unchanged. Observed on sandbox PR #3's `timeout_ms = 500` row
  in Chromium 157 and Firefox 157 on 2026-11-10.
- **Test against the captured tables:** `tests/fixtures/files-page-diff-*.html` (pull
  request unified, split, and rename) and `tests/fixtures/commit-page-diff-*.html` (commit
  unified, split, and `?w=1`). Each fixture's header comment names its source page. Like
  every fixture, they can lag GitHub's live markup.
- **Re-check:** signed in, load sandbox PR #3's Changes and commit `8d807ee`, each plain
  and with `?diff=split`. Over `td.diff-text-cell`, read the `code` classes, the `td`'s
  `data-line-anchor`, `data-diff-side`, `data-line-number`, `data-diff-line-key`, and
  `data-grid-cell-id`, the `code`'s children in order, and the cells per `tr`; read the
  hunk header's anchor and its element. Find the review thread's
  `closest("td.diff-text-cell")` and its position after the `code`. Compare each region id
  with `crypto.subtle.digest('SHA-256', …)` of its path. On PR #3, click
  `button[aria-label="Expand file up from line 17"]` in page context (it is `aria-hidden`,
  so a role query misses it) and diff the rows' classes. For text nodes, stash the text
  nodes of a region's `.diff-text-inner` elements on `window`, run each interaction, and
  read each node's `isConnected`. On PR #2, click Load Diff in
  `#diff-211423e32384e0dd9ef7b5ea32ea75b4e16f023deb9254c5b58d7d9e7ddaa6b0`, count
  `tr.diff-line-row`, keep the first, middle, and last rows, and scroll. Count changed
  cells on cli/cli@aac4387 with and without `?w=1`. Curl cli/cli@1837454's `.diff`,
  compare its per-file `+`/`-` counts with the page's after scrolling to the end, and with
  `gh api repos/cli/cli/compare/679ca5f...1837454`. For the Highlight API, set a Range
  from the start of a `.diff-text-inner` through its first `.x`, add a `::highlight()`
  rule from a constructed sheet, and screenshot the row before and after. For reload
  state, collapse commit `8d807ee`'s file, reload, and count `table[data-diff-anchor]`.

## Diff layout

- **In a live check, find the layout gear by its accessible name, which differs by page.**
  In code, use `findLayoutGear`. On a pull request it is
  `getByRole('button', { name: 'Diff settings' })`. On a commit it is
  `getByRole('button', { name: 'Open diff view settings' })`, scoped to
  `#diff-content-parent`: the sidebar's `d-md-none` copy of the toolbar row can carry a
  second match. At 1280px and 700px wide, the role query matched one visible button,
  inside `#diff-content-parent` (Chromium 157, 2026-11-10). Both are Primer `IconButton`s
  with an `.octicon-gear` and no test id, named by `aria-labelledby` pointing at a Primer
  tooltip `span`.
- **Expect a pull request's gear in the page-wide `[class*="toolbar__"]` sticky header**
  (`section.stickyHeader__…`), not in a file header and not in the `file-controls__`
  container `VIEWED_COUNTER` in `files-page.ts` reads. A commit's gear sits in the row
  above its file list.
- **Expect the menu's Layout group to hold `menuitemradio` Unified and Split.** Don't read
  the layout from it in code: the menu exists only while open; `currentLayout` reads the
  tables' columns. The menu mounts under `#__primerPortalRoot__`. A pull request then has
  a Whitespace changes `menuitem` that opens a submenu of `menuitemradio` Always show,
  Always hide, and Hide for this diff only, then `menuitemcheckbox` Minimize comments and
  Compact line height. A commit has no Whitespace changes group; its checkboxes are
  Minimize comments, Hide whitespace, and Compact line height. Observed in Chromium 157
  and Firefox 157 on 2026-11-10.
- **Expect a commit's Hide whitespace to follow `?w=1`:** its `aria-checked` is `false` on
  a plain load and `true` on a `?w=1` load. Observed in Chromium 157 and Firefox 157 on
  2026-11-10.
- **Don't assume `?w=1` applies on a pull request.** Untested: its whitespace submenu
  stays on Always show under `?w=1`, and
  [`macintacos/gh-prism-sandbox` PR #3](https://github.com/macintacos/gh-prism-sandbox/pull/3/changes)
  has no whitespace-only line to show the rows' answer. Settle it on a pull request with a
  whitespace-only change.
- **Expect the menu's layout choice to persist across reloads.** Choosing Split on
  `macintacos/gh-prism-sandbox` PR #3 kept split, and Split checked, after a reload
  without a parameter, in one Chromium 157 session on 2026-11-10; whether the account or
  the browser stores it is unknown. Choosing Unified back restored it.
- **Use `?diff=split` when the menu can't be driven.** It switches a pull request and a
  commit to split for that load only: a reload without it returns to the saved layout.
  `?diff=unified` loads unified even with Split saved, and loading either value doesn't
  change the saved choice. Observed in Chromium 157 and Firefox 157 on 2026-11-10; the
  override of a saved Split in Chromium 157 only, signed in.
- **Expect one saved layout for pull request and commit pages.** Choosing a layout on one
  page kind shows on the other (Chromium 157, signed in, 2026-11-10; Firefox unchecked).
- **Read the layout from a diff table's columns: 3 `colgroup > col` in unified, 4 in
  split,** on both page kinds. `currentLayout` and `followLayout` in `files-page.ts` read
  it this way. Exception: a pull request draws a file that is all additions or all
  deletions with 3 columns even in split, saved or from `?diff=split`; a commit's
  one-sided file follows the layout. So `currentLayout` reads `"unified"` under Split
  while every mounted table is such a file, and a `followLayout` report can follow files
  mounting or unmounting, not only a Layout choice. The hunk cell's `colspan` is 4 in both
  layouts, so it doesn't tell the layout either. The 3 and 4 column counts were observed
  in Chromium 157 and Firefox 157 on 2026-11-10, on
  [sandbox PR #3](https://github.com/macintacos/gh-prism-sandbox/pull/3/changes),
  [sandbox commit `8d807ee`](https://github.com/macintacos/gh-prism-sandbox/commit/8d807ee),
  and the added file of
  [sandbox PR #9](https://github.com/macintacos/gh-prism-sandbox/pull/9/changes) under
  `?diff=split`. The hunk cell's `colspan`, the all-deletions half of the exception
  (cli/cli PR #14872 and `b564a77225`), and saved Split for the exception were read in
  Chromium 157 only (Firefox unchecked).
- **Expect a Layout choice to switch in place.** It doesn't navigate or reload: each
  `table` element stays connected while its rows and `colgroup` are replaced within about
  40 ms. `location` gains `?diff=split` or `?diff=unified` by history replacement, with no
  `popstate`, and nothing outside the tables marks the switch, so `followLayout` watches
  the tables (Chromium 157, signed in, 2026-11-10; Firefox unchecked).
- **Expect the menu's `aria-checked` to follow the layout on screen, not the saved
  choice,** including under `?diff=` on both page kinds. On a pull request whose files are
  all one-sided, it says Split while every table has 3 columns (Chromium 157, signed in,
  2026-11-10; Firefox unchecked). The Layout items carry `aria-keyshortcuts` `u` (Unified)
  and `s` (Split).
- **Find the gear as the only `button:has(.octicon-gear)` inside the row
  `findFilesToolbar` finds,** on both page kinds at 1280px and 700px wide;
  `findLayoutGear` in `files-page.ts` reads it this way. A commit's second, hidden gear in
  `#diff_file_tree > .d-md-none` sits outside that row. The gear carries
  `aria-haspopup="true"` and `aria-expanded` `"false"` or `"true"`, and no `aria-controls`
  (Chromium 157, signed in, 2026-11-10).
- **Test the gear against the captured toolbars:**
  `tests/fixtures/files-page-toolbar.html` (a pull request's, menu open) and
  `tests/fixtures/commit-page-toolbar.html`. Each fixture's header comment names its
  source page.
- **Re-check:** signed in, on `macintacos/gh-prism-sandbox` PR #3's Changes and on commit
  `8d807ee`, read the gear's `aria-labelledby` target text, its `data-testid`, and its
  ancestors. Click it, then read every `[role^=menuitem]` under `#__primerPortalRoot__`
  with its `role`, text, and `aria-checked`; on the pull request, hover Whitespace changes
  for its submenu. Load each page with `?diff=split`, then `?diff=unified`, then plain,
  and count the `td.diff-text-cell` per row. Open the commit's menu on a plain load and on
  a `?w=1` load without clicking any `menuitemcheckbox`. To check persistence, note the
  checked Layout item, choose Split, reload, read the layout, then choose the original
  item and confirm it is checked after a reload, and load `?diff=unified` while Split is
  saved. On the commit, count the gear role query's matches at 1280px and 700px wide and
  read which is visible. For the columns, load PR #3 and commit `8d807ee` each with
  `?diff=split` and `?diff=unified`, and PR #9 with `?diff=split`, and read
  `[...document.querySelectorAll('table[data-diff-anchor]')].map(t => t.querySelector('colgroup')?.childElementCount)`;
  for deleted files, use [cli/cli PR #14872](https://github.com/cli/cli/pull/14872) and
  [cli/cli@b564a77225](https://github.com/cli/cli/commit/b564a77225) after clicking Load
  Diff.

## Sticky headers

- **Read the band GitHub's sticky chrome covers from a file header's computed `top`.**
  Each file header (`[class*="diffHeaderWrapper__"]`, the region's first child) is sticky
  at a `top` equal to that band, on both page kinds. The `__` suffix keeps
  `diffHeaderWrapperWithMiniHeaderAndToolbar__` out.
- **Expect a pull request's `top` to follow `--base-sticky-header-height`,** which GitHub
  writes on `body`'s `style`, so watch that attribute and window resizes for changes.
- **Don't measure the sticky bar itself.** The commit page's bar has no stable hook, and
  the pull request's is `height: 0` until stuck.
- **Expect a pull request's collapsed sticky header to be a `--base-size-48` row over a
  `--borderWidth-thin` `--borderColor-default` divider.** That header is the bar of title,
  state, and review controls that stays at the top of the window once the page's header
  scrolls away. Its row is `[class*="miniHeaderInner__"]`, which centres Primer's 28px
  small controls. The divider is the bottom border of the row's parent,
  `[class*="StickyHeaderSlotBar__"]`. `panel.css` gives the Conversation panel's header
  the same box, so the two dividers meet on one line. Observed on gh-prism-sandbox's PR
  #10 on 2026-11-10.
- **Re-check:** on a public commit page, read the file header's computed `top` and compare
  it with the sticky bar's height, at both sides of the 1011px breakpoint. On a signed-in
  pull request, watch `body`'s `style` for `--base-sticky-header-height` while crossing
  1011px, and compare it with a file header's computed `top`. Scroll that pull request
  until its page header collapses into the sticky header, and read the rules for
  `miniHeaderInner__` and `StickyHeaderSlotBar__` from `document.styleSheets`. Then open
  the Conversation panel with Shift+\ and compare the bottom of `StickyHeaderSlotBar__`
  with the bottom of `.gh-prism-conversation-header`, in the panel's overlay mode and
  again after its pin button pins it as a column.

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
- **Expect the counter in the summary row under GitHub's `overview` feature.** With route
  data's `featureStates.overview` `"ENABLED"`, every header tab, Files changed included,
  leaves the `rightContentWrapper__` slot empty. The counter is a `[class*="diffStat__"]`
  in `[class*="branchGroup__"]`, after the branch names' own `.d-flex` (`branches__`). The
  branch group server-renders a skeleton in the counter's place and comes before the empty
  slot, so `prPage.diffstatSlot` lists both and takes the first in document order, and
  `findDiffstat` skips the branches. A classic header has no `branchGroup__`. Observed on
  the code-owners sandbox's PR #1 on 2026-11-09.
- **Re-check:** curl a public pull request's Conversation page signed out and read the
  `rightContentWrapper__` slot's child, then curl a public commit page and find its
  counter's "Lines changed" text. Grep the assets for `page_data/diffstat` and
  `PullRequestHeaderDiffStat`, as [§ Re-checking GitHub](#re-checking-github) describes.
  Signed in, load `/pull/<n>`, `/pull/<n>/commits`, and `/pull/<n>/checks`. Find the
  slot's counter on each, and confirm their embedded data has no
  `pullRequestsChangesRoute.diffContents`. On the code-owners sandbox's PR #1, which
  serves the overview to the saved `storageState`, read the `branchGroup__`'s children in
  the server's HTML and after hydration, and the two slots' document order.

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

## Generated files

- **Read GitHub's generated flag from route data** (observed 2026-11-09). GitHub marks a
  generated file (from `linguist-generated` or linguist's own rules) in the files page's
  embedded data: on a pull request,
  `payload.pullRequestsChangesRoute.diffContents[].newTreeEntry.isGenerated`; on a commit,
  `payload.commitRoute.diffEntryData[].newTreeEntry.isGenerated`. Not `diffSummaries`.
  Only a full load carries it, and only for the first batch of diffs. In the DOM, a
  generated file's diff shows a "Load Diff" placeholder reading "Some generated files are
  not rendered by default".
- **Key the flag by `newTreeEntry.path`.** It is the head path, the same key as
  `PrFileDiff.path`. A deleted file has `newTreeEntry: null`.
- **Match a commit page by SHA prefix.** `commitRoute.commit.oid` is always the full SHA,
  while a commit URL may name an abbreviated one.
- **Re-check:** full-load the Files changed tab of PR #3 (`complicated-change`) of a
  sandbox from `scripts/create-sandbox.sh`, parse
  `script[data-target="react-app.embeddedData"]` in the console, and confirm
  `src/generated/schema.rs` has `newTreeEntry.isGenerated: true`. Repeat on
  `macintacos/gh-prism-sandbox@9b57964`, loaded by its abbreviated SHA.

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
- **Read a team's whole roster from `/orgs/<org>/teams/<slug>/members?page=N` as HTML.**
  Each member is an `li.member-list-item` row. Its first `a[data-hovercard-url]` link
  points to `/users/<login>/hovercard`, which gives the login. A member with a display
  name has a second such link whose text is the name. An admin's rows add a checkbox cell.
  `?page=N` pages the list. Only an admin's single page was observed live; the multi-page
  paging and a non-admin's row are assumed, not seen. So the parse skips a row whose first
  link has no `/users/<login>/hovercard` with a valid login, and treats a name equal to
  the login as no name. A non-admin account viewing a team longer than one page would
  settle both.
- **Read a team's avatar from `/orgs/<org>/teams/<slug>/hovercard` with
  `X-Requested-With: XMLHttpRequest`.** Without the header it answers 406. With it, it
  answers about 1 KB of HTML, where the team page is 164 KB. Its first
  `https://avatars.githubusercontent.com/t/<id>` is the team's avatar, because the members
  it shows are `/u/<id>`. A team avatar has no URL by name, only by that ID. It ignores
  `s=32`: the avatar answered 420px wide on 2026-11-04, so the browser scales it. A team
  that doesn't exist answers 404, as does one the viewer can't see.
- **Build a user's avatar URL from the login, with no read:
  `https://avatars.githubusercontent.com/<login>?s=32`.** It answers a 32px image. The
  page's `content-security-policy` lists `avatars.githubusercontent.com` in `img-src`, so
  an `<img>` gh-prism adds loads.
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
  reads them. Signed in with the saved `storageState`, on the code-owners sandbox's PR #6,
  fetch `/orgs/excessive-dev/teams/platform/hovercard` with the header and without it, and
  a team that doesn't exist with it. Read each status and the first `t/<id>`, which was
  `t/20376992` on 2026-11-04. Load that avatar and
  `https://avatars.githubusercontent.com/<login>?s=32` as images and read their
  `naturalWidth`. Curl a pull request's headers and find `avatars.githubusercontent.com`
  in its policy's `img-src`.

## The Reviewers lists

GitHub draws a pull request's reviewers in one of two lists. The classic sidebar is
server-rendered in `#partial-discussion-sidebar`. GitHub's pull request overview, which
route data's `featureStates.overview` turns on, draws a React list instead. The saved
account gets the overview, so its facts below were read on 2026-11-08 on the code-owners
sandbox's PRs #1, #4, and #5, unless a bullet names GitHub's bundle or a maintainer's
screenshot of a work pull request, taken 2026-10-28.

- **Find a classic row as
  `#partial-discussion-sidebar form[id^="pull-request-reviewers-form-"] .css-truncate > div`.**
  Its first link goes to the reviewer: `/<login>`, or `/orgs/<org>/teams/<slug>` for a
  team. Suggested reviewers, such as Copilot, share the list and link to `/apps/<slug>`.
- **Expect the classic sidebar to be replaced, not updated.** GitHub swaps it out on every
  soft navigation back to Conversation and on its `reviewers_updated` socket event, so a
  listener bound to its nodes goes stale. Listen on `document` and match the target with
  `closest()` instead.
- **Find the classic Reviewers heading as
  `#partial-discussion-sidebar form[id^="pull-request-reviewers-form-"] > :is(details:has(> summary.discussion-sidebar-heading), h3.discussion-sidebar-heading)`.**
  It takes one of two shapes, as observed on the code-owners sandbox and nodejs/node on
  2026-11-05:
  - A viewer who can request reviews gets `details#reviewers-select-menu`, whose
    `summary.discussion-sidebar-heading` holds the floated gear and the word "Reviewers".
    The whole 320px row is the reviewers menu's trigger, with hotkey `q`, and its
    `details-menu` is `position-absolute right-0`. The `summary` row paints over a control
    placed before the `details`, so that control needs `position: relative` and a
    `z-index` to take the pointer.
  - Every other viewer gets a plain `h3.discussion-sidebar-heading`.
- **Never put a control inside the classic heading's `summary`.** A click there opens
  GitHub's reviewers menu. Put it before the `details` or `h3` instead. To keep it off the
  gear, place it absolutely: the Reviewers `.discussion-sidebar-item` is
  `position-relative` (observed 2026-11-06), and its rows span its full width. A float
  would push the gear off the row's end, where it sits over the rows' status dots. Don't
  add `position: relative` to the form, and don't wrap the heading: either moves GitHub's
  absolutely placed menu.
- **Expect the classic heading to be replaced along with its form.** GitHub replaces the
  whole Reviewers form, heading included, on soft navigation back to Conversation, so
  re-add a control beside the heading from an observer on `document`.
- **Find the overview Reviewers heading as
  `section[data-overview-sidebar-item][aria-label="Reviewers"] > h4[class*="disclosureHeading__"]`.**
  The `h4` wraps one full-width "Manage reviewers" button, the title at its start and a
  16px gear at its end, over the rows' status dots. The bundle's Reviewers section always
  draws this heading (read 2026-11-08). With no reviewer, the section draws
  `span[class*="emptyState__"]` reading "No reviewers" in place of the list, so match the
  section by its label, not by its list.
- **Place a control before the overview heading in flow, taking no height, never
  floated.** The section is a block with 12px of top padding, and the `h4` a block whose
  button is a 24px `display: flex` box with `-8px` inline margins. A flex container starts
  a block formatting context, so a float before the `h4` pushes the whole button below it.
  Never put a control inside the button: a click there opens GitHub's reviewers dialog.
- **Find a classic code-owner shield as `button[id^="codeowner-"]` or
  `button[id^="assigned-codeowner-"]`.** Its id names the reviewer:
  `codeowner-<org>/<slug>` for a team, and `assigned-codeowner-<login>` for a member the
  team's code review assignment picked on its behalf, as observed on the code-owners
  sandbox. A user's `codeowner-<login>`, for a user CODEOWNERS names, is inferred, not
  observed. Either button is `mr-2 btn-link muted-icon` around
  `span.reviewers-status-icon` and a 16px `octicon-shield-lock`, placed in the row after
  the status icon's `tool-tip`, which flex order puts it before. Neither button has an
  `aria-label`, so its id is the only place its reviewer can be read from.
- **Expect the classic shield's `tool-tip` to name it.** A Primer
  `<tool-tip for="codeowner-…" popover="manual">` reads "… is a code owner", and an
  assigned member's `<tool-tip for="assigned-codeowner-<login>">` reads "<login> is a code
  owner automatically assigned from <org>/<team>". Either is the shield's accessible name
  through `aria-labelledby`. Primer opens it as soon as the pointer enters the shield,
  before gh-prism's popup opens, as observed on the code-owners sandbox on 2026-11-04.
- **Expect GitHub's hovercard on the reviewer's `span[data-hovercard-url]`, never on the
  shield.** The span wraps the avatar and name; the shield sits outside it, after the
  status dot.
- **Find an overview row as `[class*="reviewerList__"] [class*="reviewerRow__"]`, and its
  icons in `[class*="indicators__"]`.** A requested reviewer's row is a `div` in an
  unclassed `li`. When a team's code review assignment picked a member, that `li` also
  holds `ul[class*="nestedMemberList__"]`, whose `li[class*="reviewerRow__"]` is the
  member's row. A suggested reviewer, such as Copilot, is an `li[class*="reviewerRow__"]`
  linking to `/apps/<slug>`. The identity link goes to `/<login>` or
  `/orgs/<org>/teams/<slug>`, as a classic row's does.
- **Find an overview code-owner shield as `button:has(> svg.octicon-shield)` among a row's
  icons.** The icons are Primer's 16px invisible `IconButton`s, the shield before the
  status dot. Each is named through `aria-labelledby` by the TooltipV2
  `span[popover="auto"]` right after it, reading "<org>/<team> is a code owner" for the
  shield and "<org>/<team>: pending" for the dot. Neither button has an `aria-label`, so
  the shield's reviewer is read from its tooltip. Its glyph is `shield`, not the classic
  `shield-lock`. Primer opens the tooltip as the pointer enters and on focus, before
  gh-prism's popup opens. A picked member's status is a `span[role="img"]` labelled
  "Awaiting requested review from <login>". A reviewer who has reviewed gets a "Re-request
  review from …" `IconButton` instead, from the bundle and the maintainer's screenshot.
- **Expect GitHub to shield only a pending code owner.** The overview draws its shield
  from a pending request's `isCodeOwner`, and not for a request assigned from a team: on
  the code-owners sandbox's PR #5, the member the team's review assignment picked has
  none, where the classic sidebar shields them with `assigned-codeowner-<login>`. A code
  owner who has reviewed has none either: the maintainer's screenshot shows reviewed code
  owners with only the re-request and status icons, and a pending one with the shield.
- **Expect `page_data/codeowners` to answer from the Conversation page**, with the same
  JSON as from Files changed.
- **Re-check:** signed in with the saved `storageState`, load the Conversation view of the
  code-owners sandbox's PR #1. Read `#partial-discussion-sidebar`'s Reviewers item and the
  Reviewers form's heading region, signed in and then signed out, hover a team's name and
  its shield to see which opens the hovercard, and fetch `page_data/review_requests` and
  `page_data/codeowners`, with the `X-Requested-With` header, from that page. For the
  overview, load the sandbox's PRs #1, #4, and #5 with the same `storageState`, which gets
  the overview, read each `section[aria-label="Reviewers"]` and its heading's and rows'
  boxes, and hover a shield to see its tooltip open. Grep GitHub's assets for
  `disclosureHeading__` and `"Manage reviewers"` for the heading the Reviewers section
  draws, as [§ Re-checking GitHub](#re-checking-github) describes, and read
  `featureStates.overview` from a pull request's route data. To stage a pull request that
  requests a user who owns files, have a push-triggered workflow on a throwaway branch
  open it as github-actions[bot], which needs "Allow GitHub Actions to create and approve
  pull requests" on for the org and the repo. For an assigned member's shield, also turn
  on the team's code review assignment.

## Comment headers

The classic Conversation tab server-renders its timeline. The overview's facts below come
from GitHub's bundle, not a capture, because no account here can open it.

- **Scope classic comment headers to `.js-discussion`.** It holds the timeline.
- **Call `findCommentAuthors` only on a Conversation page, and `findFilesCommentAuthors`
  only on Files changed.** The overview's headers have no timeline scope, unlike the
  classic's `.js-discussion`, so its selector would also match the new Files changed
  page's threads.
- **Colour a shield outside the Reviewers sidebar yourself.** GitHub scopes `.muted-icon`
  to `.discussion-sidebar-item`, so elsewhere it does nothing and `btn-link` paints a link
  colour (as of 2026-11-05).
- **Find a classic comment's author as `.timeline-comment-header h3 strong > a.author`.**
  That holds for the description, a timeline comment, and a review with a body.
- **Find an inline thread comment's author as `.review-comment h3 strong > a.author`.** A
  `.review-comment` (id `discussion_r<id>`) has no `.timeline-comment-header`: its header
  is its own first child.
- **Count a review with a body by its comment box's header only.** Its item also carries a
  `.TimelineItem-body` "commented" line with an author link; skip that line.
- **Find a body-less review's author on its `.TimelineItem-body > div > strong > a.author`
  line,** above its threads. It has no `.timeline-comment-header`. A user's link goes to
  `/<login>` with `data-hovercard-type="user"` and
  `data-hovercard-url="/users/<login>/hovercard"`. A review's timeline item is
  `[id^="pullrequestreview-"]`; GitHub repeats the id on a review with a body's comment
  group, and both hold its `.timeline-comment-header`, so a review item without one is
  body-less.
- **Expect an app's author link to go to `/apps/<slug>`, with no `data-hovercard-type`,**
  and a `span.Label` reading "Bot" after it inside the `<strong>`.
- **Expect the role label in the header's right column, not beside the author.** "Author"
  is a `span.Label` inside `div.d-none.d-sm-flex`, after the comment actions, so it is
  hidden at narrow widths. The description's column is empty.
- **Expect no code-owner shield in an overview comment header.** GitHub's bundle draws one
  only in the Reviewers lists, as of 2026-11-05. On the classic tab it is unobserved: the
  only captures are from a repository without CODEOWNERS.
- **Expect a soft navigation back to Conversation to re-insert the timeline,** so a
  header's nodes are new each time.
- **Find a classic inline thread as `review-thread-collapsible`,** whose `data-resolved`
  reads `"true"` or `"false"`.
- **Find an overview comment header as `[data-testid="comment-header"]`.** Issue comments,
  review summaries, and inline thread comments all render GitHub's shared
  `ActivityHeader`. Its author link is `[data-testid="avatar-link"]` in
  `[class*="TitleContainer__"]`, going to `/<login>`, or to `/apps/<slug>` with an
  `AuthorTypeLabel__` `Label` beside it, reading "Bot", "AI" for an agent, or "mannequin".
  Role labels (`Member`, `Author`) sit in `[class*="BadgesGroupContainer__"]`, in the
  right column.
- **Don't key an overview author on `data-hovercard-type`.** Server-rendered HTML has no
  hovercard attributes until hydration.
- **Expect an overview `COMMENTED` review that is not hidden, with no body and one thread,
  to have no header of its own.** The bundle's condition has two more terms no one has
  identified. It renders only
  `div[role="group"][data-testid="review-thread-focus-target"]`, labelled "Review comment
  by <login>", around its thread, whose comment header carries the author.
- **Re-check:** signed in with the saved `storageState`, load macintacos/gh-prism-sandbox
  PRs #1, #3, and #5, and read `.js-discussion`'s timeline items and their
  `pullrequestreview-` ids. For a classic comment header's code-owner shield, load a
  commented PR on excessive-dev/gh-prism-codeowners-sandbox once EXC-2257 stocks it. For
  the overview, grep GitHub's assets for `ActivityHeader`, `comment-header`, and
  `TitleContainer__`, as [§ Re-checking GitHub](#re-checking-github) describes.

Files changed's review comments, as of 2026-11-05:

- **Scope a new Files changed comment header to its `[data-testid="review-thread"]`.**
  Only a diff's review comments count, the same guard as the classic page's `#files`. Each
  comment's header is the overview's `ActivityHeader`, and its name link
  `a[data-testid="avatar-link"]` sits alone in its title container, so its `after()` is
  right after the author's name.
- **Expect the new page's avatar link to carry no test id,** so the test-id selector finds
  one link per comment.
- **Expect virtualization to mount a diff's threads on scroll and unmount them when
  scrolled away.** A remount brings fresh nodes, with no shield beside them.
- **Listen for a click inside the new page's diffs in the capture phase.** Its React root
  calls `stopPropagation()` on clicks in a review thread, so a bubble listener on
  `document` never hears them. Re-check with one capture and one bubble `click` listener
  on `document`, then a click in a thread: only the capture one fires.
- **Find a classic Files changed comment's author as
  `#files .js-inline-comments-container .review-comment h3 strong > a.author`, with the
  `strong` as its name.** The avatar is an unlinked `<img>`, so there is one profile link
  per comment.
- **Expect a resolved classic thread to render collapsed, holding only an
  `include-fragment`.** Its author link is absent until a click fetches and inserts it.
- **Expect the PR header's author, `#partial-discussion-header a.author`, outside
  `#files`,** so the `#files` scope leaves it out. A signed-out viewer of a public
  repository's classic page still sees shields, as
  [§ Code owners and reviewers](#code-owners-and-reviewers) describes.
- **Re-check:** signed in with the saved `storageState`, load macintacos/gh-prism-sandbox
  PR #3's `/changes`, scroll its threads in and out, and read their headers. Signed out,
  load a public pull request's `/files` with inline comments and read `#files`' threads,
  and curl its `page_data/codeowners` with no cookies. Once EXC-2257 stocks it, use
  excessive-dev/gh-prism-codeowners-sandbox for both.

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

## The Conversation frame

- **Create and navigate the frame from the content script, never the page's main world.**
  Files changed's
  `frame-src viewscreen.githubusercontent.com notebooks.githubusercontent.com` refuses a
  frame created from the main world, but not one created from the content script's
  isolated world.
- **Expect a pull request page to answer a `HEAD` with its full
  `content-security-policy`**, plus `x-frame-options: deny` and `frame-ancestors 'none'`.
  The policy carries no nonce, only a sha256 hash, so a policy fetched just before the
  frame loads is valid for that load.
- **Find the framed page's chrome as `.js-header-wrapper` and
  `header[class*="prc-PageLayout-Header-"]:has(nav[class*="TabNav__"])`.** The title bar,
  its sticky copy, and the tab row all sit in that one header.
- **Expect the frame to load GitHub's pull request overview for a viewer who has it, and
  find its chrome as
  `header[class*="prc-PageLayout-Header-"]:has(nav[aria-label="Pull request"])` and
  `[data-testid="diff-comparison-viewer-sticky-header-slot"]`.** The header holds the
  title, the code, notifications, and Preview buttons, the state, author, branches, and
  diffstat, and the tab row. The sticky title bar, with Status, Review, and the side-panel
  toggle, sits outside it, first in `#diff-comparison-viewer-container`, and shows at all
  times. Below them a second, nested
  `[class*="PageLayout-PageLayoutRoot"][class*="wrapper__"]` holds the merge box,
  description, and comments, and the sidebar's `section[data-overview-sidebar-item]`s.
  GitHub gives its `[class*="PageLayout-PageLayoutContent"]` a 24px `margin-block`. The
  classic Conversation nests a `wrapper__` root of its own module around its timeline, at
  16px, so key the overview's on its sidebar items. Observed on the code-owners sandbox's
  PR #1 on 2026-11-08.
- **Read which page the frame loads from Files changed's own header tab row.** Its first
  tab links to the pull request itself and reads `Overview`, matching
  `nav[aria-label="Pull request"] [data-content="Overview"]`, for a viewer GitHub serves
  the overview, and `Conversation`, with a count, for everyone else: GitHub's bundle
  pushes one tab or the other (read 2026-11-08). Route data's `featureStates.overview`
  reads `"ENABLED"` alongside, but the tab is what GitHub links to. `prPageName` in
  `files-page.ts` reads it, and the panel takes its name and jump targets from it.
- **Find the framed page's site footer as `footer.footer[role="contentinfo"]`.** It is the
  page's only `<footer>`, a sibling after `.application-main`, so hiding it leaves no
  wrapper or spacing behind.
- **Find Files changed's toolbar row as
  `section[class*="toolbar__"]:has([class*="RegularTreeToggle"])`.** A press on a button
  prepended to it can make React hydrate the toolbar and re-mount the button mid-press, so
  no `click` fires; `panel.ts`'s `attach` handles the press itself.
- **Expect the toolbar row to space exactly two `[data-component="Stack"]` groups apart
  with `justify-content: space-between`:** the start group holds the tree toggles and All
  commits, the end group the review controls. A third item prepended to the row splits the
  free space and strands the start group mid-row, so `panel.css` gives the end group
  `margin-inline-start: auto`.
- **Expect the `diffComparisonViewer` container to carry 32px of inline padding against
  its `width >= 1012px` query.** GitHub swaps `RegularTreeToggle` for `MobileTreeToggle`
  and undocks the tree below a 1076px page, not a 1012px one. Both toggles stay in the
  DOM; the hidden one is `display: none`. A commit page has no such container and docks
  its tree down to a 768px window.
- **Expect GitHub's right-hand panel inside the `diffComparisonViewer` container, which
  docks the tree on the container's whole width.** Merge status, and the Alerts, Comments,
  Copilot, Manage batch, and Overview panels its header's dropdown switches to
  (`?panel=mergeStatus`, `alerts`, `comments`, `copilotChat`, `manageBatchReviewComments`,
  `overview`), are one Primer `SplitPageLayout.Sidebar`:
  `#diff-comparison-viewer-container [class*="PageLayout-SidebarWrapper"]`, a flex item
  beside `[class*="PageLayout-PageLayoutWrapper"]`. Closed, it stays mounted at 0px wide.
  Open, it's 450–768px wide (plus a 3px divider), a per-user width GitHub saves on the
  server as `docked_panel_width`. Primer also caps it at the viewport less 959px (less
  511px below a 1280px viewport). While it's open, the container sets
  `data-side-panel-open="true"` and drops its right padding. The tree still docks while
  the container's content box is 1012px wide, so the panel counts as room for the tree and
  diffs: beside a 580px panel, a 1215px page leaves the diffs 168px. GitHub's layout needs
  a 1044px page plus the panel to keep the 1012px it docks at. GitHub opens, switches, and
  closes the panel with `history.replaceState` on `?panel=`, which fires no event, so
  `followRightPanel` in `files-page.ts` watches the panel's box with a `ResizeObserver`,
  and `panel.ts` takes its width from the pinned column's room.

  Re-check: on a pull request's Files changed, open Merge status from the header's
  **Status** button. Read the wrapper's width and the container's `data-side-panel-open`
  and padding, and confirm the URL changed with no `popstate`. Switch panels through the
  dropdown and confirm each is the same wrapper at the same width.
- **Expect Primer's Dialog to read `<html>`'s padding into `--prc-dialog-scrollgutter` on
  `<body>`.** `panel.css` accounts for it.
- **Expect GitHub to wrap its whole app in `[data-turbo-body]` with `isolation: isolate`,
  `#__primerPortalRoot__` (`z-index: 1000`) included.** Every menu, drawer, dialog, and
  hovercard GitHub opens sits in that one stacking context, so a fixed element in `<body>`
  outside it draws above all of them at any positive `z-index`. `panel.css` sets the
  wrapper's `isolation` back to `auto` and stacks the panel at
  `calc(var(--zIndex-sticky) - 1)`, Primer's `--zIndex-sticky` being 100 on `:root`.
  Nothing in the page outside the portal root stacks between 11 and 100 apart from the
  hovercard (100).
- **Expect GitHub's router to take a link appended to Files changed's `<body>` and clicked
  as a soft navigation.** `panel.ts`'s `follow` relies on it, as the commit card does.
- **Override the framed page's container, `#diff-comparison-viewer-container`, with
  `!important`.** It carries Primer's `tmp-mt-4`, a `margin-top` that is `!important`, so
  `frame.css` loses without it.
- **Find the framed merge box's checks as
  `[data-testid="mergebox-partial"] section[aria-label="Checks"]`.** A merged pull
  request's merge box has none. The hook keys on the English label `Checks`. The overview
  has no `mergebox-partial`: its page opens on the merge box,
  `section[aria-label="Recommended action"]` over a `section[aria-label="Merge status"]`
  grid of checks, comments, and approvals.
- **Find the framed sidebar as `#partial-discussion-sidebar` and the timeline as
  `.js-discussion`.** GitHub draws the sidebar below the timeline in a narrow frame, and
  beside it from about a 780px panel width.
- **In the framed overview, find the Reviewers section as
  `section[data-overview-sidebar-item][aria-label="Reviewers"]` and the main column as
  `[data-component="SplitPageLayout.Content"]`, the page's only one.** The sidebar's
  Activity section comes before Reviewers. GitHub draws the sidebar below the main column
  in a 320px or 380px panel, and beside it in an 820px or 1000px one.
- **Read the framed page through the frame's `contentDocument`.** The frame is
  same-origin, so the content script reads and scrolls it directly, with no message relay.
- **Expect Firefox's declarativeNetRequest to name no initiator for a frame whose `src`
  the content script sets (Firefox 159, checked 2026-11).** `initiatorDomains` never
  matches that load, though `excludedInitiatorDomains` does, so in Firefox the framing
  rule drops `initiatorDomains` and excludes githubusercontent.com initiators, GitHub's
  sandbox frames. The tab, the marked URL, and the rule's lifetime bound it there.
- **Expect Firefox to keep a hidden page's extension ports open in its back-forward cache
  (Firefox 159, checked 2026-11).** The background never hears that page's port close, so
  `allowConversationFrame` ends the framing port on `pagehide` (`untilPagehide` in
  [`utils/github/conversation-frame.ts`](../../utils/github/conversation-frame.ts)).
- **Re-check:** curl `HEAD` on a pull request and read the three headers. Signed in with
  the saved `storageState`, add an `<iframe>` to Files changed from `page.evaluate`, then
  from the extension, and compare the console's CSP refusal. Read the header's and the tab
  row's markup on the Conversation tab. In the open panel, read the container's computed
  `margin-top`, query the checks, sidebar, and timeline hooks on an open and a merged pull
  request, and compare the sidebar's left edge to the timeline's right edge as you widen
  the panel past 780px. Read the toolbar row's `justify-content` and children, and the
  container's padding and the window at which `RegularTreeToggle` turns `display: none`.
  With the panel pinned, open the ☰ drawer and use `elementFromPoint` inside it to check
  that it draws above the panel. Read `#__primerPortalRoot__`'s ancestors for `isolation`,
  and read `--zIndex-sticky` on `:root`. In Firefox, with the panel open, read
  `browser.declarativeNetRequest.getSessionRules()` from gh-prism's Inspect console in
  `about:debugging`; leave the pull request by a full load and read it again. For the
  overview, the saved `storageState` serves it: open the panel on the code-owners
  sandbox's PR #1 and read the frame's header, sticky slot, and nested content's
  `margin-top`, the Reviewers section's left edge against the main column's right at a
  narrow and a wide panel, and Files changed's first `nav[aria-label="Pull request"]` tab.
  Signed out, the same pull request's marked URL serves the classic Conversation. Grep
  GitHub's assets for `label:"Overview"` to find the tab row's two forms.

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
