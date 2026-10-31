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

Where the `@pierre/trees` set draws a language as a plain file, gh-prism draws its own
glyph. The glyph is a 16px redraw of the language's logo in the library's two tones, kept
in `ICON_SPRITE` (`sidebar/section-tree.ts`). The main shape fills with `currentColor`, a
secondary shape sits at `.4` opacity, and cut-outs use `fill-rule="evenodd"`. Its colour
is the library palette hue nearest the language's brand colour. A rule in
`sidebar/section-tree.css` sets it the way the library sets its own:
`var(--trees-file-icon-color, var(--trees-icon-<hue>))`. Copy the Java, TOML, and Pkl
entries in `ICON_SPRITE` and their colour rules.

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
the section shows under that folder, nested ones included, as a tree relative to it,
grouped as the code owner's files popup groups them (§ Code owner's files), with an owned
file's code owners under its name. A file with none shows its name alone. The popover is
at most 400px wide. It ends in the same hint, and a click on the shield opens the code
owner details dialog too. `sidebar/owners-popover.ts` builds it.

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
clips at an edge. `sidebar/side.css`, `sidebar/report.css`, `commit/step-links.css`,
`conversation/panel.css`, and `ui/mark.css` hold the five in use. Only the mark's opens on
hover alone, since the mark takes no focus. Inside the header counter's tooltips, which
take no pointer, the mark's own tooltip never opens.

A control that takes a key names it in its tooltip, after the action's name, and sets
`aria-keyshortcuts`, so assistive technology announces the key. Three sets of controls
take keys:

- Older and Newer beside a commit's SHA take Shift+J and Shift+K. Their tooltips name the
  key in words, as "Older commit: 9eb4db2 (Shift+J)", and only while the link goes
  somewhere, because a held-off link's key does nothing.
- The Conversation button takes Shift+\. Its tooltip reads "Conversation (Shift+\)".
- GitHub's file-tree toggle takes `\`. Its tooltip is GitHub's own, so only its
  `aria-keyshortcuts` and keycap name the key.

Each also shows its key at rest as a keycap (`exceptions.md` says why):

- Older and Newer hold it between the link's chevron and its label, so they read "‹ ⇧J
  Older" and "Newer ⇧K ›".
- The Conversation button is Primer's small default Button, like GitHub's "All commits"
  beside it. It holds its icon, then the keycap, so it reads as the comment-discussion
  icon, then "⇧\".
- GitHub's tree toggle is drawn as the same small default Button, with inline-end padding
  for the keycap. Expanded, it takes the default Button's pressed fill,
  `--button-default-bgColor-active`, so expanded and collapsed still differ. The keycap is
  gh-prism's own `<kbd>`, a sibling of the toggle rather than a child, because gh-prism
  inserts nothing into what React renders. `side.css` names the toggle a CSS anchor
  (`anchor-name: --gh-prism-tree-toggle`) and positions the keycap over its end padding
  (`position-anchor`), in `--fgColor-muted` like the toggle's icon. It takes no pointer,
  so a click on it lands on the toggle. On touch screens, where the keycap is hidden, the
  toggle keeps its icon-only width.

The keycap is a `<kbd>` that GitHub's own `kbd` rule draws, the rule Markdown's `<kbd>`
renders with: 11px monospace on `--bgColor-muted`, in a 1px `--borderColor-neutral-muted`
border with a raised bottom edge and a 6px radius. It reads a key such as "⇧J", with the ⇧
set in GitHub's sans stack, because the monospace stack has no ⇧ and the browser's
fallback draws it at half the letter's height. Inside a control, it takes the control's
colour, so it dims with a held-off link; the tree toggle's keycap, a sibling of its
control, sets `--fgColor-muted`. It is hidden from assistive technology, which announces
the key from the control's `aria-keyshortcuts` instead. Devices with no hover and a coarse
pointer, such as touch screens, never show it. `keycap` in `ui/keycap.ts` builds it, and
`ui/keycap.css`, which each control's sheet imports, hides it on touch screens.

## Switches

A switch between two views or states names the action it takes, and the name flips with
the state. Focus stays on it across the flip. It holds one Octicon in both states.

- **In the sidebar,** where room is short, it is Primer's small invisible IconButton,
  named by an `aria-label` that its tooltip shows. `sidebar/side.ts` builds it.
- **Beside a commit's message,** it is Primer's small invisible Button: the Octicon, then
  a visible label that is its name, so it needs no tooltip. The message's hide button and
  the button that shows the message again take the same form. `commit/message-view.ts`
  builds all three.
- **In the code-owner popup and dialog,** it is a link drawn as the same small invisible
  Button. Its flip is a page load, so focus doesn't carry across it. `ui/owners-dialog.ts`
  builds it.

A toggle that opens or holds something keeps one name in both states and carries its state
in ARIA instead, so the name says what it controls. The Conversation button keeps
"Conversation" and sets `aria-expanded` while the panel is open; the panel's pin keeps
"Pin Conversation" and sets `aria-pressed` while pinned. `conversation/panel.ts` builds
both.

The Older and Newer links beside a commit's SHA take Primer's ButtonGroup, not a switch's
form, as a pull request's commit view pairs its Prev and Next: two small default Buttons
that share one border, with the medium radius on the group's outer corners only. Each
chevron sits at the group's outer edge, in `--fgColor-muted`. Their tooltip names the
commit each goes to, which the label doesn't. A link with nowhere to go keeps its place as
Primer's disabled default Button, and its tooltip says why. `commit/step-links.ts` and
`commit/step-links.css` build them.

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

A surface anchored to a page edge, full height, is a pane rather than a floating card: it
sits on `--bgColor-default` with no radius, so it reads as part of the page it pushes or
covers. The Conversation panel in `conversation/panel.css` is the one such pane;
`decisions.md` says why.

## Column separator

A column on the left of the page takes a separator on its inner edge, copying Primer's
pane divider: drag it, or step it 3px with the arrow keys, between Primer's 256px pane
minimum and what the window has past GitHub's 1012px docked layout. Every page in the tab
shares the width the reader picked. `ui/column-width.ts` and `ui/column-width.css` build
it for the commit message column and the pinned Conversation panel.

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
  through" when CODEOWNERS names them too. Then the files, grouped under their folders,
  with a folder that holds only another folder merged into it, as the sidebar's tree
  flattens them. Each folder's path is in muted monospace and breaks only after a slash,
  unless one folder name alone is wider than the popup. Its files sit indented below it in
  monospace. `ui/file-list.ts` builds this tree for the popup, the folder popover (§ File
  rows), and through them the details dialog. A long list scrolls inside the popup.
- **The hint:** like a file row's code owners popover (§ File rows), the popup ends in a
  footer that stays put while the list scrolls: below a hairline, "Click the shield for
  details" in small muted text. gh-prism's mark sits in the same footer (§ The mark).
- **The filter action:** on a popup that lists files, the footer is one row: the hint on
  the left, taking the free width, and "Show only their files" on the right, both centred
  vertically. The footer's vertical padding drops to 4px, so the row stays 36px tall. The
  action is a link drawn as Primer's small invisible Button, with Octicons `filter` before
  its label, and it opens Files changed narrowed to that code owner's files. A plain click
  loads it as a new page; Cmd-click opens a new tab. The "GitHub hides the team" popup has
  no action. On a commit page there is no owner filter, so no surface shows the action.
- **The click:** clicking the shield, or Enter or Space on it, closes the popup and opens
  the code owner details dialog (§ Dialogs), headed by the code owner's `@user` or
  `@org/team` name. Closing the dialog returns focus to the shield. Focus opens the popup
  just as hover does, so the popup shows again.
- **When GitHub hides the team:** a code owner GitHub marks without letting you see which
  team makes them one gets one plain muted sentence instead of the list.
- **The tooltip:** the classic shield's own GitHub tooltip ("… is a code owner") says
  less, so the popup's stylesheet hides it while the popup is open. It stays the shield's
  accessible name.

It takes the hovercard form above on `--overlay-bgColor`, with GitHub's hovercard's 14px
body text and 16px padding. It is at most 440px wide, and never wider than the viewport
less 8px a side. That is wider than GitHub's 360px hovercard, so a deep folder path fits
on one line. `conversation/reviewer-files.ts` and `conversation/reviewer-files.css` hold
it.

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

A view that waits on one load, with no count to show, holds its place with a skeleton
alone: shaped like what it stands in for, held back 150 ms, then pulsing. Two use it.

A commit's message holds its place the same way, without the bar: from the page's first
frame, its column or its slot above the diffs shows a title bar and a line for each of the
body's lines, up to three, held back 150 ms, then pulsing. The rendering takes their place
on the spatial row, fading in and dropping 6px, and the slot above the diffs eases from
the skeleton's height to the rendering's. A skeleton GitHub's re-render shows again
carries on where the last one was, never fading in twice. `commit/message-view.ts` and
`commit/message-view.css` hold it.

The Conversation panel holds its frame's place with a skeleton of the Conversation's
timeline, shown only if the frame hasn't loaded 150 ms after its first open.
`conversation/panel.css` holds it.

## The mark

The mark is the toolbar icon's faceted pyramid and its three bars, redrawn at 16px in two
tones, so a reader can tell gh-prism's surfaces from GitHub's. The lit face and the bars
are solid, and the shaded face is at 40% opacity. `ui/mark.ts` builds it as `prismMark`,
and `ui/mark.css` styles it. It carries no setting to hide it.

Each of these eight surfaces carries one mark:

- **Header counter's tooltips:** each pill's tooltip, at the end of its label's row, with
  the description below at the tooltip's full width; and the total view's tooltip, at the
  end of its last row, "Click to split by section". The mark stays still there, because
  the tooltip takes no pointer.
- **Sidebar:** the nav's last row, at the end corner, below the sections, so it moves none
  of them. Its tooltip opens up and inward, because `sidebar/side.css` clips the sidebar.
- **Code owners popover:** the end corner of the footer row that reads "Click the shield
  for details", so it adds no row.
- **Code owner's files popup:** in the footer, just before "Show only their files", or at
  the footer's end corner when the popup has no action. Its tooltip opens inward at that
  corner.
- **Code owner details dialog:** the footer's start corner, with the filter action at the
  end. The footer always renders, and the header is untouched.
- **Classic Files-changed dialog:** the footer's start corner, with the buttons at the
  end. Both still fit at the dialog's 296px minimum width.
- **Commit message column:** the start of the controls row, above the message's first
  line, with "Show plain text" and "Hide" at the row's end. It scrolls with the message.
  When the row wraps in a narrow column, the mark stays at the start of its first line.
  Above the diffs, on a narrow window, the message carries no mark, because there it
  stands in for GitHub's own message box inside GitHub's card.
- **Conversation panel:** its header, beside the pin and close buttons.

The commit's Older and Newer links, the Reviewers shields themselves, and every inline
control carry none. On a control that small, a mark would crowd the content it labels and
repeat down the page. A future surface gets a mark only if it is a panel, dialog, popup,
or tooltip of gh-prism's own, decided case by case against this entry.

At rest the mark is `--fgColor-muted`. Hovering cross-fades it to a coloured copy of the
glyph on `tokens.md`'s "State, opening" row. While the pointer stays, the copy pulses on
the "Pulse" row. It cycles through the four section hues in section order, leaving out the
muted one, which would match the resting mark. It also breathes between full and 70%
opacity. The copy keeps the glyph's two tones. Leaving fades the copy out on the "State,
closing" row and pauses the pulse, so the next hover resumes it where it stopped. Under
reduced motion, hovering swaps instantly to a still copy in `--fgColor-accent`. Under
forced colours, the mark is `CanvasText`, and hovering changes nothing but the tooltip.
The mark is an image named "Added by gh-prism" that takes no focus, and its tooltip shows
the same words on hover only.

## The spectrum

The spectrum is gh-prism's signature: every section's hue in one band, in section order.
It appears only where gh-prism announces itself: the loading bar and the 3px top edge of
the classic-page dialog. Anywhere else, it would compete with the section hues it is made
of. A hovered mark cycles through the same hues one at a time instead.

## Notices

A notice is one plain sentence in small, muted text, with no icon and no illustration. The
sidebar's "Grouped by path" notices are the model: each says what gh-prism did and, when
the reviewer can change it, how. `sidebar/sections-view.ts` holds them.

## Dialogs

The classic-page dialog is a native `<dialog>`. It enters with Primer's scale-and-fade,
while the spectrum sweeps across its top edge, and its backdrop is Primer's
`--overlay-backdrop-bgColor`. `classic/notice.ts` and `classic/notice.css` hold it.

The code owner details dialog copies that dialog's shell, its header, ✕ button, entrance,
and backdrop, but has no spectrum. ✕, Escape, and a click outside close it. Under its
heading, it repeats what the shield's popover lists, built by the same code. Then each
owning team gets a block below a hairline: its `@org/team` name linked to its team page,
then at most 15 members as `@login` links. A team with more members ends in a "See all N
members" link to its team page. A team the viewer can't see reads "GitHub doesn't show you
this team's members.", and an empty one reads "This team has no members."

The dialog carries the popup's filter action (§ Code owner's files) in two places:

- **The footer:** the dialog always ends in a footer below the scrolling body, so it stays
  put. A hairline sits above it, drawn as `box-shadow: 0 -1px 0` in
  `--borderColor-default` to mirror the header's. It has 8px padding and holds gh-prism's
  mark (§ The mark) at its start corner; opened from a Reviewers shield whose popup lists
  files, it also holds the action for the dialog's own code owner, at the end.
- **Each team block:** the block's heading is a row, the linked team name on the left and
  the action for that team on the right, centred vertically. The block for the dialog's
  own code owner skips it, so the dialog never offers the same action twice.

The action is a switch, so its label names what it does and flips with the state: on a
Files changed page already filtered to that code owner, it reads "Show all files" and
clears the filter. The icon stays the same. `ui/owners-dialog.ts` and
`ui/owners-dialog.css` hold it.
