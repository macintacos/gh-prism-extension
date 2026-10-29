# gh-prism design decisions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each entry records one design pick: what was compared, what won, and why. Add new entries
at the top, dated.

## 2026-10-29: A resizable commit message column

- **Compared:**
  - a fixed 320px column, as before;
  - Primer's pane divider copied as a `role="slider"`, as GitHub's file tree has it, or as
    a `role="separator"`, the ARIA window splitter;
  - a keyboard step of Primer's 3px, or a coarser 16px;
  - keeping the width in `sync:` storage, with the other commit message choice, or in
    `local:`;
  - a 1332px breakpoint from the picked width, moving the column above the diffs whenever
    the window can't fit it, or a column that narrows with the window down to a minimum.
- **Won:** a `role="separator"` on the column's inner edge with Primer's pane divider's
  look and feel: a 5px grip centred on the 1px border, `col-resize`, a
  `--bgColor-neutral-muted` wash fading in over 150 ms on hover and while dragged, and
  arrow keys at 3px; the width in `local:commitColumnWidth`, 320px until set; held between
  Primer's 256px pane minimum and the window's width past GitHub's 1012px docked layout;
  above the diffs below 1268px.
- **Why:** The divider sits a tree's width from GitHub's own, so any other look or step
  would read as a different control. A separator names what the control does, where a
  slider reads as a value to pick; the window splitter pattern is the ARIA role for it. A
  width fits one screen, so syncing it would carry a wide desktop's width to a laptop. A
  column that narrows with the window keeps the diffs at no less than GitHub's docked
  layout gives them at any width the reader picks, and keeps the column on the screen it
  was set on; moving it above the diffs while a narrower column would fit would throw away
  room the reader has. The column sits one stacking level above the tree's pane, so with
  the tree docked left the grip's overhang stays on top, and the pane's collapse slides
  under the column rather than over it.

## 2026-10-29: A commit's message, loaded in place

- **Compared:**
  - mounting the message at idle, after GitHub's box has shown, as before;
  - hiding GitHub's box from `document_start` with a sheet keyed on its body, before the
    visit starts;
  - holding the message's place from the visit's start, with GitHub's box's plain text
    copied in, or with a skeleton;
  - rendering at the visit's start, or still after the sections and idle;
  - on a failed render, collapsing the column with motion, or at once.
- **Won:** the place held from the visit's start with a skeleton: a title bar and three
  lines, held back 150 ms, pulsing as the loading view's skeletons do; GitHub's box hidden
  from the same frame; the render still after the sections and idle, fading in on the
  spatial row; a message past the length or parse-cost caps never held at all, and a
  failed render unmounting at once, back to GitHub's box.
- **Why:** Live, at 1440px, the old load showed GitHub's box for about 600 ms, then hid
  it, shifting everything below 64px up, and prepended the column, pushing the diffs 320px
  right. The visit starts in the frame the box first paints, so holding the place then
  means the diffs take their final spot in their first frame and never move. A
  `document_start` sheet would hide the box before gh-prism knows it can show anything, so
  a page it never visits would lose the box. A plain-text copy would read as content, then
  swap to a different layout; a skeleton reads as waiting. Parsing still waits, so the
  message never holds up the sidebar or the diffs. Checking the caps without parsing keeps
  the loading state from ever resolving into GitHub's box for a message too long; only a
  crafted nesting depth or a renderer bug still does, once, and rarely enough that a
  collapse animation isn't worth its code.

## 2026-10-29: The commit message's heading scale

- **Compared:** `markdown-body`'s README scale, with its 2em `h1` ruled underneath; the
  title as a bold paragraph; or the title one step above the body's text, with the body's
  headings stepped under it.
- **Won:** the title, still an `h1`, at Primer's medium title size (20px) in semibold,
  with no rule; a body `h1` at 18px and an `h2` or `h3` at 16px, unruled, so no heading in
  the body outshouts the title.
- **Why:** At 2em the title reads louder than the pull request title it sits beside and
  takes three lines of a 320px column. A paragraph would drop the heading assistive
  technology announces. One step up still marks the title; the body's headings stay
  semibold, so they still read as headings at the text's size.

## 2026-10-29: A subject-only commit keeps GitHub's box

- **Compared:** rendering every commit's message, or only a message with a body.
- **Won:** only a message with a body; a subject line alone gets no rendering, column,
  switch, or loading state.
- **Why:** A subject line renders as one heading, which says nothing GitHub's box doesn't,
  and a column holding one line takes the diffs' width for it.

## 2026-10-28: A commit's message beside the diffs

- **Compared:**
  - a sticky flex child of GitHub's layout row, a fixed column with a margin on the row,
    or two copies of the message toggled by CSS;
  - hiding GitHub's box through a hidden slot before it, or through an attribute on
    `<html>`;
  - mounting the column at idle with the message, or reserving it at visit start;
  - for the column's plain text, moving GitHub's box into it, or a copy of the box's
    children.
- **Won:** the sticky flex child, 320px wide, from a 1332px window, with GitHub's tree
  pane's geometry (`position: sticky; top: 0; height: 100vh`), a `--borderColor-default`
  hairline on its inline end, and `order: -1`; the slot; mounting at idle; the copy,
  `div.gh-prism-commit-message-plain`, laid out as the box is: a flex column, padded 8px
  12px.
- **Why:** GitHub's tree pane is already a sticky, independently scrolling column in the
  same row, so the message column copies it and the window stays the scroller, which keeps
  GitHub's sticky file headers and lazy diff loading working. 320px is Primer's large pane
  width: prose wants more measure than the tree's file names. GitHub docks the tree from
  1012px, so 1012 + 320 keeps the diffs at least as wide as GitHub gives them. The column
  starts below GitHub's header and sticks at the window's top once the header scrolls
  away; from then on it ends at the window's bottom. Before that first scroll it shares
  the pane's top and bottom edges, as the sidebar does, because capping it to the visible
  height would need a scroll listener rewriting its height every frame. A fixed column
  overlaps GitHub's header until the page scrolls, and its margin fights the pane's
  geometry. Two copies would render the message twice and split any state between them.
  The slot keeps every GitHub selector out of the sheet and sets no page-wide state to
  clear on abort. Mounting at idle costs the diffs one reflow when the column arrives;
  reserving an empty column at visit start is the upgrade path if that reads as a jump.
  GitHub's box stays where React put it, since React owns it; the copy skips the box's own
  class, which `findCommitMessage` matches.

## 2026-10-28: The commit message's view switch

- **Compared:**
  - Primer's segmented control with both views named, as GitHub's file view shows Preview
    and Code;
  - Primer's toggle switch, labelled, with its On and Off;
  - Primer's small invisible icon button, whose label and tooltip name the action, as the
    side switch does;
  - the switch in a row of its own above the message, or at the message's top-right
    corner;
  - a key for it.
- **Won:** the icon button, with Octicons' Markdown mark, labelled "Show plain text" or
  "Show rendered Markdown"; at the rendering's top-right corner, where it stays when
  GitHub's box shows; no key.
- **Why:** The brief keeps controls quiet at rest and puts their detail in a tooltip that
  names the action. A segmented control is loud on every commit, and Preview and Code
  describe a file, not a message. A toggle switch's On and Off don't say which view is on.
  One button at one corner in both views lets a reader flip back without looking for it.
  No control takes a key yet, and a reader flips this rarely.

## 2026-10-28: A commit's message as Markdown

- **Compared:**
  - GitHub's renderer, `marked`, `markdown-it`, or micromark with its GFM extension;
  - the title as an `h1` or a styled paragraph;
  - an image as an image, a link, or nothing;
  - rendering on a plain idle callback, once the sidebar's sections have landed, or once
    they have landed or a second has passed;
  - guarding the parse with a flat cap on emphasis and bracket delimiters, a lower length
    cap, parsing in the background script, or a per-paragraph cost estimate;
  - the container's padding.
- **Won:** micromark, building plain DOM; the title as an `h1`; an image as a link to its
  URL labelled with its alt text; rendering once the sections have landed or a second has
  passed, then once the browser is idle; the per-paragraph cost estimate; `markdown-body`
  with the box's measured `8px 12px` padding.
- **Why:** GitHub's renderer is out of reach: a commit page has no preview endpoint to
  call, GitHub's comment preview turns single newlines into `<br>`, and its REST API needs
  a new site permission. `marked` passes raw HTML and `javascript:` links through, so it
  needs a sanitiser. `markdown-it` needs an unmaintained plugin for task lists and is the
  largest. micromark yields a syntax tree that gh-prism turns into DOM itself, so no HTML
  string is parsed. Inside `markdown-body`, an `h1` takes GitHub's README title style, the
  size of a pull request's title. An image would load an untrusted URL, and dropping it
  would lose the reference. A plain idle callback rendered the message about 77 ms before
  the sections, so the message got ahead of the sidebar, which it must never hold up.
  Waiting for the sections alone held GitHub's box up for a whole cold intent read, often
  seconds on a large commit, then shifted the diffs. A flat cap of 2,000 delimiters still
  let one paragraph take 825 ms, and one unclosed `[` before 40,000 characters of prose
  took 551 ms. A length cap low enough to bound the worst case would refuse ordinary
  messages. Parsing in the background script adds a messaging round trip to every render.
  The estimate held every adversarial shape tried to about 50–100 ms, and still accepts a
  300-bullet message with bold, links, and code on every line. The box's padding keeps the
  card's edges where GitHub drew them.

## 2026-10-28: A code owner's files as a flattened tree

- **Compared:**
  - `@pierre/trees` or a hand-built list;
  - one heading per directory, or nested folders with single-child chains merged;
  - eliding a long folder's start, or breaking it after a slash;
  - 400, 440, or 480px for the code owner's files popup;
  - the tree for that popup alone, or for every file list.
- **Won:** a hand-built nested list, flattened as the sidebar flattens, breaking after a
  slash, 440px for the popup and 400px for the folder popover, in every file list.
- **Why:** `@pierre/trees` is a virtualized, keyboard-driven widget. A static card of tens
  of files needs neither, and the library would bring the sidebar's shadow-root runtime to
  the Conversation tab. Nesting prints a shared prefix once, as the sidebar does. Eliding
  needs measuring in a card that is gone in a second, and hides the path being checked. At
  440px, a nested folder path of about 50 monospace characters fits on one line. The
  popup, its details dialog, and the folder popover show the same paths, so they read the
  same.

## 2026-10-28: Code owner details in a dialog

- **Compared:**
  - a shield's click: opening a dialog, or keeping the popover open with a "More" link;
  - the dialog's mount: the page's body with its own stylesheet, or the sections view;
  - the members listed per team: 10, 15, or 20;
  - the popover's hint: a header line or a footer that stays put while the list scrolls,
    reading "Click the shield for details" or "Click for more".
- **Won:** a dialog, mounted in the page's body, listing 15 members, with the hint in a
  footer below a hairline reading "Click the shield for details".
- **Why:** the issue asks for the shield's click itself to open the details. A "More" link
  would add a second step: a click that pins the popover, then a click on the link. A
  dialog in the body serves a shield in the sidebar's shadow root and one on the
  Conversation tab alike, so neither needs a second mount. 15 sits in the middle of the
  requested 10 to 20. The footer keeps the heading and list where they were and stays
  visible over a long folder list. "Click the shield" names what to click, since the
  pointer may already have moved into the popover.

## 2026-10-28: A folder's code owners

- **Compared:** for a folder's shield, the spot over its icon, as a file's, and its row's
  end. For a flattened chain's shield, the path of its first folder and of its deepest.
  For its popover, the folder's own files against every file under it, and owned files
  only against every file.
- **Won:** the row's end, centred on the file rows' Viewed box column; the deepest folder;
  and every file under the folder, each with its owners or alone.
- **Why:** a folder's icon gives way to its chevron, so a shield there would hide the
  open-or-closed cue, and a reviewer resting on the chevron to fold the folder would open
  a popover and pin it instead. A chain flattens only when each folder holds nothing but
  the next, so its deepest folder holds the same files, and the tree already hands every
  hook that path. A folder's shield shows for any owned file below it, so its popover
  lists nested files too, and the issue asks for the whole folder, so unowned files stay.

## 2026-10-28: A file's code owners on hover

- **Compared:** for the file sidebar's shield, opening its popover on a click only, and
  opening it on hover and focus with the Conversation popup's timing. For a click on a
  shield whose popover hover already opened: closing it, as a second click closes a
  click-opened popover, and keeping it open with focus inside.
- **Won:** hover and focus open it, and that click keeps it open, taking focus.
- **Why:** one timing for both code-owner popups, so a reviewer who learns one knows the
  other. A click right after the popover appears is a reach for its links, so closing it
  then would undo what the reviewer asked for.

## 2026-10-28: A shield for every code owner reviewer

- **Compared:** for a PR reviewer who owns files where GitHub draws no shield, as after a
  code owner reviews: a shield drawn as GitHub's own, a mark of gh-prism's own beside the
  name, and the popup opening from the name. For the teams that make a reviewer an owner:
  one line under the count, a team label on each file row, and nothing. For a code owner
  whose team GitHub hides: a sentence in the popup, and no popup.
- **Won:** a shield drawn as GitHub's, in the same spot; one "Through @org/team" line,
  each team linked; and one sentence saying GitHub hides the team.
- **Why:** one trigger for every code owner keeps one gesture to learn, and a shield
  matching GitHub's reads as the same fact GitHub states, that the reviewer is a code
  owner. A mark of gh-prism's own would be a second symbol for it, and the name keeps
  GitHub's hovercard. A single line names the team without repeating it on every row,
  which is noise when one team owns them all. A shield that opens nothing reads as broken,
  so the hidden team gets a plain sentence, as [`brief.md`](brief.md) asks of a degraded
  state.

## 2026-10-28: A code owner's files, from their Reviewers sidebar shield

- **Compared:** four triggers for the popup listing a code owner's files:
  - the code-owner shield, the shield icon GitHub shows beside a team or person in the
    Reviewers sidebar who owns code in the pull request;
  - the name or avatar, replacing GitHub's card with gh-prism's on shielded rows;
  - the name, appending the list into GitHub's card, which grows the card away from the
    arrow GitHub placed it by;
  - the name, opening beside GitHub's card, which stacks two cards at once.

  Also compared: GitHub's three measured edges for a floating surface. Primer's ActionMenu
  draws no border and lets `--shadow-floating-small`'s 1px ring be its edge. A legacy
  `details-menu` dropdown draws a 1px `--borderColor-default` border and that full shadow,
  so its edge doubles. The hovercard draws the 1px border and no shadow.
- **Won:** the shield as the trigger. One edge won for every floating surface: overlays
  take the ActionMenu's ring, and the code owner's files popup takes the hovercard's
  border.
- **Why:** the shield has only a tooltip, so gh-prism's card never shares a trigger with
  GitHub's. A PR reviewer without a shield gets no popup. Each surface gets one edge
  because two read as about 2px in dark mode. The popup opens one row away from where
  GitHub's hovercard opens, so it takes that card's 1px `--borderColor-default` border
  rather than a shadow.

## 2026-10-28: Only files owned by… in GitHub's filter menu

- **Compared:** building the section from gh-prism's own classes against copying GitHub's
  menu markup and checkmark; moving GitHub's "Only files owned by you" into the section
  against standing in for it; and entries with file counts against entries without.
- **Won:** copies of GitHub's own group and item, keeping its checkmark; a "Me" copy that
  forwards its pick to GitHub's hidden item; and entries without counts.
- **Why:** Primer's hashed classes exist only in GitHub's page, so a copy looks native in
  light and dark where a rebuild would drift. Moving a node React owns breaks its next
  render, and forwarding the click sets exactly what GitHub's item sets. GitHub draws its
  counts differently per group, and the sidebar's sections already count files.

## 2026-10-28: A file's code owners

- **Compared:** a CSS-only swap opened by a new row key; a shield inside the row's icon
  cell; a separate shield button beside the row; Octicons `shield` against `shield-lock`;
  and a closing transition against closing at once.
- **Won:** the separate button, `shield-lock`, and closing at once.
- **Why:** the button is a real, valid tab stop that Enter and Space open with no new key,
  where a control inside the row's `<button role="treeitem">` is invalid. `shield-lock` is
  the glyph GitHub's own file header shows for CODEOWNERS. A popover that exists only
  while open has nothing left to animate out.

## 2026-10-27: A quieter header counter

- **Compared:** the tinted pills as shipped, and six untinted rows beside GitHub's own
  header controls, each in light and dark. Three kept each icon in its section's hue:
  bare, ruled off by short hairlines, and with the counts muted until hover. Three greyed
  the icons: bare, ruled, and taking each icon's hue back on hover.
- **Won:** grey icons that take their section's hue while the counter is hovered or
  focused, ruled off by short `--borderColor-default` hairlines. The pills lose their
  tint, and the counts keep their green and red.
- **Why:** beside GitHub's own controls, the tints and hued icons pulled the eye away from
  the review. Hover and focus still tie each pill back to its sidebar section. The
  hairline is decoration, because the spacing and icons already separate the sections, so
  it stays as faint as the mockup rather than meeting the 3:1 floor for hairlines.

## 2026-10-26: Names too long for their row

- **Compared:** three treatments, mocked on a chain of five flattened folders. The first
  drops leading folders whole behind `…` and shows the full path in a tooltip on hover and
  focus. The second keeps the first folder and as many trailing folders as fit around a
  `…`, and scrolls the full name back and forth on hover and focus. The third cuts each
  parent folder to its first few letters and opens the full path over the row on hover and
  focus.
- **Won:** the scrolling name. A folder chain keeps its first folder and as many trailing
  folders as fit, and hides the rest behind one `…` between slashes. When that doesn't
  fit, the first folder hides too. A folder's name is cut only when the deepest folder
  alone doesn't fit the row. A file row scrolls only its name, not its path. Under reduced
  motion, the reviewer scrolls the full name by hand. The row refits as the sidebar is
  resized, so a sidebar wide enough shows the whole path.
- **Why:** a reviewer should see roughly where a file lives at a glance, and hover should
  pin down exactly where. The scroll departs from the brief's rule to move only to confirm
  an action or show a state change, so the brief says so once this lands.

## 2026-10-23: Section edge and corners

- **Compared:** three hairlines at 8px corners, each in light and dark. Each mixed the
  section's hue into a different ground: Primer's translucent muted border, its solid
  default border, or, in a dark theme, a ground darker than the fill. Then three corner
  radii, all with the solid-border hairline: 6px, 8px, and 10px. The radius pick doesn't
  depend on which hairline won.
- **Won:** the darker ground, and 6px corners.
- **Why:** the first hairline read as too light in a dark theme. The 12px corners in the
  Section surface entry below felt too round, and 6px matches GitHub's file cards.

## 2026-10-23: Section surface

- **Compared:** the 8% hue tint at 6px with no edge, as shipped; the tint with a hairline
  in the section's hue and Primer's resting shadow, at 12px; and the same with a tint
  strongest behind the header, fading toward the last row.
- **Won:** the tint with a hairline and resting shadow, with its edge and corners refined
  in the entry above.
- **Why:** the hairline and shadow set each section apart from its neighbours and keep the
  tint that carries its hue. The maintainer gave no reason against the header-weighted
  fade.

## 2026-10-23: State-change timing

- **Compared:** for a section collapsing and expanding, 200 ms on
  `cubic-bezier(0.4, 0, 0.2, 1)` both ways, as shipped; 240 ms `ease-out` both ways; and a
  240 ms open on `cubic-bezier(0.16, 1, 0.3, 1)` with a 160 ms `ease-out` close.
- **Won:** the quicker close. It sets the state rows of the motion scale in `tokens.md`.
- **Why:** a reviewer folds sections often, and a close as slow as the open reads as lag.

## 2026-10-23: Key hints

- **Compared:** no hints; a keycap on each control, with a setting to hide them; and the
  key in the control's tooltip.
- **Won:** the tooltip.
- **Why:** it follows GitHub's own convention and keeps the sidebar quiet at rest.

## 2026-10-23: Sound

- **Compared:** no sound; sound on by default with an off switch; and sound off by default
  as an opt-in.
- **Won:** no sound.
- **Why:** both other options need a settings surface gh-prism doesn't have, and a sound
  inside github.com would surprise reviewers.

## 2026-10-23: Host stance

- **Settled:** gh-prism takes GitHub's palette, faces, and theme, keeps the spectrum as
  its one signature, and takes no key GitHub binds on the page.
- **Why:** gh-prism is a guest in GitHub's page. These were the starting assumptions for
  the picks above, and none was contested.
