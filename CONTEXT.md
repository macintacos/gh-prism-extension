# gh-prism

gh-prism groups the changed files of a GitHub pull request or commit into sections, so a
reviewer can read implementation, tests, docs, config, and generated files apart. This
glossary names the concepts the extension, its code, and its issues share.

## Language

### Diffs and pages

**Diff ref**: The diff a Files view shows: a pull request's, or a single commit's.
_Avoid_: PR, when a commit is meant too

**Diff head**: A diff ref pinned to the commit its diff ends on. _Avoid_: head ref

**Diff pin**: The two commits a pull request's page says its diff runs between, its base
and its head. A revisit with the same pin lands its intent without reading the diff.

**Files view**: A page where gh-prism runs: a pull request's Files changed tab, or a
commit's page. _Avoid_: files page, diff page

**Page kind**: Which Files view shows the diff: a pull request's Files changed tab or a
commit's page. _Avoid_: page type, view type

**Visit**: One stay on a Files view's address. Changing the address ends it; changing only
the hash does not.

**Page**: One render of the Files view's markup during a visit. GitHub may replace it
several times in one visit.

**Classic page**: A pull request's Files changed tab in GitHub's older form, at
`/pull/<n>/files`, or `/pull/<n>/commits/<sha>` for one commit, which GitHub shows to a
signed-out viewer or with its New Files Changed Experience preview off. gh-prism doesn't
run there; it opens a dialog that says why. _Avoid_: old page, legacy page

**Native tree**: GitHub's own file tree, kept mounted but hidden as the source of truth
for which files the sidebar lists and in what order. _Avoid_: GitHub tree, original tree

**Commit-filtered**: A pull request's Files view narrowed to one commit or a range of
commits.

### Sections

**Section**: One of five groups a changed file is listed in: Implementation, Tests,
Documentation, Config, and Generated / lockfiles. _Avoid_: category, group, bucket

**Path section**: The section a file's path alone puts it in. _Avoid_: default section

**Rule section**: A section a hunk rule can claim whatever the path says: Documentation or
Tests.

### Placing files

**Hunk**: One block of a diff: changed lines plus a few unchanged lines around them.

**Head**: A changed file's contents at the diff head, read when a hunk rule needs more
than the patch.

**Hunk rule**: A rule that claims hunks for a rule section by what they change, not where
the file lives. There are two: the docstring rule and the inline-test rule. _Avoid_:
classifier, detector

**Docstring-only change**: A hunk that changes only comments or docstrings. The docstring
rule claims it for Documentation.

**Inline-test change**: A hunk whose changes all sit inside a source file's test blocks.
The inline-test rule claims it for Tests.

**Intent**: Where the hunk rules place a diff's files, once read. A file it doesn't
mention keeps its path section. _Avoid_: classification

**Pending intent**: Intent still being read, with its progress so far.

**Placement**: Where intent moves one file: whole, into one rule section, or split across
sections hunk by hunk.

**Share**: One section's part of a split file: the hunks placed there and the lines they
add and remove. _Avoid_: slice, part

**Partial**: The sidebar's word for an entry backed by a share. _Avoid_: share, in
anything a reviewer reads

**Landing**: Every file's resolved place in the sections, whole or as shares, with each
section's line totals, built from intent or from paths alone.

**Path-only**: The fallback when intent can't be read or the view is commit-filtered:
every file keeps its path section. The sidebar says "Grouped by path". _Avoid_: degraded
mode

### What the reviewer sees

**Sidebar**: gh-prism's sectioned list of changed files, shown in place of the native
tree. _Avoid_: file tree, which is GitHub's

**Side**: The edge the sidebar docks on, left or right. _Avoid_: position

**Slide**: The sidebar's animated move when it switches sides, collapses, or expands.
_Avoid_: glide

**Current file**: GitHub's `aria-current` file, shown as the sidebar's selected row. There
is at most one.

**On-screen file**: A file whose diff region shows below GitHub's sticky chrome. There can
be many. _Avoid_: in view

**Viewed file**: A file whose Viewed toggle on GitHub is pressed. The sidebar dims its
rows and never hides them, and once any file is Viewed, each section's header counts how
many of its files are Viewed; gh-prism stores none of this state. Only a page that offers
Viewed, a pull request's full Files changed view signed in, has Viewed files. _Avoid_:
reviewed file, seen

**Diff order**: The order gh-prism lays the diffs out in, matching the sidebar. Only the
visual order changes. _Avoid_: sort

**Reorderable**: A diff list whose order gh-prism can change. GitHub's virtualized lists
aren't.

**Reveal**: Bringing a clicked file's diff, or a Partial entry's first hunk, into view.

**Glide**: The smooth scroll that ends a reveal. _Avoid_: slide

**Diffstat**: The header's lines-changed counter, shown as a breakout or a total.

**Breakout**: The diffstat view with one pill per section.

**Pill**: One section's rounded label in the breakout: its icon and the lines it adds and
removes.

**Total**: The diffstat view that shows GitHub's own count.

## Flagged ambiguities

- "PR" also covers single commits wherever commit pages are supported, including names in
  the data path. Say diff ref unless only a pull request is meant.
- "Intent" also names the pending read and the rule sections. Intent is the result; say
  pending intent and rule section for the others.
- "Glide" also names the sidebar's move. The sidebar slides; a reveal glides.
- "Source" names both the background's fetcher of diffs and file contents, and where
  intent is read from and cached. Keep it for the fetcher.
- "Pin" also names a diff head's one commit. Say diff pin only for the base and head pair.
- The Documentation section's key is `docs`. They are the same section.
