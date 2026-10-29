# gh-prism design patterns

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each pattern names the module that builds it. Build a new element by extending that
module's pattern, so gh-prism keeps one way of doing each thing. Module paths are relative
to `entrypoints/content/`.

## Section identity

A section is its label, its 16px Octicon, and its hue, all from one `SECTION_CATALOG` row
in `ui/section-catalog.ts`. Only the icon takes the hue. The label and its file counter
stay in `--fgColor-default`. The header counter's pills draw from the same row, but their
icons stay in `--fgColor-muted` until the counter is hovered or focused, and short
hairlines rule the pills apart. `exceptions.md` says why.

The icon gives way to a chevron while the header is hovered or focused, and the chevron's
turn shows whether the section is open. A folder row inside a section does the same with a
folder icon in the section's hue, in `sidebar/section-tree.css`.

## Section surface

A section and its rows sit on the section's tint, so each section reads as one block.
Sections stack with a 6px gap, `tw:gap-1.5` in `sidebar/sections-view.ts`. The
[section edge](tokens.md#section-edge) and Primer's resting shadow set each section apart
from its neighbours. The what's-new block above the sections shares this surface.

## File rows

A file row starts with its file-type icon, coloured from the `@pierre/trees` palette, then
sets its name in monospace and its decoration in sans. The decoration holds, in order:

1. A `Partial` pill, when the entry holds only part of its file's lines.
2. The lines added in `--fgColor-success`, and the lines removed in `--fgColor-danger`. A
   zero count stays muted, so colour marks only lines that changed.
3. GitHub's status letter, such as `M` for modified.

A row short of room shrinks its name first, down to a few characters behind an ellipsis.
Only then does the row drop whole decoration parts, leading ones first, never clipping one
mid-word. The row's title and accessible name still carry every part.
`sidebar/section-tree.css` holds the layout.

An owned file's icon gives way to a shield while its row is hovered or focused, as a
folder's icon gives way to its chevron. The shield is Octicons `shield-lock`, muted at
rest and `--fgColor-default` on hover. Resting the pointer on it opens a popover listing
the file's code owners, with the code owner's files popup's timing below, and so does
focusing it. The popover ends in a footer that stays put while the list scrolls. Below a
hairline, the footer holds one small muted sentence, "Click the shield for details".
Clicking the shield, or Enter or Space on it, closes the popover and opens the code owner
details dialog (§ Dialogs). `sidebar/section-tree.css` swaps the icon for the shield;
`sidebar/owners-popover.ts` builds the popover.

A folder holding an owned file shows the same shield while its row is hovered or focused,
at its row's end, centred on the file rows' Viewed box column, because its icon already
gives way to its chevron. A flattened chain's shield stands for its deepest folder, which
holds the same files. `sidebar/section-tree.css` places it. Its popover lists every file
the section shows under that folder, nested ones included, each as a path relative to the
folder in monospace with its directory muted, with an owned file's code owners under it. A
file with none shows its path alone. It ends in the same hint, and a click on the shield
opens the code owner details dialog too. `sidebar/owners-popover.ts` builds it.

A folder chain short of room keeps its first folder and as many trailing folders as fit
around one `…`. With room for less, it shows `…` and the deepest folder alone. Only the
deepest folder's name is ever cut, in the middle. `sidebar/chain-fit.ts` decides the fit;
`sidebar/section-tree.css` lays it out.

## Truncated names

A truncated name shows whole on hover and focus. A file row keeps its middle truncation at
rest and scrolls only its file name; a folder chain scrolls its full path; a section
header keeps its end ellipsis at rest and scrolls its label. Under reduced motion each
shows its full name as a strip the reviewer scrolls by hand. `ui/reveal.ts`'s `fullName()`
builds the copy; `ui/reveal.css` and `ui/reveal.ts` show and scroll it.

## Overflow edges

Content its box cuts off fades out at the cut edge through an alpha `mask-image`, never a
gradient painted in the ground's colour, so the fade works on any tint in either theme. A
truncated name's revealed copy fades its end over 12px (`ui/reveal.css`). The what's-new
notes fade their bottom 32px while more sit below, clearing as the reviewer scrolls to the
end (`sidebar/sections-view.css`).

## Viewed

A Viewed row dims everything but its checkbox, so the reviewer can still read the row and
find the box to untick it. Every section that lists the file dims its row. Once any file
is Viewed, each section's header shows how many of its files are Viewed, as `N/M`.

Today's dim takes a row's text below the 4.5:1 text floor in `brief.md`, with counts near
2:1 in a light theme. Raise the dim to meet the floor before another element copies it.

The checkbox is drawn, not native. At rest it is an outline. Once Viewed, it fills with
the section's hue, with the check cut out of it in the section's tint. While GitHub saves,
a spinning ring takes the check's place, and the box keeps the state GitHub last showed.
Under forced colours, such as Windows' contrast themes, it goes back to the system's
checkbox. `sidebar/section-tree.css` holds it.

## Current and on-screen files

GitHub's current file, the one its `aria-current` names, gets a 3px bar in its section's
hue at its row's left edge, as GitHub marks its own current tree item. The folder
hairlines beside the files whose diffs are on screen light up, so the reviewer sees where
the diff view sits in the list. A top-level file has no folder hairline, so a short pip at
its row's left edge lights instead.

A collapsed section hides its rows, so while it lists an on-screen file, its header shows
a bar in its hue instead. `sidebar/section-tree.css` and `sidebar/sections-view.css` hold
these marks.

## Tooltips

A tooltip copies Primer's. It is an `::after` on the control that shows the control's
`aria-label`, on `--tooltip-bgColor`, at the small body size, and it fades in over 120 ms
on hover and focus. It opens toward the inside of the sidebar or the page, so it never
clips at an edge. `sidebar/side.css` and `sidebar/report.css` hold the two in use.

No control takes a key yet, because `j` and `k` step through files without a control of
their own. When a control does take one, its tooltip shows the key after the action's
name, as a keycap in the style of Primer's keybinding hint, and the control sets
`aria-keyshortcuts`, so assistive technology announces the key. Touch devices have no
hover, so they never show the keycap.

## Floating surfaces

An overlay that floats over the page sits on `--overlay-bgColor`, falling back to
`--bgColor-default`, with the medium radius and `--shadow-floating-small`. The header
counter's tip in `header/diffstat-view.ts` and the code owners popover in
`sidebar/owners-popover.ts` share it, class for class.

A floating surface draws one 1px edge, never two. An overlay draws no border of its own,
because `--shadow-floating-small` opens with a 1px ring that draws its edge, as in
Primer's ActionMenu. Browsers give `[popover]` and `<dialog>` a default border, which
would add a second edge, so such an overlay clears it with `tw:[border:0]`. The code
owners popover does, and so do the classic notice in `classic/notice.ts` and the code
owner details dialog in `ui/owners-dialog.ts`. Those two keep their own radius.

A hover card whose trigger sits next to one of GitHub's hovercard triggers takes GitHub's
hovercard form instead: the 1px `--borderColor-default` border, the medium radius, and no
shadow. The rule above holds, because that border is its one edge. The code owner's files
popup below is the one such card.

## Code owner's files

On a pull request's Conversation tab, a code-owner shield beside a team or person in a
Reviewers list opens a popup listing the changed files that code owner owns. The avatar
and name keep GitHub's own hovercard, so the two cards never share a trigger.

- **The shield:** GitHub's own, or gh-prism's beside a PR reviewer who owns a changed file
  where GitHub draws none, as after a code owner reviews. gh-prism's is drawn as GitHub's
  is in that list: Octicons `shield-lock` at 16px, muted, just before the status icon. In
  the classic sidebar it takes GitHub's own `btn-link muted-icon` classes; in the overview
  list, the look of Primer's small invisible `IconButton`. A 24px target surrounds the
  16px glyph without moving it. Its accessible name says, in GitHub's words, "… is a code
  owner", adding "through" and the team when only a team makes them one.
- **Timing:** it opens 200 ms after the pointer rests on the shield, longer than GitHub's
  card takes to close, and at once when the shield takes keyboard focus. It closes 150 ms
  after the pointer leaves both shield and popup, so the pointer can cross into it. Tab
  from the shield moves into it, so its team links work from the keyboard. Escape, focus
  leaving both, and a scroll outside the popup close it at once, handing focus it held
  back to the shield. One is open at a time.
- **Content:** the count line "Code owner of N files in this pull request", in GitHub's
  own words from its user hovercard. When teams make them an owner, a small muted line
  under it says "Through" and names each team, linked to its team page, or "Directly and
  through" when CODEOWNERS names them too. Then one row per file, its path in monospace
  with the directory muted. A long list scrolls inside the popup.
- **The hint:** like a file row's code owners popover (§ File rows), the popup ends in a
  footer that stays put while the list scrolls: below a hairline, "Click the shield for
  details" in small muted text.
- **The click:** clicking the shield, or Enter or Space on it, closes the popup and opens
  the code owner details dialog (§ Dialogs), headed by the code owner's `@user` or
  `@org/team` name. Closing the dialog returns focus to the shield. Focus opens the popup
  just as hover does, so the popup shows again.
- **When GitHub hides the team:** a code owner GitHub marks without letting you see which
  team makes them one gets one plain muted sentence instead of the list.
- **The tooltip:** the classic shield's own GitHub tooltip ("… is a code owner") says
  less, so the popup's stylesheet hides it while the popup is open. It stays the shield's
  accessible name.

It takes the hovercard form above on `--overlay-bgColor`, and matches GitHub's hovercard
in size: 14px body text, 16px padding, and at most 360px wide.
`conversation/reviewer-files.ts` and `conversation/reviewer-files.css` hold it.

## Loading

The loading view appears only after 150 ms, as `brief.md` says. It shows the spectrum as a
bar that fills as gh-prism checks files. Beside the bar, a label says what gh-prism is
doing, first "Reading the diff" and then "Sorting files into sections", with an "N of M"
count. Before the count is known, the bar sweeps from side to side. Under reduced motion,
the bar stands still at partial strength.

Skeleton rows pulse under the bar, in the sidebar and over the diffs, shaped like the rows
and diff cards they stand in for. Once the sections land, they drop in one after another,
50 ms apart, on the spatial row of the [motion scale](tokens.md#motion).
`ui/loading-view.ts`, `ui/loading-view.css`, `sidebar/sections-view.css`, and
`diffs/order.css` hold these.

## The spectrum

The spectrum is gh-prism's signature: every section's hue in one band, in section order.
It appears only where gh-prism announces itself, which is the loading bar and the 3px top
edge of the classic-page dialog. Anywhere else, it would compete with the section hues it
is made of.

## Notices

A notice is one plain sentence in small, muted text, with no icon and no illustration. The
sidebar's "Grouped by path" notices are the model: each says what gh-prism did and, when
the reviewer can change it, how. `sidebar/sections-view.ts` holds them.

## Dialogs

The classic-page dialog is a native `<dialog>`. It enters with Primer's scale-and-fade,
while the spectrum sweeps across its top edge, and its backdrop is Primer's
`--overlay-backdrop-bgColor`. `classic/notice.ts` and `classic/notice.css` hold it.

The code owner details dialog copies that dialog's shell, its header, ✕ button, entrance,
and backdrop, but has no spectrum and no footer buttons. ✕, Escape, and a click outside
close it. Under its heading, it repeats what the shield's popover lists, built by the same
code. Then each owning team gets a block below a hairline: its `@org/team` name linked to
its team page, then at most 15 members as `@login` links. A team with more members ends in
a "See all N members" link to its team page. A team the viewer can't see reads "GitHub
doesn't show you this team's members.", and an empty one reads "This team has no members."
`ui/owners-dialog.ts` and `ui/owners-dialog.css` hold it.
