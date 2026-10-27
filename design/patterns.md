# gh-prism design patterns

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each pattern names the module that builds it. Build a new element by extending that
module's pattern, so gh-prism keeps one way of doing each thing. Module paths are relative
to `entrypoints/content/`.

## Section identity

A section is its label, its 16px Octicon, and its hue, all from one `SECTION_CATALOG` row
in `ui/section-catalog.ts`. Only the icon takes the hue. The label and its file counter
stay in `--fgColor-default`. The header counter's pills draw from the same row, so a
section looks the same in the header and in the sidebar.

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
