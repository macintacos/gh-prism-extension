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
folder icon in the section's hue, in `sidebar/section-tree.css`. A section that lists an
owned file shows its code owners shield in place of its line totals while the header is
hovered or focused, or the shield's popover is open (§ File rows).

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
the file's code owners, one per 24px row, each drawn as § Owner identities says, with the
code owner's files popup's timing below, and so does focusing it. The popover ends in a
footer that stays put while the list scrolls. Below a hairline, the footer holds one small
muted sentence, "Click the shield for details". Clicking the shield, or Enter or Space on
it, closes the popover and opens the code owner details dialog (§ Dialogs).
`sidebar/section-tree.css` swaps the icon for the shield; `sidebar/owners-popover.ts`
builds the popover.

A folder holding an owned file shows the same shield while its row is hovered or focused,
at its row's end, centred on the file rows' Viewed box column, because its icon already
gives way to its chevron. A flattened chain's shield stands for its deepest folder, which
holds the same files. `sidebar/section-tree.css` places it. Its popover lists every file
the section shows under that folder, nested ones included, grouped by owner set. Each
distinct set of code owners, whatever their order, heads one group with a muted "Owned by"
followed by its owners, comma-separated, as § Owner identities draws them. The heading's
line is 24px, so its words line up with the identities when it wraps. The group's files
sit indented below it as a tree relative to the folder, laid out as the code owner's files
popup lays them out (§ Code owner's files). Groups follow the tree order of their first
files, and files without a code owner come last under a muted "No code owner". The popover
is at most 400px wide. It ends in the same hint, and a click on the shield opens the code
owner details dialog too. `sidebar/owners-popover.ts` builds it. The whole pull request's
code owner details dialog (§ Dialogs) groups every changed file the same way, by full
path.

A section that lists an owned file gets the same shield on its header, at the header's
right end, centred on the folder rows' shield column below. A header with no line totals
keeps that end for the shield, and its label stops short of it. At rest the header shows
its line totals. While the header is hovered, holds keyboard focus, or has the shield's
popover open, the shield fades in over the totals. The fade uses the folder shield's
`opacity 150ms ease-out`, and is instant under reduced motion. Both hide by opacity only,
so the totals stay in the toggle's name and the shield stays in the tab order, right after
the toggle. The shield sits outside the toggle and the heading, and is named "Code owners
of files in <section>". Its popover lists every file the section lists, grouped by owner
set as a folder's are, as a tree from the repository root, and ends in the same hint. A
click opens the code owner details dialog without toggling the section. Closing the dialog
returns focus to the section's toggle. `sidebar/sections-view.ts` builds it and
`sidebar/sections-view.css` styles it.

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

A code owner's name and a team member's display name (§ Owner identities) don't scroll,
because scrolling belongs to the sidebar's rows. Each ends in an ellipsis at rest, and the
owner tooltip (§ Tooltips) shows it whole on hover and keyboard focus.

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
`commit/message-view.css`, `conversation/panel.css`, `ui/mark.css`, and `ui/pr-owners.css`
hold the seven in use. The code owners button beside a Reviewers heading sits near the
sidebar's inline end, so `conversation/reviewer-files.css` overrides `ui/pr-owners.css`'s
tooltip for it to open leftward from the button's end. Only the mark's opens on hover
alone, since the mark takes no focus. Inside the header counter's tooltips, which take no
pointer, the mark's own tooltip never opens.

The owner filter icons' tooltips (§ Owner identities) look the same but sit in the top
layer, because their surfaces scroll, and an `::after` there would widen the scroller's
overflow even while hidden. Each surface holds one `popover="manual"` tooltip that reads
the hovered or keyboard-focused icon's `data-tooltip`. When the pointer leaves an icon
while another holds keyboard focus, the tooltip shows the focused icon's text again. The
same tooltip shows an owner link's full name, as the link shows it, when its name is cut
off (§ Truncated names), measured as `scrollWidth > clientWidth` when it would show. It
never shows for a name that fits. The member search toggle (§ Dialogs) always shows its
`data-tooltip` through it, as the filter icons do. `ui/place.ts` places it 4px below the
icon, start-aligned, or above it where the viewport has no room below. It is hidden from
assistive technology, because the icon's `aria-label` already says the same.
`ui/owner-identity.ts` builds it. The whole pull request's reviewer eye (§ Dialogs) shares
this tooltip but opens it on hover alone, since the eye takes no focus. Its hidden words,
which join the owner heading's accessible name, say the same as the tooltip, so keyboard
and screen-reader users lose nothing.

A control that takes a key names it in its tooltip, after the action's name, and sets
`aria-keyshortcuts`, so assistive technology announces the key. Four sets of controls take
keys:

- Older and Newer beside a commit's SHA take Shift+J and Shift+K. Their tooltips name the
  key in words, as "Older commit: 9eb4db2 (Shift+J)", and only while the link goes
  somewhere, because a held-off link's key does nothing.
- The Conversation button takes Shift+\. Its tooltip reads "Conversation (Shift+\)", or
  "Overview (Shift+\)" where GitHub serves its pull request overview.
- The commit message toggle takes Shift+\ on a commit's page, which has no Conversation
  button. Its tooltip reads "Commit message (Shift+\)".
- GitHub's file-tree toggle takes `\`. Its tooltip is GitHub's own, so only its
  `aria-keyshortcuts` and keycap name the key.

Each also shows its key at rest as a keycap (`exceptions.md` says why):

- Older and Newer hold it between the link's chevron and its label, so they read "‹ ⇧J
  Older" and "Newer ⇧K ›".
- The Conversation button is Primer's small default Button, like GitHub's "All commits"
  beside it. It holds its icon, then the keycap, so it reads as the comment-discussion
  icon, then "⇧\".
- The commit message toggle takes the same form, with Octicons `git-commit`, and starts
  the toolbar above a commit's diffs. While the message shows, it takes the default
  Button's pressed fill, as the tree toggle does while its tree shows.
  `shiftBackslashButton` in `ui/key-button.ts` builds both buttons.
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
  a visible label that is its name, so it needs no tooltip. `commit/message-view.ts`
  builds it.
- **After a code owner's name,** it is a link drawn as Primer's small invisible
  IconButton, named by an `aria-label` that its tooltip shows. Its flip is a page load,
  and it takes the selected fill in its second state. `ui/owner-identity.ts` builds it.
- **In the code-owner popup and dialog,** it is a link drawn as the same small invisible
  Button. Its flip is a page load, so focus doesn't carry across it. `ui/owners-dialog.ts`
  builds it.

A toggle that opens or holds something keeps one name in both states and carries its state
in ARIA instead, so the name says what it controls. The Conversation button keeps
"Conversation" and sets `aria-expanded` while the panel is open; the panel's pin keeps
"Pin Conversation" and sets `aria-pressed` while pinned. Where GitHub serves its pull
request overview, each says "Overview" in Conversation's place. The commit message toggle
keeps "Commit message" and sets `aria-expanded` while the message shows;
`commit/message-toggle.ts` builds it. Between its title and pin, the panel's header holds
two jump controls in the pin's form, "Jump to checks" and "Jump to reviewers, labels, and
projects", each with a tooltip opening below the header and shown only while the frame has
its section. Over the overview only the second shows, landing on its Reviewers section.
`conversation/panel.ts` builds them all.

The Older and Newer links beside a commit's SHA take Primer's ButtonGroup, not a switch's
form, as a pull request's commit view pairs its Prev and Next: two small default Buttons
that share one border, with the medium radius on the group's outer corners only. Each
chevron sits at the group's outer edge, in `--fgColor-muted`. Their tooltip names the
commit each goes to, which the label doesn't. A link with nowhere to go keeps its place as
Primer's disabled default Button, and its tooltip says why. `commit/step-links.ts` and
`commit/step-links.css` build them.

A choice among three views takes Primer's segmented control. The diff view control sits
immediately before GitHub's diff settings gear and picks Unified, Split, or Structural:
three `aria-pressed` buttons in a list named "Diff view", each a Tab stop with no key of
its own. The name stands before the track in muted body-small text, 8px from it, so a
reader sees what the control picks. It is hidden from assistive technology, because the
list already carries the same name. The track is 28px high, on
`--controlTrack-bgColor-rest` in a 1px `--controlTrack-borderColor-rest` border. The
pressed segment is a knob on `--controlKnob-bgColor-rest` with a semibold label and a 1px
`--borderColor-neutral-emphasis` edge, so weight and edge carry the state without colour.
Each label reserves its semibold width, so pressing shifts nothing. The pressed segment
follows the layout the tables show, never a stored copy, and none is pressed while the
layout can't be told. Structural carries the Beta tag (§ Tags) and the Structural popover
(§ Floating surfaces). It alone is gh-prism's view, so it alone leads with the mark's
glyph (§ The mark), at 16px and hidden from assistive technology. The glyph is
`--fgColor-muted` at rest and the label's colour while the segment is pressed. Hovering
the segment, or giving it keyboard focus, runs the mark's pulse on the glyph, pressed or
not. Under reduced motion the glyph swaps at once to the mark's still accent copy, and
under forced colours it is `ButtonText` and still. On a pull request filtered to one
commit, Structural is `aria-disabled`, in `--control-fgColor-disabled`, and its popover
says why above the same link; its glyph takes that colour and stays still. The control
gives up its room in two steps, because GitHub's toolbar never wraps: first the name goes,
then the control hides. On a pull request each step happens when the toolbar would
overflow. On a commit, fixed widths set both steps: the name goes below 1100px, before it
would shrink GitHub's search box, and the control below 768px. While the control shows,
GitHub's diff settings menu opens without its Layout group, which would only repeat the
control; the menu stays whole whenever the control is hidden. `diffs/view-control.ts` and
`diffs/view-control.css` build it.

## Tags

A tag is a short word that qualifies the thing beside it, such as "No reviewer" or "Beta".
It is muted text at the body-small size and medium weight inside a 1px
`--borderColor-default` pill, with 6px inline padding and a `2em` radius. It stays
neutral, because colour is spent elsewhere, and its text starts with a space so the name
of the control or heading it sits in reads as words. The pill's edge is decoration below
the 3:1 floor; the tag's text carries it. `sidebar/owners-popover.ts` builds "No
reviewer", and `diffs/view-control.ts` builds "Beta" inside the Structural segment.

## Conventional commit titles

A commit title that opens with a conventional commit prefix shows the prefix as a type
label and a scope, then the description. `CONTEXT.md` defines both terms.

- **The type label** is GitHub's own label: the `IssueLabel hx_IssueLabel` classes, fully
  round, at medium weight in the sans face. It reads the type's name: Feature, Fix, Chore,
  Revert, Style, Docs, Build, Refactor, Test, CI, or Performance, ending in `!` for a
  breaking change. `commit/title-badge.css` gives each type the colour of one of GitHub's
  default issue labels; Chore, Revert, and Style stay neutral. `exceptions.md` records the
  colour.
- **The scope** follows in `--fgColor-muted` at the title's weight, with its colon and
  without its parentheses.
- **The description** keeps the title's own colour and weight.

Two titles take it. The rendered message's title, in the column and above the diffs, sets
the label at the body size, which fits the title's 25px line, and raises it 2px to centre
it on the text. GitHub's box, on a subject-only commit, sets it at GitHub's 12px label
size. The plain-text view shows the message as written, with no label.
`commit/title-badge.ts` reads the prefix and builds the label and scope,
`commit/message.ts` and `commit/message-view.css` place them in the rendered title, and
`commit/subject-badge.ts` and `commit/subject-badge.css` place them in GitHub's box.

## Floating surfaces

An overlay that floats over the page sits on `--overlay-bgColor`, falling back to
`--bgColor-default`, with the medium radius and `--shadow-floating-small`. The header
counter's tip in `header/diffstat-view.ts`, the code owners popover in
`sidebar/owners-popover.ts`, and the Structural popover in `diffs/structural-intro.ts`
share it, class for class. The Structural popover opens on hover or keyboard focus of the
diff view control's Structural segment. It shows the segment's `aria-description` above a
"What's a structural diff?" link, which opens `docs/STRUCTURAL-DIFFS.md` in a new tab. It
sits right after the segment, so Tab from the segment reaches the link.

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
minimum and what the window has past GitHub's docked layout: 1076px on a pull request,
where GitHub's 1012px query meets its diff viewer's 32px padding a side, and 1012px for a
commit's message, whose tree docks down to 768px. Every page in the tab shares the width
the reader picked. `ui/column-width.ts` and `ui/column-width.css` build it for the commit
message column and the Conversation panel. The Conversation panel's overlay takes the same
separator but floats over the page, so its bound is the window less 48px, the strip left
to click outside it.

A column the reader closes slides off its start edge at its full width, and what sits
beside it moves with its edge, so nothing rewraps or is drawn twice. It leaves on the
"State, closing" row of the [motion scale](tokens.md#motion) and comes back on the Spatial
row. Under reduced motion it takes its new state at once. Two columns do this:

- The pinned Conversation panel slides off the page's left edge. It animates its translate
  and the page's padding (`conversation/panel.ts`).
- The commit message column slides off the start edge of GitHub's layout row. It animates
  its start margin, and its toggle pressed again mid-slide turns the slide around
  (`commit/message-view.ts`). Above the diffs, where the message is no column, it folds
  its height shut and open on the same two rows.

## Code owner's files

On a pull request's Conversation and Files changed tabs, a code-owner shield beside a team
or person in a Reviewers list, or beside a comment's author, opens a popup listing the
changed files that code owner owns. The avatar and name keep GitHub's own hovercard, so
the two cards never share a trigger.

- **The shield:** GitHub's own, or gh-prism's beside a PR reviewer who owns a changed file
  where GitHub draws none, as after a code owner reviews. gh-prism's is drawn as GitHub's
  is in that list: Octicons `shield-lock` at 16px, muted, just before the status icon. In
  the classic sidebar it takes GitHub's own `btn-link muted-icon` classes; in the overview
  list, the look of GitHub's 16px invisible `IconButton` status icons. A 24px target
  surrounds the 16px glyph without moving it. Its accessible name says, in GitHub's words,
  "… is a code owner", adding "through" and the team when only a team makes them one.
- **Beside a comment's author:** the shield also follows the name of each Conversation or
  Files changed comment author who owns a changed file, PR reviewer or not, right after
  the name and before "commented" and the time. In the classic timeline it takes GitHub's
  `btn-link` class with no status-icon wrapper, and gh-prism colours it muted at rest and
  accent on hover, as GitHub colours its sidebar shield: GitHub's `.muted-icon` rule
  applies only inside the sidebar. In the overview it takes the look of the small
  invisible `IconButton` at the title row's 20px. New Files changed shares the overview's
  ActivityHeader, so it takes the overview's look; classic Files changed takes the classic
  `btn-link` look. Its popup, timing, click, and the Conversation panel's and the classic
  Files changed page's lack of a filter action follow every rule below.
- **Timing:** it opens 200 ms after the pointer rests on the shield, longer than GitHub's
  card takes to close, and at once when the shield takes keyboard focus. It closes 150 ms
  after the pointer leaves both shield and popup, so the pointer can cross into it. Tab
  from the shield moves into it, so its team links work from the keyboard. Escape, focus
  leaving both, and a scroll outside the popup close it at once, handing focus it held
  back to the shield. One is open at a time.
- **Content:** the count line "Code owner of N files in this pull request", in GitHub's
  own words from its user hovercard. When teams make them an owner, a small muted line
  under it says "Through", or "Directly and through" when CODEOWNERS names them too, then
  the team as § Owner identities draws it. Two or more teams don't fit inline, so the line
  ends in "N teams" instead, such as "Through 2 teams". Each team's filter icon shows only
  that team's files, except in the Conversation panel, where nothing filters. The line is
  24px tall, so its words line up with the avatars, and a −6px top margin keeps it close
  under the count line. Then the files, grouped under their folders, with a folder that
  holds only another folder merged into it, as the sidebar's tree flattens them. Each
  folder's path is in muted monospace and breaks only after a slash, unless one folder
  name alone is wider than the popup. Its files sit indented below it in monospace.
  `ui/file-list.ts` builds this tree for the popup, the folder popover (§ File rows), and
  through them the details dialog. A long list scrolls inside the popup.
- **"N teams":** a `<button>` drawn as an owner link's name, in the same colour and
  weight, underlined on hover and while its list is open. Octicons `triangle-down` follows
  it at 16px in `--fgColor-muted`. It carries `aria-expanded` and `aria-controls`, and
  takes the 2px `--focus-outlineColor` ring. Its list is a floating card (§ Floating
  surfaces): 8px padding, no border, at most `min(360px, 100vw - 16px)` wide, placed below
  the button. Each team sits on its own 24px line, as § Owner identities draws it, with
  its filter icon where the host filters. The list opens 200 ms after the pointer rests on
  the button, and at once on keyboard focus or a click. A click also pins it open, and a
  click on a pinned list closes it. It closes 150 ms after the pointer leaves the button
  and the list, at once when focus leaves them or on a scroll outside it, and with the
  popup or dialog that holds it. Focus inside the list as it closes goes back to the
  button. The card opens inside that popup or dialog, so the pointer in the list keeps the
  popup open. Tab from the button moves into the list. Escape closes only the list and
  puts focus back on the button, leaving the popup or dialog open.
- **The hint:** like a file row's code owners popover (§ File rows), the popup ends in a
  footer that stays put while the list scrolls: below a hairline, "Click the shield for
  details" in small muted text. gh-prism's mark sits in the same footer (§ The mark).
- **The filter action:** on a popup that lists files, the footer is one row: the hint on
  the left, taking the free width, and "Show only their files" on the right, both centred
  vertically. The footer's vertical padding drops to 4px, so the row stays 36px tall. The
  action is a link drawn as Primer's small invisible Button, with Octicons `filter` before
  its label, and it opens Files changed narrowed to that code owner's files. A plain click
  loads it as a new page; Cmd-click or Ctrl-click opens a new tab. The popup and the
  dialog filter to the reviewer through this action rather than a filter icon: the popup
  never draws the reviewer's name, and the dialog's box for them has no icon (§ Dialogs).
  The "GitHub hides the team" popup has no action. On a commit page there is no owner
  filter, so no surface shows the action.
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

## Owner identities

Every account a code owner surface names takes one form: its 16px avatar, then its name
without the "@". The avatar and the name are one link to the account's page. Where the
surface filters, a filter icon follows the name. The folder popover's headings, a file
shield's owner list, the code owner details dialog, and the code owner's files popup all
draw it.

- **The link:** one link per account holds its avatar and its name, so the name alone
  names the link. It opens the team page or profile in a new tab, as a name does
  everywhere on GitHub. A code owner's name is semibold `--fgColor-default`, a team
  member's login is normal weight, and either underlines on hover. Its target is its 24px
  line. A code owner's name holds one line, with its avatar and filter icon, and ends in
  an ellipsis when it doesn't fit (§ Truncated names). A team member's login wraps whole,
  and their display name after it holds one line, ending in an ellipsis when it doesn't
  fit. A token with no page, such as an email, is plain text with no avatar or icon, and
  wraps.
- **The avatar:** a circle for a user and a square with a 4px radius for a team, on
  `--avatar-bgColor` inside a 1px `--avatar-borderColor` ring. The link's target reaches
  4px above, below, and after the glyph, so it fills the 24px line. A team whose avatar
  gh-prism can't read, such as one GitHub hides, shows Octicons `people` on
  `--bgColor-neutral-muted`, at 10px in `--fgColor-muted`, instead, still inside its link.
- **The filter icon:** Octicons `filter` at 16px in `--fgColor-muted`, drawn as Primer's
  small invisible IconButton with a 24px target, right after the name and never on a line
  of its own. It follows a code owner's name in the "Owned by" headings, a file shield's
  owner list, the dialog's summary and team boxes, and the popup's "Through" line for a
  single team, or the "N teams" list for more. Its name and tooltip say whose files it
  shows, "Show only files owned by <name>", the name as the link shows it, such as
  `octo/web` or `mona`, because a heading can hold several. It is a link: a plain click
  loads Files changed with only that owner's files, and Cmd-click or Ctrl-click opens it
  in a new tab. On hover it takes `--control-transparent-bgColor-hover` and the icon turns
  `--fgColor-default`. On a page already filtered to that owner, it reads "Show all
  files", clears the filter, and takes the selected fill,
  `--control-transparent-bgColor-selected`, with the icon in `--fgColor-default`. The
  flipped name carries the state, as § Switches says, so it takes no `aria-pressed`. Where
  the surface has no filter, as on a commit page or in the Conversation panel, no icon
  follows. Nor does one follow the dialog's box for its own code owner (§ Dialogs) or a
  team member.
- **Spacing:** an identity is inline text, so a line of them copies as one line, and the
  icon adds no text. A space sets it apart from the words before it, such as "Owned by" or
  "Through", and a comma and a space separate two identities. The avatar sits 4px before
  its name. The icon's box starts 4px after the name, so its fill and focus ring clear the
  name, and its glyph sits 8px from the name's last glyph. A comma after the icon starts
  at the icon's box, outside its fill and focus ring, and 4px follow the comma's space
  before the next owner, so the comma closes the owner before it.
- **Headings:** a heading that holds identities is named by its text alone, never by its
  icons' labels. An "Owned by" heading sets its own text as its `aria-label`. A box header
  holds the link inside its heading and the icon just after it.
- **The tooltips:** the filter icons take one (§ Tooltips). The link takes one only while
  its name is cut off, to show it whole.

`ui/owner-identity.ts` builds them. Its sheet, `ui/owner-identity.css`, takes no `tw:`
classes, and each host's sheet imports it.

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
alone: shaped like what it stands in for, held back 150 ms, then pulsing. Two use it: the
commit's message and the Conversation panel, described below.

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

Structural mode's loading line is a 2px line on a pending file's diff table, held back 150
ms, for a load where GitHub's own content stays readable and there is no place to hold.
`diffs/structural-notices.ts` and `design/decisions.md` hold the detail.

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
  line, with "Show plain text" at the row's end. It scrolls with the message. When the row
  wraps in a narrow column, the mark stays at the start of its first line. Above the
  diffs, on a narrow window, the message carries no mark, because there it stands in for
  GitHub's own message box inside GitHub's card.
- **Conversation panel:** its header, beside the pin and close buttons.

The commit's Older and Newer links, the Reviewers shields themselves, and every inline
control carry none. On a control that small, a mark would crowd the content it labels and
repeat down the page. A future surface gets a mark only if it is a panel, dialog, popup,
or tooltip of gh-prism's own, decided case by case against this entry.

Two controls hold the mark's glyph as their icon, which is not a mark: it has no name and
no tooltip, and says only that the control is gh-prism's. The classic page's "Why is
gh-prism off?" button holds the bare glyph in its text colour. The diff view control's
Structural segment holds the glyph and the coloured copy that pulses, and hovering or
keyboard-focusing the segment runs the pulse (§ Switches).

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

Structural mode's per-file notice is the second user. When the mode can't show a file in
Split, a sentence directly before the file's diff table, under its file header, says why
and that this is GitHub's diff. Its text starts in line with the header's path. While the
file's diff scrolls, the notice stays stuck under the file's sticky header, on the page's
`--bgColor-default` with a 1px `--borderColor-default` hairline beneath it. It is not
announced, because a pull request in an unsupported language shows the same sentence on
every file; a screen reader reads it in place, between the header's controls and the diff.
The sentence for a language Structural mode doesn't cover ends in a link, "Request this
language", in `--fgColor-accent` and underlined, so colour isn't its only signal. It opens
gh-prism's language request form in a new tab and stays on the sentence's line.
`diffs/structural-notices.ts` holds it.

## Dialogs

The classic-page dialog is a native `<dialog>`. It enters with Primer's scale-and-fade,
while the spectrum sweeps across its top edge, and its backdrop is Primer's
`--overlay-backdrop-bgColor`. `classic/notice.ts` and `classic/notice.css` hold it.

The code owner details dialog copies that dialog's shell, its header, ✕ button, entrance,
and backdrop, but has no spectrum. It is 640px wide, Primer Dialog's `xlarge`, between a
296px minimum and the window less 64px. ✕, Escape, and a click outside close it. Opened
from a Reviewers or comment author's shield, it is about one code owner, and its heading
is that owner's identity (§ Owner identities), held to one line; any other heading is text
and wraps. Under its heading, it repeats what the shield's popover lists, built by the
same code. Then each owning team gets a box, 16px below that list, with 12px between boxes
and no hairline above them:

- **The box:** Primer's Box border, 1px `--borderColor-default`, with the medium radius.
  `exceptions.md` says why its edges sit below the 3:1 floor.
- **The header:** a row on `--bgColor-muted` with 6px by 12px padding. The team's identity
  (§ Owner identities) sits at its start in body-medium, its name cut off to fit, then its
  member count in muted body-small: "1 member" or "N members", blank for a hidden or empty
  team. A team of more than nine ends the row in a member search toggle. It is drawn as
  Primer's small invisible IconButton with a 24px target, holding Octicons `search` at
  16px. Its name and tooltip read "Filter members of <team>", such as "Filter members of
  o/team", and the search box takes the same name. It carries its state in
  `aria-expanded`, as § Switches says, and takes `--control-transparent-bgColor-selected`
  while open. The header's top corners sit 1px inside the box's, so the fill meets the
  border without clipping.
- **The body:** below a 1px `--borderColor-default` rule, with 8px by 12px padding. Its
  members, each an avatar and login linked to their profile (§ Owner identities), sit in
  columns at least 180px wide, 16px apart, with 4px between rows. A login too long for its
  column wraps, with the avatar beside its first line. A team of nine or fewer shows them
  all. A larger team shows eight, and the ninth slot holds "Show all members", a button
  drawn as a link in `--fgColor-accent`, on a member row's 24px line. It expands the grid
  in place and moves focus to the ninth member. GitHub's first list of members holds about
  20 logins and no display names, so Show all and the member search read the whole roster
  for its names. Show all expands at once to the members GitHub listed. The box takes its
  new height at once, and only the rows it reveals move: each fades in and settles from
  4px above on "State, opening", all together. Rows a landing roster adds do the same. A
  search, or any other redraw, shows its rows at once, and a row that has already faded in
  doesn't fade in again when the roster lands. Under reduced motion nothing moves. When
  GitHub's list is short of the count, the last slot reads "Loading N more members…",
  shown only after 150 ms so a fast read never flashes it, until the whole roster lands.
  If the roster can't be read, or holds fewer members than the count, that slot reads "See
  all N members", linked to the team page. Once the roster is read, each row follows the
  login with the member's display name in `--fgColor-muted` (§ Truncated names). A team
  the viewer can't see reads "GitHub doesn't show you this team's members.", and an empty
  one reads "This team has no members."
- **The member search:** the toggle shows Primer's small TextInput at the top of the body,
  8px above the grid, and focuses it. It filters every member by login or display name,
  ignoring case, with no cap. While the roster loads, a muted line under it reads "Loading
  members…", shown only after 150 ms. When the roster can't be read, the line says it
  matches among GitHub's first list of members only. No match reads "No members match
  “<query>”." Both lines are status messages, so a screen reader announces them. Escape in
  a non-empty box clears it and keeps the dialog open; in an empty box it closes the
  dialog. Pressing the toggle again hides the box and restores the list as it was.

Opened from a code owners button, the dialog lists the whole pull request instead, grouped
as a folder's popover groups its files (§ File rows). When the reviewers are known, two
marks join the owner headings, and `sidebar/owners-popover.ts` builds both:

- **The reviewer eye:** a muted `eye` after each owner a PR reviewer reviews for. Its
  hidden words and tooltip read "Reviewing" when the owner reviews, or "Reviewing through"
  and the reviewers' names when they review for the team. It never says "Reviewed",
  because a request may still be pending.
- **The "No reviewer" tag:** after a group none of whose owners a PR reviewer reviews for,
  a tag as § Tags describes. A one-line call-out with a muted alert icon above the groups
  counts those files.

Each team's filter icon shows only that team's files, as § Owner identities says. A team
named both in the list above the boxes and in its box header offers that filter twice, by
design. The box for the dialog's own code owner is the exception: it has no filter icon,
so the footer's filter action and an icon never both filter to that code owner. Its name
still links to the team page.

The dialog always ends in a footer below the scrolling body, so it stays put. A hairline
sits above it, drawn as `box-shadow: 0 -1px 0` in `--borderColor-default` to mirror the
header's. It has 8px padding and holds gh-prism's mark (§ The mark) at its start corner.
Opened from a Reviewers shield whose popup lists files, it also holds the popup's filter
action (§ Code owner's files) for the dialog's own code owner, at the end. The action is a
switch, so its label names what it does and flips with the state: on a Files changed page
already filtered to that code owner, it reads "Show all files" and clears the filter. The
icon stays the same. `ui/owners-dialog.ts` and `ui/owners-dialog.css` hold it.
