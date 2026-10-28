# Architecture

*Audience: contributors and coding agents learning how gh-prism works before they change
it.*

gh-prism is a Chrome extension built with WXT, a framework for browser extensions. It has
two parts: a service worker that fetches pull request data, and a content script that
reshapes GitHub's Files view and reads a pull request's code owners and reviewers itself.
Each section below names the module behind its claims, so you can read the code next.
Terms such as visit, page, intent, and landing are defined in
[`CONTEXT.md`](../CONTEXT.md).

## Overview

The service worker in [`entrypoints/background.ts`](../entrypoints/background.ts) reads
diffs and file contents from github.com. It serves them to content scripts over a
long-lived message port, defined in
[`utils/github/pr-port.ts`](../utils/github/pr-port.ts). It also clears the intent cache
whenever the extension is installed, updated, or reloaded in development, and on a fresh
install it marks the installed version's what's-new notes dismissed.

The content script in [`entrypoints/content/index.ts`](../entrypoints/content/index.ts)
runs on every github.com page at `document_start`, so its watcher is in place before
GitHub first renders the page. It cannot match only Files view URLs, because of GitHub's
soft navigation: GitHub swaps in a new page without loading a new document, so a script
matched to pull request URLs would never be injected when you click through to one.
Instead, it watches every page for a Files view to appear, for a pull request's header
tabs, where it shows the diffstat and, on Conversation, a code owner's files, and for a
pull request's classic page, where it opens a dialog instead.

## Page kinds

[`entrypoints/content/files-page.ts`](../entrypoints/content/files-page.ts) is the one
script module that holds selectors into GitHub's Files view markup. Each kind of Files
view is a `PageKind`: a pull request's Files changed tab (`prPage`) and a commit's page
(`commitPage`). A `PageKind` lists where that page keeps its sidebar, native tree, diff
list, and diffstat, and how a row's link reveals its diff. A pull request's kind also
names the narrow layout's overlay copy of the sidebar.

`findFilesPage` tries each entry of `PAGE_KINDS` in turn and returns the first whose
sidebar, native tree, and diffs are all present, passing over the overlay's copy. Callers
then ask `files-page.ts`'s helpers rather than branching on the kind, so a new page kind
is a new `PAGE_KINDS` entry.

[`utils/github/files-route.ts`](../utils/github/files-route.ts) reads the URL side: which
diff a pathname names, and whether a pull request's view is commit-filtered. It reads the
classic page's `/files` and `/commits/<sha>` too, which GitHub redirects to `/changes` and
`/changes/<sha>` wherever it shows the new page.

`findClassicPage` finds a pull request's classic page instead: GitHub's toolbar above the
diffs and the toolbar's review tools. `isSignedIn` reads whether GitHub served the page to
a signed-in viewer.

`readHeaderTabPr` reads which pull request a header tab (Conversation, Commits, or Checks)
belongs to, and `findHeaderPage` finds that tab's diffstat slot in the header.

## The visit lifecycle

[`entrypoints/content/visit/watch.ts`](../entrypoints/content/visit/watch.ts) follows
visits across GitHub's navigation. A visit is one stay on a Files view's pathname, or on
one pull request's header tabs, and a page is one render of its markup. GitHub may replace
the markup several times in one visit, so `watchFilesPages` reports each replacement as a
new page.

The watcher wakes on first load, on GitHub's `soft-nav:end` event, and on `popstate`. Each
wake starts a 10-second settle window. During that window a mutation observer checks
whether the page is still connected. Once the sidebar, native tree, or diffs container
(the diff list's parent) is disconnected, the watcher aborts that page and hands over the
replacement as a new page. A list swap inside the container is not a new page; `order.ts`
follows it. A pathname change aborts the whole visit. A hash change, which every file
click makes, is not a new visit. When the window ends on a Files view path with no markup
found, not even the classic page's, the watcher warns once and leaves GitHub's tree alone;
the next wake still starts a new settle window. `watchClassicPages` follows the classic
page the same way, through the same settle windows, and never warns. So does
`watchHeaderPages`, for a pull request's header tabs: its page is the header's counter
slot, and moving between one pull request's header tabs keeps the visit, so the mounted
counter stays without a new read. Leaving for Files changed, another pull request, or
anywhere else ends it.

```mermaid
stateDiagram-v2
    [*] --> Settling: load, soft-nav end, or popstate
    Settling --> Page: Files view markup found
    Page --> Page: within 10 s, sidebar, tree, or diffs container disconnected
    Page --> Settling: pathname changes, so the visit aborts
    Settling --> Missing: 10 s pass with no markup, new or classic
    Page --> Idle: 10 s pass, observer stops
    Idle --> Settling: next soft-nav end or popstate
    Missing --> Idle: warn once
```

[`entrypoints/content/visit/land.ts`](../entrypoints/content/visit/land.ts) runs on each
page. `showVisit` mounts six views (the sidebar sections, the diff order, the j/k file
keys, the diffstat, and the on-screen and Viewed trackers that feed the sidebar). Then
`land` passes the intent read's steps to the views: pending while the read runs, and with
an owner filter until the code owners land too; progress as files are placed, landed with
the result, and then each file's section. Every view gets a step before any view gets the
next. `land` owns the only observer of the native tree, and it re-lists the sections after
each change to the tree. While a pull request's narrow layout has its "Files" overlay
open, `land` also observes the overlay's copy of the tree and lists from it, telling each
view through `shownIn` before it re-lists. One visit reads intent once: `index.ts` wraps
the read in `shareIntent`, so every page of the visit joins the same read. A header tab's
visit reads intent the same way, and `showHeaderTab` mounts only the diffstat on each of
its pages once the read lands, skipping a page dropped before then.

## The classic page notice

[`entrypoints/content/classic/notice.ts`](../entrypoints/content/classic/notice.ts) runs
on each classic page. `showClassicNotice` opens a native modal `<dialog>` that says why
gh-prism isn't running there and how to get the new page: signed out, sign in; signed in,
turn on GitHub's New Files Changed Experience preview. Closing it any way, by its buttons,
Esc, or a click outside it, dismisses it. A **Why is gh-prism off?** button beside the
toolbar's review tools opens it again. `index.ts` reads the dismissal from
`classicNoticeDismissed` in [`utils/prefs.ts`](../utils/prefs.ts) before watching, shares
it across the tab's pages, and saves it on each close.

## The what's-new block

After an update, the sidebar opens with a collapsed what's-new block holding the installed
version's release notes, built by
[`entrypoints/content/sidebar/whats-new.ts`](../entrypoints/content/sidebar/whats-new.ts).
The release workflow passes the notes into the build as `WXT_RELEASE_NOTES`, so nothing is
fetched at runtime.
[`entrypoints/content/ui/markdown.ts`](../entrypoints/content/ui/markdown.ts) renders them
from a small Markdown subset as plain DOM, never HTML.
[`utils/whats-new.ts`](../utils/whats-new.ts) decides when the block shows: from the first
view of a version until the reviewer dismisses it or 3 days after that view. `index.ts`
reads `whatsNewSeen` from [`utils/prefs.ts`](../utils/prefs.ts) before the first render,
and watches it only if, at the tab's startup, the block can still show, since a dismissed
or expired version never shows again. A dismissal in one tab drops the block from the
others on their next page. On `runtime.onInstalled` with reason `install`,
[`entrypoints/background.ts`](../entrypoints/background.ts) marks the installed version
dismissed, so only an update shows the notes.

## The report link

`showReportLink` in
[`entrypoints/content/sidebar/report.ts`](../entrypoints/content/sidebar/report.ts) adds a
link after the docked file tree's filter-options button on each page. It opens a new issue
on gh-prism's repo with the **Report miscategorized file** form
([`.github/ISSUE_TEMPLATE/miscategorized.yml`](../.github/ISSUE_TEMPLATE/miscategorized.yml))
selected and the extension version prefilled. It prefills the diff's URL only when
`isPublicRepo` in [`files-page.ts`](../entrypoints/content/files-page.ts) confirms from
the page's `<head>` that the route's own repo is public; otherwise it leaves the URL out,
so a private diff's address never reaches a public issue.

## The owner section

`showOwnerSection` in
[`entrypoints/content/sidebar/owner-section.ts`](../entrypoints/content/sidebar/owner-section.ts)
adds an "Only files owned by…" group to GitHub's file-tree filter menu on each page of a
pull request, from the visit's code owners and PR reviewers (see § Code owners and
reviewers). GitHub renders that menu in a portal only while it is open, so
`followFilterMenu` in [`files-page.ts`](../entrypoints/content/files-page.ts) watches
`body` with an undebounced `MutationObserver`, like `followOverlay`, and reports each open
with a signal that aborts when it closes. It reports the menu again when GitHub replaces
its list or mounts its owned-by item into an open menu, so "Me" joins late. The section is
added again on every report, before the menu first paints, and not at all in a repository
without CODEOWNERS. `findFilterMenu` recognizes the menu only by its labelling button
inside the filter row and the groups, divider, and items the section copies; anything
else, and gh-prism leaves the menu alone.

The entries are copies of GitHub's own divider, group, and first item (`copyMenuDivider`,
`copyMenuGroup`, `copyMenuItem`, all in `files-page.ts`), so Primer's hover, focus, and
checkmark stay native. "Me" stands in for GitHub's "Only files owned by you" rather than
moving it, since React owns that node: a pick on "Me" forwards a `.click()` to GitHub's
item, whose group the sheet hides as the section's next sibling. The hidden item also gets
the `disabled` attribute, because a hidden item traps Primer's arrow keys and its focus
zone skips only disabled ones. "Me" shows only when GitHub's item does. The reviewers are
`owningReviewers` in [`utils/github/code-owners.ts`](../utils/github/code-owners.ts):
those who own a changed file, directly or through a team they review for, leaving out your
own login. A reviewer stays after submitting a review, since `review_requests` lists
reviews as well as requests. Without the PR reviewers the section offers "Me" alone;
without the code owners it adds nothing.

A reviewer pick loads the page, through `withOwner` in
[`utils/github/files-route.ts`](../utils/github/files-route.ts), because the owner filter
is read once per page and `land` never un-hides a file. "Me" picked while a gh-prism owner
is on loads `withViewerOwner`'s URL for the same reason. Each entry closes the menu by
dispatching `Escape` on itself, since Primer neither picks nor closes for an item it
didn't render.

## Intent and its cache

gh-prism lists each changed file in one of five sections, such as Implementation or Tests.
A file's path picks its section, unless a hunk rule claims some of its changed blocks for
Docs & Comments or Tests by what they change. The docstring rule moves an Implementation
file whole when every hunk is docstring-only, and moves its docstring-only hunks alone
only when no hunk stays in Implementation as code. Intent is where the hunk rules place a
diff's files. It also counts, per file, the changed lines the comment scan confirms are
comments or docstrings in hunks that stay in Implementation; a line only an unread head
could confirm counts as code. `intentFor` in
[`utils/intent/read.ts`](../utils/intent/read.ts) finds it in three steps, cheapest first:

1. **Pin hit.** The diff pin, the base and head commits that the page's embedded data
   names, keys a cache entry. A hit returns without connecting to the service worker.
2. **Diff-key hit.** Otherwise it fetches the diff's file list and hashes it with the head
   commit. A hit returns the cached intent and also stores it under the pin.
3. **Read.** Otherwise `readIntent` places every file, reading each file's head where a
   hunk rule needs it, at most six at once. It caches the result under both keys, unless a
   rate limit or failure cut a file's read short.

A commit-filtered view skips all three and keeps path-only sections.

```mermaid
flowchart TD
    start([intentFor]) --> filtered{commit-filtered?}
    filtered -- yes --> pathOnly[path-only sections]
    filtered -- no --> pin{pin hit in cache?}
    pin -- yes --> done([landed intent])
    pin -- no --> list[fetch file list, hash with head]
    list --> key{diff-key hit?}
    key -- yes --> done
    key -- no --> read[readIntent: place every file]
    read --> store[cache under diff key and pin]
    store --> done
```

[`utils/intent/cache.ts`](../utils/intent/cache.ts) keeps intent in extension storage.
`index.ts` sizes it to 50 entries; a pinned diff takes two, one under its diff key and one
under its pin. Each store moves its key to the front of an index and drops the entries
past the limit, so the cache keeps the 50 most recently stored keys. A cache hit alone
does not refresh its entry. Entries live under the `intent.v2` key prefix; a new stored
shape takes a new prefix, so an older entry never validates. The service worker clears the
cache on install, update, and dev reload, because a new build may place files differently,
and the clear also drops the retired `intent.v1` entries.

## Code owners and reviewers

[`utils/github/code-owners.ts`](../utils/github/code-owners.ts) reads who owns each
changed file and who reviews the pull request from two endpoints GitHub's pull request
pages read, `/<owner>/<repo>/pull/<n>/page_data/codeowners` and
`/<owner>/<repo>/pull/<n>/page_data/review_requests`. The content script fetches them
itself, same-origin with your session, rather than through the service worker: they need
no host but github.com, and no cache, since a review submitted while the tab is open must
show on the next visit. `index.ts` starts two reads once per visit, `readCodeOwners` from
`codeowners` and `readPrReviewers` from `review_requests`, and hands their promises to
every page of that visit: `showVisit` and `showOwnerSection` take both. A commit page
reads nothing. A pull request's header visit reads both once per visit too, but only when
a Reviewers list first shows on the Conversation tab.

The code owners are each changed file's owners, in CODEOWNERS order, with whether you own
the file. The PR reviewers are everyone requested to review, then everyone who submitted a
review, commenting included, each as an `@user` or `@org/team` token with the teams GitHub
names them as reviewing for: those a review of theirs was on behalf of, and the team a
pending request was assigned from. GitHub names a team only to a viewer who can see it, so
a viewer outside the organization gets no teams. A reviewer also carries whether GitHub
marks their pending request as a code owner's, which it can do without naming the team. An
owner keeps its token as written and gets a link only when the token is a valid `@user` or
`@org/team`; gh-prism builds the URL and never takes one from the response.

A PR reviewer owns a file when its owners include the reviewer's token, or one of the
teams GitHub names the reviewer as reviewing for, ignoring case. `ownerFilter` holds that
rule, and the owner filter, the owner section, and the Conversation popup all ask it, so
picking a reviewer in the section keeps the files their popup lists.

A user may also belong to an owning team, whatever they own directly. `withMemberTeams`
adds each owning team that lists them as a member, and that GitHub doesn't already name
for them, to the teams they review for. It reads each team among the changed files' owners
once, through `readTeamMembers`, from the JSON GitHub's team mentions read, and GitHub
returns only a large team's first members. It reads members only when GitHub shows the
viewer a team among the PR reviewers, because a viewer outside the organization sees none
and gets 404 for every team. `index.ts` runs it on the PR reviewers once both reads land,
and hands every reader the result, so every reader sees the same teams.

Each read settles on its own: one that fails, or whose response misses a field it expects,
resolves to `undefined` and logs one warning naming it, and the other read is unaffected.
A failed PR reviewers read drops the owner section's reviewer entries and narrows the
owner filter to the owner's own token. A repository without CODEOWNERS resolves to no
owners.

The owner filter is the first reader of the code owners. `index.ts` reads the
`gh-prism-owner` query parameter on a pull request's pages with `ownerOf` in
[`utils/github/files-route.ts`](../utils/github/files-route.ts), and `showVisit` turns it
and the visit's code owners and PR reviewers into the filter `land` applies to the tree's
files before sectioning them. A file is kept when the parameter's token owns it, as above.
Every view therefore follows the narrowed listing as it follows GitHub's own filters,
while section line totals and the diffstat keep counting the whole diff. `land` also hands
the views the dropped files' diff anchors, kept for the whole page so a file stays hidden
after its row leaves the tree, and `diffs/order.ts` hides their diffs: by a rule on each
region and virtualized row (`#diff-…` and `data-path-digest`) that a pull request's
`hiddenDiffSelectors` in `files-page.ts` scopes to the diff list, and by a
`data-gh-prism-hidden` attribute on a progressive list's entries, to close their gaps.
With the parameter set, the page stays pending until the reads the filter needs land: the
code owners for a team, and the PR reviewers too for a user. It waits 10 s at most, then
treats a read still out as failed, so a failed code owners read keeps every file and a
failed PR reviewers read keeps the user's own.

The sidebar's shields are another reader. `showVisit` in
[`visit/land.ts`](../entrypoints/content/visit/land.ts) hands the owners to the sidebar
once they land, and drops them if the page has gone. `SectionTree` in
[`sidebar/section-tree.ts`](../entrypoints/content/sidebar/section-tree.ts) marks each
owned file's rows in every section, and the `@pierre/trees` patch draws a shield beside
each, shown in place of the file icon while its row is hovered or focused. Resting the
pointer on a shield for 200 ms, focusing it, or clicking it opens a popover listing the
file's owners, built by
[`sidebar/owners-popover.ts`](../entrypoints/content/sidebar/owners-popover.ts) and
removed, with its listeners, once it closes. Hover and focus go through
`followHoverIntent`, as the Conversation popup's do, following each tree's shadow root,
because a move between a row and its shield never reaches the document. A popover that
hover or focus opened closes as the pointer or focus leaves; a click keeps it open with
focus inside. The sections view also closes it before moving into or out of the narrow
layout's overlay, since a popover that leaves the document closes without a toggle event.
A pointer click on the shield of a popover a click opened only closes it. Showing a file's
owners never changes its section or the diffstat.

On the Conversation tab, a code-owner shield beside a PR reviewer in a Reviewers list
opens a popup listing the changed files that code owner owns, built by
[`conversation/reviewer-files.ts`](../entrypoints/content/conversation/reviewer-files.ts).
GitHub draws two Reviewers lists: the classic sidebar, server-rendered in
`#partial-discussion-sidebar`, and the React list of its pull request overview.
`findReviewerRows` in [`files-page.ts`](../entrypoints/content/files-page.ts) finds each
row's reviewer, GitHub's shield, and its column of status icons in either. GitHub shields
a code owner's pending request only, so a code owner who has reviewed loses the shield.
`followReviewerRows` reports the rows on each change to the page, and the popup adds
gh-prism's own shield to every row whose PR reviewer owns a changed file, or whom GitHub
marks a code owner, but has no shield. That shield is a button drawn as GitHub draws its
own in that list, placed just before the row's last icon, the status icon, where GitHub
puts its shield. Hovering or focusing either shield opens the popup. A click on either
changes nothing: GitHub's shield has no action of its own, and gh-prism's leaves its click
free.

The popup lists the files `ownerFilter` gives the shield's `@user` or `@org/team` token,
counting the teams GitHub names for that reviewer, and names those teams, each linked to
its team page. A code owner GitHub marks without naming a team, and whose own token owns
nothing, gets one sentence saying GitHub hides the team. Any other code owner who owns no
changed file opens nothing. It rides the header visit, so it runs only where
`findHeaderPage` finds the counter's slot. The popup's listeners sit on the document for
the whole visit, because GitHub replaces the classic sidebar's nodes mid-visit. When to
open and close it is `followHoverIntent` in
[`ui/hover-intent.ts`](../entrypoints/content/ui/hover-intent.ts). The popup and the file
shields' popover share one placer, [`ui/place.ts`](../entrypoints/content/ui/place.ts).

The owner section is the third: it lists the reviewers who own a changed file (§ The owner
section).

## Section rows

[`entrypoints/content/sidebar/sections-view.ts`](../entrypoints/content/sidebar/sections-view.ts)
draws the sidebar's sections. GitHub's native tree stays mounted and hidden as the source
of truth, and each render re-reads its rows. A click on a section's row clicks the native
row's link. That link's handler mounts a diff that GitHub has virtualized away, which a
bare hash jump would not do. While the narrow layout's overlay is open, the sidebar moves
into the overlay's copy of the tree, which then serves as the source and takes the row
clicks, and it moves back to the docked tree when the overlay closes.

[`entrypoints/content/sidebar/section-tree.ts`](../entrypoints/content/sidebar/section-tree.ts)
renders each section, and the comment-lines sub-section, as its own `@pierre/trees` file
tree in a shadow root. A tree's height follows its visible rows, so the whole sidebar
scrolls as one. The sections view calls each tree's `sync()` when the sidebar scrolls or
resizes, and `sync()` renders only the rows near the viewport. A tree far out of view
renders none. Hovering or focusing a row lights its folder's whole hairline (a folder
row's own) until the pointer leaves the tree, focus leaves it, or the page scrolls;
`sections-view.ts` calls each tree's `clearPointed()` on a document scroll. Each tree fits
every flattened folder chain to its row
([`sidebar/chain-fit.ts`](../entrypoints/content/sidebar/chain-fit.ts)) with a per-path
style rule, and refits whenever rows render or the host resizes.

A truncated tree row or section header shows its full name on hover and focus, from an
`aria-hidden` copy of it. [`ui/reveal.css`](../entrypoints/content/ui/reveal.css),
imported by both the tree's and the sections view's sheets, decides when the copy shows:
after a wait, while its button is hovered or focus-visible.
[`ui/reveal.ts`](../entrypoints/content/ui/reveal.ts) decides how it moves: it marks a
copy whose name overflows and scrolls it back and forth once it has faded in.

Docs & Comments ends with the comment-lines sub-section when an Implementation file has
comment lines. It has its own header and tree inside Docs & Comments' collapsible region,
and its rows go through the same handlers that open, mark Viewed, count, and scroll to
file rows. `listingOf` resolves a row to the sub-section, so opening one reveals the whole
file, and `scrollToCurrent` prefers the Implementation row unless the reviewer clicked the
sub-section's.

[`entrypoints/content/diffs/on-screen.ts`](../entrypoints/content/diffs/on-screen.ts)
tracks which files' diffs are on screen. It observes the mounted diff regions with one
`IntersectionObserver`, its top inset by `coveredTop` (the band GitHub's sticky chrome
covers), and feeds each changed set of paths to the sections view's `onScreen`. Each tree
lights the piece of each on-screen file's folder hairline (a top-level file's row edge),
and a collapsed section marks its header instead. The mark never scrolls the sidebar.

[`entrypoints/content/diffs/viewed.ts`](../entrypoints/content/diffs/viewed.ts) tracks
which files the reviewer has marked Viewed. On the visit a full load started (before
GitHub's first navigation), `index.ts` seeds it from GitHub's route data
(`readViewedSeed`) when that data names the visit's pull request. It then reads each
header's toggle as diffs mount and as GitHub flips them (`observeViewed`), and keeps each
file's last-read state for the rest of the visit, so a file whose diff unmounts stays as
read. It feeds the viewed paths to the sections view's `viewed`, which dims their rows
and, once any file is Viewed, counts each section's viewed files in its header. The
sections view also gives each file row a checkbox (`SectionTree.showViewed`), which the
`@pierre/trees` patch renders beside the row. Ticking one, or Alt-clicking its row, has
`sections-view.ts` reveal the file's diff through `revealUntil` when its header isn't
mounted, then call `markViewed`, which clicks the header's toggle at most once and waits
for the page to show the result. Nothing dims, counts, or shows a checkbox unless the page
offers Viewed.

## Diff order and reveal

[`entrypoints/content/diffs/order.ts`](../entrypoints/content/diffs/order.ts) lays
GitHub's diffs out in the order the sidebar lists their files. It sets CSS `order` on each
diff's entry and moves no node that React renders, so comments, Viewed, and GitHub's own
scroll to a file keep working. While GitHub virtualizes a long diff list, placing each
diff absolutely, the diffs keep GitHub's order, so they no longer follow the sidebar. It
also hides the diffs of the files the owner filter leaves out (see § Code owners and
reviewers).

[`entrypoints/content/diffs/file-keys.ts`](../entrypoints/content/diffs/file-keys.ts)
has `j` and `k` reveal the next and previous file in the sidebar's order, from the file
the URL's hash names. CSS `order` leaves the diffs in GitHub's DOM order, so a stepper
that walks the DOM, such as Refined GitHub's, would jump around the page. The view cancels
the keys before the page's own listeners see them, and only while the diffs follow the
sidebar.

[`entrypoints/content/diffs/reveal.ts`](../entrypoints/content/diffs/reveal.ts) brings a
file's diff, or a line in it, into view. On a pull request it clicks the native row's link
and glides the window to where GitHub scrolls. On a commit it follows the link's hash
instead, since a click there would let GitHub's router undo the scroll.

## Styling

New UI uses Tailwind CSS v4 utilities with a `tw:` prefix. Colors, radii, and type come
from GitHub's Primer design tokens through
[`entrypoints/content/ui/tailwind.css`](../entrypoints/content/ui/tailwind.css), so themes
follow GitHub. Each feature's sheet sits beside its module and is imported with `?inline`,
then mounted only on the pages that need it. The rules for writing styles are in
[`docs/agents/styling-rules.md`](agents/styling-rules.md).

## Source layout

```text
entrypoints/
  background.ts          service worker: PR data port, cache clearing and what's-new mark on install
  content/
    index.ts             content script entry: wires the watchers, intent, and views
    files-page.ts        every GitHub Files view selector; page kinds; the classic page; the header tabs' counter slot; the filter-options menu; the Reviewers lists' rows and code-owner shields
    classic/             dialog on a pull request's classic Files changed page
    visit/               visit and page lifecycle; landing intent on views
    sidebar/             section trees, sidebar side switch, code owners popover, what's-new block, report link, owner section
    diffs/               diff order, reveal, j/k file keys, on-screen and Viewed tracking
    header/              diffstat breakout
    conversation/        a code owner's files popup and gh-prism's reviewer shield, in the Reviewers lists
    ui/                  shared DOM helpers, popup placer, hover intent, loading view, Markdown subset, name reveal, Tailwind tokens
utils/
  github/                routes, diff parsing, the PR data port and source, code owners and reviewers
  intent/                reading, caching, and landing intent
  hunk-rules/            the docstring and inline-test rules
  sections.ts            path rules for the five sections
  prefs.ts               saved preferences
  whats-new.ts           when the what's-new block shows
tests/                   Vitest unit tests, mirroring the source tree
e2e/                     Playwright smoke tests against the built extension
bench/                   large-diff benchmark
```
