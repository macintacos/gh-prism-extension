# gh-prism design decisions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each entry records one design pick: what was compared, what won, and why. Add new entries
at the top, dated.

## 2026-11-12: Structural mode's notice sticks under the file header

- **Asked for:** the maintainer asked for the notice to stay on screen while its file's
  diff scrolls, with nothing else about its styling changed, and noted that GitHub's file
  header is itself sticky.
- **Compared:**
  - for where the stuck notice's offset comes from, a pixel value measured once, a copy of
    GitHub's `calc()` for the header's `top`, or GitHub's own computed values;
  - for the stuck notice's ground, the page's `--bgColor-default` or the header's
    `--bgColor-muted`;
  - for what separates it from the rows passing beneath, nothing, a blurred drop shadow, a
    hairline shown only while stuck, or a hairline always;
  - for the loading line, sticking it too, or leaving it on the table's top edge.
- **Won:**
  - Every kind of notice sticks directly below its file's sticky header while any of the
    file's diff is on screen, in the file's card, below the header and above the diff's
    rows. At rest it keeps its height, text, spacing, and link.
  - Its `top` is the `top` GitHub's stylesheet computes for a sticky file header, plus
    that file's own header height, which a `ResizeObserver` reports. Scrolling runs no
    script.
  - Its ground is `--bgColor-default`, the colour the page already shows behind it.
  - A 1px `--borderColor-default` hairline under the notice, at rest and stuck alike. It
    is a `box-shadow` with no blur, so it adds no height.
  - The loading line does not stick.
- **Why:**
  - A measured pixel value breaks the first time GitHub changes its header: a pull
    request's header sticks at 108px and is 42px high, and a commit's sticks at 66px and
    is 46px high (2026-11-12, at 1280px wide). GitHub's `calc()` reads a custom property
    set on the header itself, which the notice can't inherit. A copy of it would also go
    stale silently.
  - `--bgColor-default` leaves the notice at rest exactly as it was, since the card is
    transparent over the page. The header's `--bgColor-muted` would restyle it.
  - With no edge, a row passing under the notice is cut off mid-line with nothing to cut
    it, and reads as a drawing fault. A blurred drop shadow is a new material on a page
    that has none. A hairline shown only while stuck needs a scroll-state container query,
    which Firefox lacks, or a script watching each notice. The always-on hairline is the
    card's own border colour, adds no height, and matches the sticky key hint at the foot
    of the code owner details dialog (`ui/owners-dialog.ts`). At rest it lands on the top
    edge of the table's first row, most often a tinted hunk header.
  - The loading line shows for a moment and is replaced by the paint or by a notice, so
    there is nothing to keep on screen.
- **Accepted:**
  - The hairline is the one change to the notice at rest.
  - At a file's end, the last scroll of the notice's own height pushes it up under the
    header, as it does the diff's last rows. Only then does the header start to leave. The
    notice sits in the file's card and the header in the file's region, which clips its
    contents, so the two can't leave in step unless the notice moves into GitHub's header.
  - A notice sticks once two readings exist: the `top` of any file header on the page that
    GitHub has made sticky, and the height of its own file's header, which arrives when
    that header is first rendered. Should no header be sticky yet when the notices draw,
    they look again at each later change to the diffs, and stick at the first one that
    finds a sticky header.
- **Checked:** 2026-11-12, signed in, in Chromium 156 and Firefox 157, light and dark, on
  <https://github.com/apple/swift-argument-parser/pull/952/changes?diff=split> and its
  merge commit `0db78d17cf`. At rest and mid-file the notice's top met the header's bottom
  with a 0px gap. At 600px wide the notice wraps to two lines and still meets the header.
  In Chromium the gap stayed 0px with Compact line height, in GitHub's diff settings menu,
  on and off, and after pressing Structural from Unified.

## 2026-11-11: The Structural segment leads with gh-prism's prism

- **Asked for:** the maintainer asked for "a little prism icon to the left of the word
  'Structural'" in the diff view control, which highlights while the pointer is anywhere
  on the segment, "like it does in other areas of the UI". They named no surface.
- **Compared:**
  - for the highlight, the mark's pulse through the section hues, or the step from muted
    to the default text colour that the classic page's "Why is gh-prism off?" button gives
    its glyph;
  - for the glyph's size, 16px or the label's 12px;
  - for the pressed segment at rest, the muted glyph or the label's colour;
  - for a hovered pressed segment, the pulse or a still glyph;
  - for keyboard focus, the pulse or nothing;
  - for an unavailable segment, the pulse or a still glyph;
  - for assistive technology, a named image as the mark is, or decoration.
- **Won:** the mark's glyph at 16px before the label, on Structural alone, hidden from
  assistive technology, so the segment's name stays "Structural Beta".
  - At rest the glyph is `--fgColor-muted`.
  - While the segment is hovered or shows keyboard focus, pressed or not, the glyph runs
    the mark's own hover from the mark's own sheet: the same cross-fade to a coloured
    copy, which pulses through the same hues and fades between full and 70% opacity on the
    same timing.
  - At rest, a pressed segment's glyph takes the label's colour.
  - An unavailable segment's glyph takes the label's disabled colour and stays still.
  - Under reduced motion, hover and focus swap at once to the mark's still
    `--fgColor-accent` copy.
  - Under forced colours there is no pulse, and the glyph is `ButtonText`, as the label
    is.
- **Why:**
  - **Highlight:** the pulse is what a reviewer has seen gh-prism's prism do on every
    panel and dialog, so the same glyph doing it here reads as the same thing. The classic
    button's step is that button's own text colour, not a treatment of the prism.
  - **Size:** the glyph is drawn for 16px, and its 1.5px bars blur at 12px. Primer sets a
    16px icon beside body-small text in its small Button, as the classic page's button
    does.
  - **Pressed:** the pressed segment is the control's one emphasis, so its icon rises with
    its semibold label. The step changes lightness, not hue, so the state still doesn't
    depend on colour: weight and edge carry it.
  - **Hovered while pressed:** the pulse says whose view this is, not that a press will do
    something, and the segment's tooltip shows there too.
  - **Focus:** `design/brief.md` gives focus the same detail as hover. The mark itself is
    hover-only because it takes no focus, and the segment does.
  - **Unavailable:** a lit icon would invite a press that does nothing.
  - **Decoration:** the label already names the view. The mark's name, "Added by
    gh-prism", would prefix the segment's name.
- **Measured** 2026-11-11, signed in, on sandbox PR #3 and commit `8d807ee`, in Chromium
  157 and Firefox 157, against `design/brief.md`'s 3:1 floor for an icon. The two browsers
  computed the same colours:

  | Glyph | On | Light | Dark |
  | --- | --- | --- | --- |
  | resting, `--fgColor-muted` | the track | 5.06:1 | 7.05:1 |
  | resting, the label's colour | the pressed knob | 15.80:1 | 12.90:1 |
  | the four hues at full opacity | the hovered track | 3.87:1 to 4.13:1 | 3.89:1 to 5.19:1 |
  | the four hues at full opacity | the pressed knob | 4.87:1 to 5.19:1 | 4.17:1 to 5.56:1 |

  - The segment is 142px wide, where it was 122px, and still 26px high in a 28px track.
  - On a pull request, wherever the toolbar's row has slack, GitHub's buttons hold their
    places, and the name and the Viewed counter sit 20px further left.
  - On a pull request the control gives up its room 10px to 20px sooner, measured in 10px
    steps:
    - in Chromium the name shows from 890px, where it showed from 870px, and the control
      from 830px, where it showed from 820px;
    - in Firefox the name shows from 910px, where it showed from 890px, and the control
      from 860px, where it showed from 840px.
  - Just above each of those widths the row is at its tightest, and the gear sits up to
    20px further right.
  - The toolbar overflows at no width from 500px to 1600px with the control shown.
  - On a commit, the name still goes below 1100px and the control below 768px. From 768px
    to 1000px the search box is 20px narrower, 287px at 768px. From 1090px up the gear
    sits 20px further right.
- **Accepted:**
  - At the pulse's dimmest point, 70% opacity, a hue is 2.48:1 to 3.47:1, below the icon
    floor for part of the loop, as the mark's pulse is on its other surfaces. The icon is
    decoration, and the label beside it holds the text floor.
  - The disabled glyph is below 3:1, as the disabled label is.
  - Forced colours were checked in Chromium's emulation only, and themes by switching
    `data-color-mode`.

## 2026-11-11: Structural mode marks a line changed in full inside a unit that remains

This replaces the pick of the 2026-11-11 "Structural mode steps down the tint of a line
changed in part" entry below, that a line changed in full never has a mark. Its tint step
stands.

- **Asked:** the maintainer uses the dark theme. There, the four removed names of a
  wrapped import were a band only slightly stronger than the lines around it, which did
  not read as highlighted. They proposed deciding by syntax instead of by rows: mark a
  line changed in full when the syntax around it remains, and leave a block that left or
  arrived whole to GitHub's line tint.
- **Compared:**
  - which lines get the mark: every line whose smallest syntax node that has its lines to
    itself remains in part, as proposed; or the same rule with three changes, listed under
    **Won**;
  - how the marks on consecutive lines look: one rounded mark over each line's text, or
    one joined shape over the run;
  - the tint step: kept, softened, or dropped.
- **Won:**
  - A **unit** is a syntax node that starts at its line's first token and ends at its
    line's last. A unit changed whole, inside a parent node that was not, keeps GitHub's
    line tint and has no mark: a deleted statement, method, or function. So does every
    line of a file added or deleted whole. Any other line changed in full gets one mark
    over its text.
  - A `;` after a node is part of that node's unit, so a deleted class field or interface
    member is a unit, as a deleted method is.
  - In a list that separates its entries with commas, an entry on one line is not a unit,
    with or without a comma after it: a name in an import, an argument, a property. An
    entry on several lines is a unit, with its comma.
  - The largest node changed whole decides whether its lines get a mark, not the smallest.
    Every line of an entry on several lines then looks the same.
  - Each line has its own rounded mark, the same mark a changed token has.
  - The tint step stays. A marked line takes the quiet row's tint, whether it changed in
    part or in full.
- **Why:**
  - **The three changes:** as proposed, an import's last name, which no comma follows, is
    a whole-line node and would keep the tint while the names above it got marks. A
    10-line entry added to an array would get a mark on most of its lines but not on the
    lines that hold only a bracket. A deleted interface member would get a mark and a
    deleted method none.
  - **One mark per line:** lines differ in length, so a joined shape is a stepped outline,
    and it needs a painter that draws across cells. A mark per line is what the reader
    already knows from a changed token, and the 4px between two marks keeps the lines
    apart.
  - **The tint step:** with it, a mark is the only strong colour on its row. Without it, a
    marked line would sit on the same tint as the unmarked block beside it, and the mark
    would add little in the dark theme.
- **Measured** 2026-11-11, signed in, Chromium 156, light and dark, on gh-prism pull
  request #119:
  - `tests/utils/structural/engine-script.test.ts`: old lines 4 to 7 each have one mark
    over the name and its comma. Old lines 10 to 125, the statements and tests deleted
    below the import, have none.
  - `utils/structural/engine-worker.ts`, a new file, has no mark.
  - Across the pull request's 25 files that the engine reads, 1,104 lines changed in full.
    67 of them now have a mark. The count comes from running the engine on the two
    commits, not from the page.
- **Accepted:**
  - A list whose entries have no separator has units for entries: a YAML mapping's or
    sequence's entry, an HTML or JSX attribute on its own line, a Go struct's field. A
    deleted one keeps the tint.
  - A call's only argument, on its own line, has no comma beside it, so it is a unit.
  - A run of one-line entries added to a list that remains gets a mark on each line, as
    long as the run is.
  - A line comment that continues another is its own node, so a reworded `//` line among
    others keeps the tint, while a reworded line of a block comment gets a mark.
  - The engine's diff can match a bracket of a removed entry to a bracket that stayed. The
    entry is then not changed whole, and its lines are split between marks and tint.
  - A `.txt` file has no syntax tree, so its lines changed in full keep the tint.

## 2026-11-11: Structural mode keeps the syntax colour of words GitHub's diff picked

- **Found:** GitHub wraps each word its own diff picked in a `.x` span and gives that span
  a brighter background and the line's plain text colour. Structural mode cleared the
  background and left the colour, so those words lost their syntax colour: white in the
  dark theme, among coloured text.
- **Compared:** leaving GitHub's colour; `color: inherit` on every `.x` span; or giving
  each `.x` span the colour GitHub's syntax rule for its class gives it.
- **Won:** in a painted table, a word GitHub's diff picked shows the same colour as it
  would on a line GitHub didn't pick it on. A table Structural mode doesn't paint keeps
  GitHub's look.
- **Why:**
  - **Leaving it:** GitHub's diff and Structural mode's often disagree. A word in another
    colour with no mark, or a mark beside such a word, reads as a second word-level signal
    that conflicts with the marks.
  - **`inherit` alone:** the `.x` class sits on the syntax span itself, so inheriting
    takes the line's plain colour, which is what GitHub already sets.
  - **The syntax colour:** the mark is then the only word-level signal in a painted table.
    The cost is a copy of GitHub's syntax colour rules in `structural.css`.
- **Measured** 2026-11-11, signed in, Chromium 156, on gh-prism pull request #119, light
  then dark: the lowest contrast of a `.x` word against its mark is 3.92:1 light and
  4.32:1 dark, both on a removed line and both the keyword colour. Other marked text on
  the same pages already shows 3.92:1 light and 3.74:1 dark. With Structural off, a `.x`
  word computes GitHub's own colour and background.
- **Accepted:** a `.x` word on a mark can now sit below 4.5:1, as the rest of a marked
  line's syntax-coloured text does. The 2026-11-11 "Structural mode's marks are rounded,
  joined, and not underlined" entry below accepts that level.

## 2026-11-11: Structural mode steps down the tint of a line changed in part

This replaces the "Whole lines" reasoning of the 2026-11-11 "Structural mode's marks are
rounded, joined, and not underlined" entry below. The 2026-11-11 "Structural mode marks a
line changed in full inside a unit that remains" entry above narrows its pick, that a line
changed in full has no mark.

- **Asked:** the maintainer saw a multi-line import lose four of its five names. The four
  removed lines had no mark, the one line changed in part had a single mark on its comma,
  and all five carried the same line tint, so nothing showed which names went away. They
  asked for the removed lines to read as removed, without bringing back a mark on every
  changed line.
- **Compared:**
  - a mark on a line changed in full only when its run of changed rows also holds a quiet
    row or a line changed in part;
  - a mark on every line changed in full, drawn as one block per run of lines;
  - no new mark, and GitHub's line tint stepped down on a line changed in part, as it is
    on a quiet row.
- **Won:** a line changed in part takes the quiet row's tint under its marks. GitHub's
  line tint at full strength then means that every token on the line changed.
- **Why:**
  - **Marks by neighbourhood:** a deleted block that follows a changed line with no blank
    line between them would get a mark on each of its lines, which is the look the
    maintainer first rejected. The same line would also look different from one diff to
    the next.
  - **One block per run:** lines differ in length, so the block is a stepped outline over
    all the code of a new file or a deleted function, and every such line needs measuring.
  - **The tint:** each row is decided on its own. A changed token always sits on a strong
    colour, a mark or the full line tint, and an unchanged token always sits on the quiet
    row's tint. A run of lines changed in full is one unbroken band, and a new file looks
    as GitHub draws it.
  - **Cost:** the painter writes one more attribute, `data-gh-prism-part`, on a row whose
    line changed in part, and measures nothing more.
- **Measured** 2026-11-11, signed in, Chromium 156, light and dark, on gh-prism pull
  request #119's `tests/utils/structural/engine-script.test.ts`: old lines 4 to 7 keep
  GitHub's tint, `rgba(248, 81, 73, 0.1)` in the dark theme, and lines 3, 8, and 9 take
  the quiet row's tint, with one mark on line 8's comma.
  `utils/structural/engine-worker.ts`, which the pull request adds, shows GitHub's tint
  and no mark on its code.
- **Accepted:**
  - The step between the quiet row's tint and GitHub's is small in the dark theme, where
    GitHub's own line tint is close to the page. `--gh-prism-quiet-tint` sets it.
  - A line changed in part and a quiet row share one tint. The marks tell them apart.

## 2026-11-11: Structural mode reads all of a Markdown file by word

- **Asked for:** the maintainer saw a long line of a fenced block in
  `docs/ARCHITECTURE.md` marked over words that had not changed, and said Markdown read as
  less accurate than code.
- **Compared:**
  - for a fenced or indented code block, a table cell, an HTML block, a link reference
    definition, and front matter, the grammar's own pieces, or words as in prose;
  - for the spacing of code and front matter, kept as written, or ignored inside a line
    with the line's depth kept;
  - for a table's delimiter row, its dashes compared, or skipped.
- **Won:**
  - Every kind of Markdown text is compared word by word, with spacing ignored.
  - A line of a code block or of front matter carries its depth on its first word, as a
    line of Python does.
  - A delimiter row's dashes are not compared. Its alignment colons are.
- **Why:**
  - **Words:** the grammar splits this text only at punctuation, so a piece was a clause
    or a whole cell, and the piece that ended a line kept its line break. Text added after
    an unchanged clause therefore marked the clause, and one changed word marked its whole
    piece.
  - **Spacing:** a fenced block's language is unknown, and most languages ignore spacing
    inside a line, as the engine does for code it parses. Indentation is the spacing that
    can carry meaning, so a line moved deeper or shallower is still a change.
  - **Delimiter row:** widening a column re-pads every row and lengthens the dashes. With
    the dashes skipped and the padding ignored, a new row is all that is marked.
- **Measured** 2026-11-11, signed in, Chromium 156, dark, on gh-prism pull request #120's
  `docs/ARCHITECTURE.md`, old line 1030 against new line 1036: the old side marks `-` and
  "loader", and the new side marks "the host runs requests on" and the three clauses added
  at the end. Before, both sides also marked " the engine" and " and the list of packaged
  files", which did not change.
- **Accepted:**
  - Code respaced inside a line, such as `f(a,b)` to `f(a, b)`, shows a quiet row, even in
    a language where that spacing matters.
  - A reworded word in a link's target marks only that part of the URL.

## 2026-11-11: Structural mode marks the changed words of running text

- **Asked for:** the maintainer reworded one clause of a doc comment and saw every line of
  the comment painted. They asked for only the changed words, and for `.txt` files to get
  the same diff.
- **Compared:**
  - for what counts as running text, comments alone, or also strings, JSX and HTML text,
    Markdown prose, and YAML scalars;
  - for a word's spacing, ignored everywhere, or kept where it is content;
  - for a comment's markers, every marker dropped from the diff, or only a later line's
    leader: the `*` that leads it, or the repeated marker of a continuing line comment;
  - for a new comment's later lines, a mark across each line's words, the leader drawn
    inside the first word's mark, or the leader counted as changed when the rest of its
    line is.
- **Won:**
  - A comment, a string's text, JSX and HTML text, Markdown prose, and a YAML scalar are
    compared word by word in all 22 languages, and so is a `.txt` file.
  - Spacing is ignored in a comment, Markdown prose, and a `.txt` file. It counts as one
    space in JSX and HTML text and in a YAML block scalar. It is kept as written in a
    string.
  - A comment's opening marker and a block comment's closing marker are compared. The
    leader of a later line is not, and it counts as changed only when every word after it
    on its line changed.
- **Why:**
  - **Running text:** each of these was one token, so one reworded word painted all of it,
    which is the problem the maintainer reported for comments.
  - **Spacing:** a re-wrapped comment or a reflowed paragraph says the same thing, so it
    stays quiet. A string's spacing is part of its value, so `"a b"` to `"a  b"` is a
    change.
  - **Markers:** with every marker dropped, a new comment's `//` would look unchanged.
    With the leaders compared, a re-wrap would mark each `*` it moved.
  - **New comments:** a mark across every later line of a new comment made it louder than
    the new code around it, which has no mark because its lines changed in full. A leader
    inside a reworded word's mark would show a change that didn't happen. Counting the
    leader with a line changed in full gives a new comment GitHub's line tint alone.
- **Measured** 2026-11-11, signed in, Chromium 157 and Firefox 157, light and dark, on
  gh-prism pull request #113's `entrypoints/content/files-page.ts`: the reworded doc
  comment shows one mark on the removed "and" and two on the added clauses, and the doc
  comments the pull request adds further down show no mark.
- **Accepted:**
  - A comment whose style alone changed, such as `//` to `/* */`, marks only its markers.
  - A YAML block scalar or HTML text whose line breaks alone changed shows a quiet row,
    though a line break in a literal block scalar is part of its value.

## 2026-11-11: The diff view control shows its name, and replaces GitHub's Layout group

- **Asked for:** the maintainer tried the control and asked for three things: a visible
  label such as "Diff Style"; GitHub's own Layout group removed from the gear's menu; and
  a link beside the unsupported-language notice to request that language.
- **Compared:**
  - for the name, "Diff style", "Layout", or "Diff view";
  - for its place, before the track, inside the track, or in a tooltip;
  - for assistive technology, the visible name labelling the list, or the list keeping its
    own name with the visible copy hidden;
  - for a toolbar short of room, hiding the control whole, or dropping the name first;
  - for the Layout group, hiding it, disabling its items, or leaving it;
  - for the link's words, "Request this language", "Ask for this language", or "Report".
- **Won:** "Diff view" in muted body-small text before the track, `aria-hidden`, with the
  list keeping its `aria-label`. When room runs short, the name hides first, then the
  control. The gear's menu opens without its Layout group and the divider under it while
  the control is drawn. The notice ends in an underlined accent link, "Request this
  language".
- **Why:**
  - **Name:** GitHub names the gear "Open diff view settings", the control's accessible
    name was already "Diff view", and "Layout" would leave out Structural, which is no
    layout. "Style" appears nowhere on GitHub's page.
  - **Place:** before the track it reads as a form label does. Inside the track it would
    read as a fourth segment, and a tooltip stays hidden until hover, which is the problem
    the maintainer reported.
  - **Assistive technology:** a screen reader announces the list's name on entering it. A
    readable label beside it would say "Diff view" twice.
  - **Room:** the name is the part a reviewer can do without, so it goes first.
  - **Layout group:** two controls for one choice ask the reviewer which is real. Disabled
    items would keep the clutter. The group returns whenever the control is hidden, so a
    reviewer never loses the only way to switch.
  - **Link:** the verb says what the click does, and "this language" ties it to the file
    whose diff it sits above.
- **Measured** live on sandbox PR #3 and commit `8d807ee`, in Chromium 157 and Firefox
  157, signed in, light theme:
  - on a pull request the name shows at 768px and is gone at 720px, and the control shows
    at 700px and is gone at 660px; GitHub's buttons hold their places at every width from
    500px to 1600px, and the Viewed counter moves left by the name's width;
  - on a commit the search box keeps its 215px with the name shown from 1100px up, and the
    toolbar matches the earlier build below that;
  - the notice with its link stays one line, 27.5px high, in a 1142px diff;
  - the link's `rgb(9, 105, 218)` on white is 5.2:1.

## 2026-11-11: Structural mode's marks are rounded, joined, and not underlined

This replaces the 2026-11-10 "Structural mode's moved lines" entry below, and the
changed-token half of the 2026-11-10 "Structural mode's changed tokens and quiet rows"
entry.

- **Asked:** the maintainer, after using the mode: the separate highlights per token look
  "noisy / choppy", and several changed lines in a row should read as "a single contiguous
  block"; "I'm not a huge fan of the underlining"; the dotted boxes are "not clear"; and
  the backgrounds "feel a tiny bit cramped, and a bit harsh", wanting a little padding and
  rounded corners that don't disturb the layout.
- **Compared:**
  - for joining, changed tokens joined across whitespace only, across unchanged
    punctuation too, or out to the line's indentation;
  - for a line changed in full, one brighter block around the run of lines, or no mark at
    all;
  - for the paint, `::highlight()`, a `<span>` around each token, an element laid over the
    table, or a masked `::before` behind the line's text;
  - for the moved-line outline, a quieter mark that explains itself on hover and focus, or
    no mark;
  - for the underline's job, a 1px ring around each mark, or nothing in its place.
- **Won:**
  - Changed tokens with only whitespace between them share one mark.
  - A line changed in full has no mark, so a run of such lines is GitHub's own line tint,
    unbroken.
  - A mark reaches 2px past its text on every side, with a 3px corner, in GitHub's
    word-mark colour mixed 85% into the line tint. A masked `::before` on the line's
    `.diff-text-inner` draws it.
  - The underline and the moved-line outline are gone, with nothing in their place.
  - A selected line keeps its marks.
- **Why:**
  - **Joining:** whitespace is not a token, so joining across it claims nothing the engine
    didn't report. A mark over unchanged punctuation or indentation would show a change
    that didn't happen.
  - **Whole lines:** when every token on a line is marked, the marks say nothing the line
    tint doesn't. Dropping them leaves three steps a reader can rank: a quiet row, a
    changed line, and a mark inside a changed line. GitHub draws a wholly added or removed
    line the same way.
  - **Paint:** `::highlight()` takes a background colour but no padding and no radius. A
    `<span>` would change markup React owns. An element over the table would tint the
    text. The `::before` sits behind the text, adds no node, and takes no space.
  - **Size:** the code's line is 20px tall and its text 12px or 13px, so 2px above and
    below leaves marks on neighbouring lines at least 3px apart. 3px is Primer's small
    radius, `--borderRadius-small`.
  - **Moved lines:** the outline showed on lines such as `);` and `}`, where it says only
    that the same text is on both sides. A mark that needs a hover to explain itself would
    add a focus stop inside GitHub's grid for a signal that is often wrong.
  - **Underline:** it told a changed token from an unchanged one by shape. The mark's
    rounded box is that shape now. Which side changed is told by the column and by
    GitHub's `+` or `-`. A ring would bring back the noise the maintainer asked to remove.
  - **Selected lines:** GitHub keeps its own word marks on a selected line.
- **Measured** 2026-11-11, signed in, Chromium 156, on sandbox PR #4 and gh-prism pull
  requests #117 and #122, light then dark:
  - the lowest contrast of any text on a marked line, against the mark and then against
    GitHub's own word-mark colour:

    | Line    | Theme | On the mark | On GitHub's word mark |
    | ------- | ----- | ----------- | --------------------- |
    | Added   | light | 4.12:1      | 4.00:1                |
    | Added   | dark  | 3.12:1      | 2.94:1                |
    | Removed | light | 3.92:1      | 3.81:1                |
    | Removed | dark  | 3.99:1      | 3.71:1                |

  - a mark against its line tint: 1.17:1 light and 1.74:1 dark on an added line, and
    1.19:1 light and 1.71:1 dark on a removed line;
  - with the mode on and off, every row and every text fragment sat at the same place in
    its table: 2,227 rows and 39,867 text boxes, 826 of the lines wrapped.
- **Accepted:**
  - The lowest text contrast on a mark is below 4.5:1, as it is on GitHub's own word
    marks, where the same syntax colours sit on a stronger colour. A mark raises that
    contrast a little and never lowers it; gh-prism doesn't recolour GitHub's text.
  - A mark against its line tint is below the 3:1 floor for a non-text mark, as GitHub's
    own word marks are. `prefers-contrast: more` brings the mark to GitHub's full
    word-mark colour, and `forced-colors: active` paints the changed text in the system's
    `Mark` colours.
  - A mark that starts at a line's first column has no padding on that side, because
    `.diff-text-inner` clips there.
- **Skipped:** marking code that moved, and a ring under `prefers-contrast: more`.

## 2026-11-10: A Unified, Split, and Structural control beside the diff settings gear

- **Compared:**
  - for its place, first in the toolbar's row like the other toolbar toggles, before the
    gear's wrapper, or immediately before the gear;
  - for its form, Primer's segmented control, a labelled button opening a menu, or a third
    item beside GitHub's two in its Layout menu;
  - for its semantics, Primer's `aria-pressed` buttons, or a radio group moved through
    with the arrow keys;
  - for the Beta tag, inside the Structural segment or beside the control, and neutral or
    GitHub's green Preview label;
  - for confirming a switch, the Layout item's `aria-checked`, or the diff tables;
  - for a layout the page can't tell, a guess, or no pressed segment.
- **Won:** Primer's segmented control, immediately before the gear, as three
  `aria-pressed` buttons that take no key. Structural holds a neutral "Beta" tag in the
  "No reviewer" tag's form. It also holds the only tooltip: "Highlights what changed in
  the code and quiets formatting-only changes. Beta: it may have bugs." On a pull request
  filtered to one commit, Structural is disabled, and its tooltip reads "Structural isn't
  available while viewing one commit of a pull request." A switch is confirmed from the
  tables' columns, and no segment is pressed while the layout can't be told. Unified and
  Split choose GitHub's own Layout item, so GitHub keeps saving the layout; Structural
  chooses Split and turns the mode on.
- **Why:**
  - **Place:** the control replaces a setting the gear's menu holds, so it sits beside the
    gear, and on a narrow pull request the gear's wrapper then hides the control with the
    gear.
  - **Form:** the choice is three-way, GitHub's own Layout is already a one-of-many
    choice, and a menu would hide which view is on. A third Layout item would live inside
    React's menu, which gh-prism doesn't edit.
  - **Semantics:** Primer's own segmented control uses `aria-pressed` buttons, each a Tab
    stop pressed with Enter or Space, so the control binds no key GitHub might bind.
  - **Tag:** inside the segment it names the one view it qualifies, and it joins the
    button's name, "Structural Beta". Green would read as lines added.
  - **Confirming:** in 10 of 10 live switches the item never read `aria-checked="true"`
    before GitHub's menu closed. The tables' columns change within 24 to 57 ms.
  - **No guess:** a pressed segment that disagreed with the gear would mislead; showing
    nothing is honest.
- **The 2026-10-28 rejection doesn't apply:** that entry turned down a segmented control
  for a commit message's two views as loud on every commit, with Preview and Code naming a
  file. This control replaces a choice GitHub already offers, has three views, and names
  them in GitHub's own words.
- **Measured** live on sandbox PR #3 and a sandbox commit in Chromium 156, light then
  dark, against floors of 4.5:1 for text and 3:1 for marks:
  - a label on the track 13.07:1 and 18.87:1, on the hovered track 12.55:1 and 12.04:1,
    and on the knob 15.80:1 and 12.90:1;
  - the Beta tag on the track 5.06:1 and 7.05:1, on the hovered track 4.86:1 and 4.50:1,
    and on the knob 6.11:1 and 4.82:1;
  - the knob's edge on the track 5.06:1 and 3.87:1. Primer's own
    `--controlKnob-borderColor-rest` measured 1.18:1 and 2.09:1, so the edge takes
    `--borderColor-neutral-emphasis`, a neutral Primer variable that holds the floor;
  - the focus ring 4.30:1 and 4.43:1 on the track, and 5.19:1 and 3.03:1 on the knob;
  - segments at least 24px both ways, 26px high at 100% text and 54px at 200%, and the
    track 28px, the gear's height, so the toolbar's row keeps its height.

  The dark Beta tag on the hovered track sits exactly on the floor. The Beta pill's
  hairline, like the "No reviewer" pill's, is decoration; the tag's text carries it.
- **Known limits:**
  - No segment is pressed while the layout can't be told: a pull request whose mounted
    files all change one side only, with the mode off.
  - The control hides while GitHub's toolbar has no room for it, because that toolbar
    never wraps; GitHub's own menu still switches layouts. On a commit's page it is also
    hidden below 768px.
  - A visit-wide guard keeps a pointer press from `pointerdown` until the pointer is
    released or cancelled, so a release on the re-mounted segment still presses it when
    GitHub's hydration re-mounts the page mid-press. A press made before GitHub has
    hydrated the page opens no menu, so it chooses nothing and the control stays for
    another press. On a commit's page a press held across hydration is lost, because
    GitHub's toolbar moves 308px right under the pointer and the release lands off the
    control.
  - A change made in another tab shows on the next full load.
  - Chrome before 145 rings the segment when focus returns to it after a pointer press.
  - Themes were measured by switching `data-color-mode`, and 200% text by the root font
    size, which doesn't scale media queries in `em`.

## 2026-11-10: Structural mode's notices and loading line

- **Compared:** for where a file's notice sits, inside the sticky file header, after the
  diff table, on the file's row in the sidebar, or directly before the diff table, under
  the file header, in GitHub's card. For the loading treatment, the spectrum bar, a
  skeleton over the diff, a "Comparing…" sentence in the notice's place, or a thin line on
  the table's top edge.
- **Won:** in Split, a `<p>` of gh-prism's own directly before the file's diff table, in
  small muted text with no icon, its text starting in line with the file header's path.
  Each kind has one sentence:
  - unsupported: "Structural mode doesn't cover this file's language yet, so this is
    GitHub's diff."
  - too large: "This file is too large for Structural mode, so this is GitHub's diff."
  - rate-limited: "GitHub is rate-limiting requests, so this is GitHub's diff; reload to
    try Structural mode again."
  - no access: "Sign in to GitHub to see this file in Structural mode; until then, this is
    GitHub's diff."
  - unparsed: "Structural mode can't read this file's syntax, so this is GitHub's diff."
  - failed: "Structural mode is in beta and couldn't compare this file, so this is
    GitHub's diff."
  - mismatch: "Structural mode is in beta and its reading of this file doesn't match the
    page, so this is GitHub's diff; reload to try again."

  The notice carries no `role` and no `aria-live`. For loading, a 2px `--fgColor-muted`
  `<div>` overlaying the table's top 2px, shown once the file's request has been pending
  150 ms, pulsing to 0.45 opacity, standing still at full strength under reduced motion,
  and `aria-hidden`. The line shows only on a file whose own table is drawn in Split.
- **Why:** the notice leaves the sticky file header and its chrome alone, so the band
  gh-prism measures from the header does not change. After the table, the reason would sit
  below a long diff, and the sidebar is away from the diff being read. The two kinds a
  gh-prism bug could cause, failed and mismatch, say Structural mode is in beta. The
  notice is not announced because a pull request in an unsupported language shows the same
  sentence under every file (13 on sandbox PR #3), and a live region would speak it once
  per file. A screen reader reads it in place, after the file header's controls and before
  the diff. The spectrum is kept for where gh-prism announces itself, a skeleton would
  hide GitHub's readable diff, and a sentence would push the code down and back within a
  second. The hold is a timer per pending file, not the CSS animation delay the skeletons
  use, because a delayed node would be inserted and removed under GitHub's diffs for every
  request that settles in under 150 ms. Measured 2026-11-10 in Chromium on sandbox PR #3
  in Split: the notice holds 6.11:1 light (`#59636e` on `#fff`) and 6.50:1 dark (`#9198a1`
  on `#0d1117`), above 4.5:1. The loading line at full opacity holds 5.37:1 light (on
  `#ddf4ff`) and 5.82:1 dark (on about `#111d2e`) against the hunk row it overlays, above
  3:1, and the still line under reduced motion holds those values.
- **Skipped:** `aria-describedby` from GitHub's grid to the notice, a retry for a failed
  file, and a separate sentence for a run that timed out, which the too-large sentence
  covers.
- **Accepted:** a notice that lands on a file already on screen pushes its code down one
  line, about 26px. On a virtualized list, a remounted file gets its notice again a moment
  after its table, because the pass waits for the diffs to settle. Measured 2026-11-10 in
  Chromium on the virtualized commit page
  <https://github.com/cli/cli/commit/2ea46117e59a9fbcb31f673565eb2b5207e08aae?diff=split>:
  the row in the viewport's middle moved 0px over 240 scroll steps with the mode on and
  off, and all 5 re-insertions landed on a table above the viewport, likely held by the
  browser's scroll anchoring. Firefox and a virtualized pull request list were not
  measured. The pulse's trough, 0.45 opacity, falls below 3:1, about 1.9:1 in light by
  calculation (`#59636e` at 0.45 over `#ddf4ff`); the line passes through it for a moment,
  as the skeletons' pulse does.

## 2026-11-10: Structural mode's moved lines

- **Compared:** for the mark, a 1px dashed outline on the moved line's code cell, a dashed
  underline under the line's text, a dashed rule down the cell's start edge, or dropping
  the changed-token paint so only the mark shows. For its colour, `--fgColor-muted`, the
  added and removed foregrounds, or an attention colour.
- **Won:** `outline: 1px dashed var(--fgColor-muted)`, offset -1px, on the old and new
  code cells of a moved line. The changed-token paint stays, and a selected moved line
  keeps its outline.
- **Why:** the dash is a shape, so colour is never the only signal. An outline changes no
  layout, where a border would resize the cell. It stays clear of the token underlines,
  which a dashed underline would collide with on the lines that carry the most of them. A
  start-edge rule reads as a side stripe. Dropping the token paint would hide changes the
  engine reported. `--fgColor-muted` is a Primer variable that GitHub themes. It is also
  gh-prism's most-used neutral, so the mark adds no colour; a red or green dash would read
  as added or removed. Measured live on sandbox PR #3 against GitHub's line tint, the
  outline holds 5.49:1 (light, addition), 5.33:1 (light, deletion), 5.43:1 (dark,
  addition), and 5.91:1 (dark, deletion), above the 3:1 floor for non-text marks.
- **Skipped:** an accessible name for the mark, pairing lines across files, and joining
  adjacent moved lines into one outline. As a result, adjacent moved lines show a doubled
  dashed rule where their outlines meet.
- **Accepted:** a short line that repeats (`}`, `});`, `return null;`) pairs with any
  same-text line on the other side of the file, so its mark says only that the same text
  is on both sides. A filter requiring a letter or digit, or a minimum length, waits until
  structural mode is hosted and the noise can be seen on real diffs.

## 2026-11-10: Structural mode's changed tokens and quiet rows

- **Compared:** for a changed token, GitHub's word-mark colour alone, or with an
  underline. For a quiet row, dimming its text, dropping GitHub's tint, or stepping the
  tint down. For the underline's colour, a `--diffBlob-*` variable, or the foregrounds
  that lines added and removed already take. For the removed underline, three Primer
  candidates measured live against the deletion word background on sandbox PR #3:
  `--fgColor-danger` (3.73:1 light, 2.78:1 dark), `--borderColor-danger-emphasis` (3.81:1,
  2.02:1), and `--display-red-fgColor` (4.32:1, 3.57:1).
- **Won:** a changed token takes GitHub's word-mark background plus a 2px underline,
  offset 3px, in `--fgColor-success` when added and `--display-red-fgColor` when removed.
  A quiet row's two cells on its quiet side step GitHub's tint down to 40% over
  `--bgColor-default`, keeping the text and the `+`/`-` marker. In painted tables,
  GitHub's own word marks are switched off.
- **Why:** the word-mark background keeps the text contrast GitHub ships, and the
  underline is the signal that does not rely on colour. The `--diffBlob-*` family's only
  foreground is the text colour, which would read as ordinary underlined text. The added
  underline holds 3.8:1 light and 3.37:1 dark, above the 3:1 floor for non-text marks.
  `--fgColor-danger` failed that floor in the dark theme, so the removed underline takes
  `--display-red-fgColor`. Dimming a quiet row's text takes syntax colours below 4.5:1, as
  the Viewed dim does. Dropping the tint leaves it indistinguishable from context but for
  its marker. Switching GitHub's marks off means no mark gh-prism did not choose reads as
  a changed token.

## 2026-11-10: A toolbar toggle and Shift+\ for a commit's message, with motion

This replaces the 2026-10-29 "Hiding a commit's message" entry below: its hide control,
its way back, "no motion", and its per-commit hidden state.

- **Asked:** the maintainer, on a commit page: closing the message column "doesn't have a
  button in an obvious location I would've imagined that shift+\ would work"; the column
  "should get the shift+\ button instead of a 'hide' button", "always visible", like the
  file tree's toggle and the Conversation button; and closing and opening "should have a
  nice animation".
- **Compared:**
  - for the control's place, the column's controls row, as before, or the diffs' toolbar,
    first in its row or beside GitHub's tree toggle;
  - for its form, a labelled button, or the Conversation button's icon and keycap;
  - for its icon, `eye` and `eye-closed`, `sidebar-collapse`, `markdown`, or `git-commit`;
  - for its name, one that flips with the state, or one name with `aria-expanded`;
  - for showing that the message is open, nothing, as the Conversation button, or the
    pressed fill GitHub's tree toggle takes while its tree shows;
  - for the "Show commit message" row in GitHub's box's place, keeping it or dropping it;
  - above the diffs, a control of its own in the commit's card, or the same toolbar
    toggle;
  - for the column's motion, the file tree's view-transition glide, animating the column's
    width, or sliding the column off the row's start edge at its full width;
  - above the diffs, no motion, or folding the message's height;
  - for focus after Shift+\, the message, or the toggle;
  - for the hidden state, one per commit, as before, or one for every commit, as GitHub's
    file tree keeps;
  - on a page whose toolbar row gh-prism can't find, keeping a hidden message hidden, or
    showing it.
- **Won:**
  - One toggle, first in the diffs' toolbar row, in both layouts. It is the Conversation
    button's form: Primer's small default Button holding Octicons `git-commit`, then the
    "⇧\" keycap. `ui/key-button.ts` builds both buttons.
  - It is named "Commit message" in both states, with `aria-expanded`, `aria-controls`,
    and `aria-keyshortcuts`. Its tooltip reads "Commit message (Shift+\)" and opens
    rightward.
  - While the message shows, it takes the default Button's pressed fill,
    `--button-default-bgColor-active`.
  - Shift+\ presses it, on a commit page where gh-prism renders the message. The key moves
    focus to the toggle without a ring. A click leaves focus on the toggle. Focus held
    inside the message moves to the toggle as the message hides.
  - The "Hide" button and the "Show commit message" row are gone.
  - The column slides off the row's start edge on the "State, closing" row of `tokens.md`,
    160 ms `ease-out`, and back on its Spatial row, 280 ms. The column keeps its full
    width, and the tree and the diffs move with its edge.
  - Above the diffs, the message folds its height shut and open on the same two rows, and
    GitHub's own box folds with it in the plaintext view.
  - A toggle pressed again mid-slide turns the slide around from where it is. Under
    reduced motion the message takes its new state at once.
  - One hidden state for every commit, in `sync:commitMessageHidden`. Hiding the message
    on one commit hides it on every commit page until the reader shows it again. A tab
    keeps its own copy, so a soft navigation opens as the reader last left it; another
    tab's pick shows on its next full load, as the Conversation panel's open state does.
  - Without the toolbar row there is no toggle and no key, and a hidden message shows.
- **Why:**
  - The toolbar is sticky, so the toggle stays on screen in both states and at any scroll.
    The controls row left with the message it hid, which is why the way back needed a
    second control somewhere else.
  - First in the row puts the toggle at the diffs' start edge, beside the column it
    controls. With the tree docked left, it comes before the tree's toggle, in the order
    the two columns sit on the page.
  - The maintainer pointed at the Conversation button and the tree toggle, and one form
    for the three toolbar toggles reads as one family.
  - `sidebar-collapse` is the tree toggle's icon, so two of them a few pixels apart would
    differ only by keycap. An eye flips with the state, and a disclosure keeps one icon.
    `markdown` is the view switch's icon. `git-commit` names what the toggle controls and
    is used nowhere else on the page.
  - The toggle discloses the message, so `aria-expanded` carries the state and the name
    stays put, as `patterns.md` § Switches says.
  - The Conversation button needs no fill because its open panel covers the page. A closed
    message column leaves no trace, so the fill is how the toggle shows its state at a
    glance, and it matches the tree toggle beside it.
  - The toggle and its key bring a hidden message back from either layout, so the row in
    the commit's card repeated them and cost the card a line.
  - The pinned Conversation panel already slides off the page's left edge while the page
    moves with it, on these timings. The glide cross-fades two snapshots of the diffs,
    which the maintainer found jarring on that panel. Animating the width rewraps the
    message's text in every frame. A slide at full width does neither.
  - The fold moves the diffs with the message's edge instead of jumping them by the
    message's height.
  - `\` already lands on the tree toggle without a ring, and the message is prose with no
    first control worth landing on.
  - A hidden message with no toggle and no key could never be shown again.
  - A reader who hides the message wants room for the diffs, and wants it on the next
    commit too, as with the file tree. `sync:` carries it with the message's view.
    `local:hiddenCommitMessages`, the per-commit list a released version wrote, is removed
    on each install or update.
- **Known limits:** Above the diffs, on a page scrolled past the commit's card, the toggle
  changes only its own fill, because the message is off screen. Chrome before 145 ignores
  `focus({ focusVisible: false })` and rings the toggle after Shift+\.

## 2026-11-10: A conventional commit's title leads with a type label

- **Asked:** "if a commit message follows conventional commit formatting … for the first
  line, I'd like to stylize it similarly, using a github-style badge, with the context in
  parentheses (if it's there) as a subtle grey text, and then the rest of the message."
  The model was Refined GitHub's labels on a commits list.
- **Compared:**
  - for the label, GitHub's own `IssueLabel` classes, which the commit page's sheets
    already style, or a pill rebuilt from Primer's tokens;
  - for its colours, Refined GitHub's per-type values, or the five section hues;
  - for its size in the rendered title, GitHub's 12px label, or the 14px body size;
  - for the scope, muted at the title's weight, or muted and lighter;
  - for GitHub's box on a subject-only commit, a badged copy in front of GitHub's hidden
    title, or GitHub's own text node rewritten, as Refined GitHub does;
  - for the plain-text view, the badge, or the message as written.
- **Won:**
  - GitHub's `IssueLabel hx_IssueLabel` classes, coloured through their `--label-*`
    properties.
  - Refined GitHub's values and names: the colours of GitHub's default issue labels for
    `feat`, `fix`, `docs`, `build`, `refactor`, `test`, `ci`, and `perf`, and a neutral
    label for `chore`, `revert`, and `style`. A breaking change's `!` ends the label.
  - In the rendered title, the label is 14px, 22px tall with its border, and raised 2px to
    centre it on the text. In GitHub's box it is 12px, GitHub's own label size. Both are
    in the sans face.
  - The scope in `--fgColor-muted` at the title's weight, with its colon.
  - A copy in front of GitHub's hidden title.
  - No badge in the plain-text view.
- **Why:**
  - GitHub's label rules already switch between a solid fill in a light theme and a tinted
    one in a dark theme. A rebuilt pill would copy that arithmetic and drift from it.
  - A title reads the same on the commits list, under Refined GitHub, and on the commit's
    page. The section hues already mean a section, so a type in one would read as a
    section.
  - Refined GitHub sets its label at 14px beside a 16px title. At 12px beside the 20px
    rendered title the label looked undersized, and at 14px it still fits the title's 25px
    line, so a wrapped title keeps its line height. GitHub's box sets its title at 14px in
    a 21px line, which the 20px-tall 12px label fits.
  - The description is the title's one emphasis. A muted scope steps back from it without
    a second weight in the heading.
  - React owns GitHub's title and can write its text again at any render. A copy leaves
    React's nodes as they were, and removing it restores the box.
  - The plain-text view is the message as its author wrote it, prefix included.

## 2026-11-10: The Conversation panel's header takes GitHub's collapsed sticky header's box

- **Asked:** GitHub's collapsed sticky header, the bar that stays at the top of Files
  changed once its header scrolls away, has a 48px row. The panel's header row was 44px,
  so its divider sat 4px above GitHub's. The maintainer asked for the dividers to meet,
  and to "adjust elements in that header to match the increase in space".
- **Compared:**
  - for the height, Primer's `--base-size-48` token, which GitHub sizes that bar's row
    with, or a fixed 48px;
  - for the taller row's contents, Primer's medium 32px controls, a larger title, more
    padding, or the same controls and title centred in the row.
- **Won:**
  - A 48px content box from `--base-size-48`, over the same `--borderWidth-thin` (1px)
    `--borderColor-default` divider. The two dividers meet on one line in both the panel's
    overlay and pinned modes.
  - The small 28px controls and the 14px semibold title, centred in the row, with the 12px
    inline padding kept.
- **Why:**
  - The token keeps the header in step with GitHub's bar if Primer's value or the root
    font size changes.
  - GitHub's own bar centres Primer's small controls and a 14px semibold title in its 48px
    row. Centred the same way, the panel's controls and title sit at the same heights as
    GitHub's across the seam. Medium controls or a larger title would sit off them.
  - More block padding would size the row from its contents rather than from GitHub's
    token, so the divider would drift whenever a control's size changed. The 12px inline
    padding stays, because the taller row adds space only above and below the controls.

## 2026-11-09: Three member columns, eight then Show all

- **Asked:** "now that we made it a little wider, I think we can go to three columns of
  members, showing up to 8 members by default, with the last entry being the "Show all
  members" link"
- **Won:**
  - Member columns at least 180px wide, so the 640px dialog fits three.
  - A team of nine or fewer shows every member. A larger team shows eight, and the ninth
    slot holds "Show all members", filling a 3 × 3 grid.
- **Supersedes:** the 240px column minimum from "A wider details dialog…" and "five, then
  Show all" from "Team boxes…".

## 2026-11-09: A code owners shield on each section header

- **Asked:** "it'd be awesome if the codeowners shield icon could pop up, replacing the
  diff numbers on the right side of the header, and it perform similar to the other
  shields that we have in the sidebar - clicking it should show me the same popup, but for
  codeowners in that section, covering all files / folders in that section."
- **Compared:**
  - for the placement, the shield beside the line totals, or in their place;
  - for the structure, the shield inside the header's toggle, or beside it;
  - for the popover's list, the files flat, or as a tree from the repository root.
- **Won:**
  - In the totals' place, on hover and focus.
  - Beside the toggle, outside the heading.
  - A tree from the repository root.
- **Why:**
  - It mirrors a file row's icon giving way to its shield, as asked.
  - A button can't hold another button, and the heading's name stays the section's.
  - A section has no folder of its own, and the tree matches every other owners list.

## 2026-11-09: A wider details dialog, "N teams", and Show all's motion

After trying the details dialog on a real pull request, the user asked: "When clicking
'Show all members', it would be nice if there was a subtle, quick animation to show the
other members." Then: "Could we make the entire modal a little bit wider actually? it
feels a little cramped at its current width." And for a reviewer who owns through several
teams: "it'd be awesome if we could consolidate these lines into like, some kind of '#
groups' list that, when hovered, showed another popup with the group names that they're a
member of."

- **Compared:**
  - for the width, Primer Dialog's 640px `xlarge`, or a custom 560px;
  - for when "N teams" replaces the inline teams, one team or more, or two or more;
  - for the list, a floating card opened inside the popup or dialog, or a native
    `<details>`;
  - for Show all's motion, rows that fade and settle on "State, opening", or the grid's
    height growing.
- **Won:**
  - 640px, with member columns raised from 180px to 240px.
  - Two or more teams.
  - The floating card.
  - Fade-and-settle rows.
- **Why:**
  - 640px is Primer's next Dialog step after `large`. The 240px column minimum keeps two
    columns at that width instead of three cramped ones.
  - One team fits inline and gains nothing from a hover.
  - A `<details>` opens only on click and pushes the lines below it down, and the user
    asked for a list that opens on hover.
  - Firefox can't transition a grid's `auto` height.

## 2026-11-09: Team boxes in the code owner details dialog

- **Compared:**
  - for where members come from, GitHub's members JSON alone, or the team's members page,
    read on demand;
  - for the member search toggle's glyph, Octicons `search`, or `filter`;
  - for how many members a box shows, 15 with a "See all N members" footer link, or 5 with
    a "Show all members" slot that expands in place;
  - for a cut-off owner name, the sidebar's scroll reveal, or an end ellipsis with the
    owner tooltip.
- **Won:**
  - The members page, read only on Show all or a search.
  - The magnifier.
  - Five, then Show all.
  - The end ellipsis and the owner tooltip.
- **Why:**
  - GitHub's members JSON stops at about 20 logins and carries no names, so only the
    members page can list everyone and match a display name.
  - The filter icon, a funnel, already means "show only their files" in the same row. The
    toggle is named "Filter members of <team>", not "Search", since it narrows the list
    rather than leaving it.
  - Five, then Show all, keeps the box short and shows every member in the same grid. The
    user asked to "show 5 at max, with the 6th slot showing a "Show all members" link"
    that expands "inline, in a similar columnar style as the other members".
  - The scroll reveal is reserved for the sidebar's rows, so an owner name, a user's or a
    team's, ends in an ellipsis and shows whole in the tooltip, as the user asked: "when
    the user hovers over a truncated value, it should show the full name".

## 2026-11-08: The Conversation panel over GitHub's pull request overview

- **Compared:**
  - for the panel's name, keeping "Conversation", or naming it after the page GitHub
    serves;
  - for the top of the framed overview, keeping its sticky title bar and header, or hiding
    everything above its merge box;
  - for the gap above the merge box, the overview's own 24px, or the Conversation frame's
    16px;
  - for the header's jumps, both, or the sidebar's alone.
- **Won:**
  - "Overview" wherever the panel and its button said "Conversation": the heading, the
    panel's and frame's names, the pin, close, and resize labels, the button's name and
    tooltip, and the failure sentence. A viewer on the classic tab still reads
    "Conversation".
  - Hidden down to the merge box, which stays: it shows the checks.
  - 16px.
  - The sidebar's alone, landing on the Reviewers section while the sidebar sits below the
    main column.
- **Why:** the maintainer: "all of the stuff in the red box could probably go away", the
  header "which we should probably rewrite to be "Overview" instead of "Conversation"",
  "there are no buttons to bring you to the reviewers section", and "we probably don't
  need the one that brings you to the "Checks" section, since the thing at the top now can
  show that." The 16px matches the 2026-10-31 pick for the Conversation's timeline.

## 2026-11-08: The overview Reviewers heading's code owners button over the rows' shields

- **Compared:** the overview's button floated to the heading's inline end, as first built
  from GitHub's bundle, and the button placed as the classic sidebar's is, over the rows'
  code-owner shields, before the gear.
- **Won:** over the rows' shields, at 28px, Primer's small invisible IconButton. Its
  centre lines up with the heading's title and gear, and with the rows' shields.
  gh-prism's own shield in an overview row drops to 16px, the size GitHub draws that row's
  icons at.
- **Why:** on the live overview the float dropped GitHub's full-width heading button below
  it, leaving the button on a line of its own above "Reviewers". A 28px shield in a row of
  16px icons stretched that row from 28px to 36px.

## 2026-11-06: The classic Reviewers heading's code owners button over the rows' shields

- **Compared:** the button floated to the heading row's end, after GitHub's gear, and the
  button placed over the rows' code-owner shields, before the gear.
- **Won:** over the rows' shields. Its glyph centres on the shields' column, and GitHub's
  gear keeps the row's end, over the rows' status dots. It still sits 2px down, centred on
  the gear. The overview's button keeps its float, since that layout has never rendered.
- **Why:** the maintainer's review of the floated button found the heading's two icons
  swapped against the columns below and 4px off them, since the float pushed the gear in.

## 2026-11-05: The whole pull request's code owners

- **Compared:** for the mark on an owner a PR reviewer reviews for, a green check, an eye,
  and a "Reviewer" text label after the name. For the tag on a group no PR reviewer owns,
  an attention-coloured outlined label reading "No reviewer", the same label muted, the
  same words as bare muted text, and an alert icon alone. For the call-out, Primer's Flash
  banner above the groups, and one line with an alert icon above them. For the layout, a
  new list with its own grouping, and the sidebar folder popover's "Owned by" groups
  (`owners-popover.ts`) over every changed file by full path.
- **Won:** the eye, the muted, outlined "No reviewer" label, the one-line call-out, and
  the folder's groups.
- **Why the eye:** a check reads as "approved" on GitHub, but a reviewer may not have
  approved yet. The eye says only that someone is looking. A "Reviewer" label after each
  name would crowd a heading that already holds several owners.
- **Why the eye is muted:** `--fgColor-muted`, not `--fgColor-success`. `design/brief.md`
  spends colour on sections, file types, and lines added or removed only, and green would
  read as lines added.
- **Why the mark isn't the glyph alone:** the eye takes no focus, so its tooltip can't be
  its only words. Its hidden words join the owner heading's accessible name instead and
  match its tooltip exactly. Both read "Reviewing" when the owner reviews, or "Reviewing
  through grace, ada" when reviewers review for the team. Neither says "Reviewed", because
  a request may still be pending.
- **Why the tag is words:** "No reviewer", shaped like GitHub's Label, reads without
  colour. Its text is `--fgColor-muted` inside a `--borderColor-default` outline, GitHub's
  default Label. `design/brief.md` spends colour on sections, file types, and lines added
  or removed only, and `--fgColor-attention` is the "Docs & Comments" section's hue, so an
  attention-coloured tag would read as that section.
- **Why one line:** a Flash banner would outweigh the list in a dialog that already has a
  title. One line with a count says where to look: "1 file has no current reviewer among
  its code owners", or "3 files have no current reviewer among their code owners". Its
  alert icon is `--fgColor-muted`, because attention would read as the "Docs & Comments"
  section.
- **Why the folder's groups:** a reader who knows the folder popover reads the whole-PR
  list the same way, with no second grouping to learn.
- **Why "No code owner" has no tag:** it comes last in its own group, and no reviewer can
  own files that have no code owner.
- **Compared, for Files changed's button:** for its glyph, Octicons `shield-lock`,
  `people`, and `law`. For its label, the glyph alone named "Code owners" with a tooltip,
  and the glyph beside a visible "Code owners". For its look, Primer's small default
  Button like the Conversation button, and an invisible button.
- **Won:** `shield-lock` in `--fgColor-muted`, alone on a 28px square small default
  Button, right after the Conversation button. Its accessible name, "Code owners", is its
  tooltip, drawn below it as the Conversation button's is.
- **Why the shield:** gh-prism already draws `shield-lock` on every owned file and
  reviewer, as GitHub draws its own code-owner shield, so the button reads as the same
  thing for the whole pull request. `people` already means a team in the owners dialog,
  and `law` reads as a license or policy, not as owners.
- **Why a default Button:** an invisible button would sit unlike the bordered Conversation
  button beside it, so the pair would read as unrelated controls.
- **Why no visible label:** the Conversation button beside it is an icon with a tooltip,
  and a word would widen a toolbar GitHub fills. The muted glyph matches the Conversation
  button's and spends no colour, as `design/brief.md` asks.
- **Compared, for the Conversation tab's button beside each Reviewers heading:** the
  toolbar's bordered small default Button, and an invisible button. For its place: inside
  GitHub's heading control, or before it, floated to the heading's inline end.
- **Won:** the same muted `shield-lock` on an invisible button, floated to the inline end
  of the heading's row. In the classic sidebar it is 24px square, set 2px down so its
  centre lines up with the gear's centre, inside the heading's row. It stacks above
  GitHub's heading, whose full-width menu trigger would otherwise take the pointer. In the
  overview it is 28px, Primer's small invisible IconButton. Its "Code owners" tooltip
  opens leftward, because the button sits at the sidebar's inline-end edge.
- **Why invisible:** the classic heading's gear and the overview's heading button are
  borderless, so a bordered Button would be the only box in the sidebar's headings.
- **Why outside GitHub's control:** the classic `summary` and the overview's full-width
  button open GitHub's reviewers menu wherever they're clicked, so a button inside would
  open both. The cost is that focus reaches gh-prism's button just before GitHub's
  Reviewers control.

## 2026-11-05: No "Show only their files" from a classic Files changed comment shield

- **Compared:** offering "Show only their files" from a review comment author's shield on
  GitHub's classic Files changed page, as on Conversation, or leaving it out there.
- **Won:** leaving it out on the classic page. Its popup and the code owner details dialog
  still list the owner's files.
- **Why:** the classic page ignores `gh-prism-owner`, because gh-prism's sections are off
  there, so the action would reload the same unfiltered page, and a control that does
  nothing reads as broken. The shield's placement follows "2026-11-05: The code-owner
  shield beside a comment's author".

## 2026-11-05: The code-owner shield beside a comment's author

- **Compared:** where a Conversation comment's header shows that its author owns changed
  files: right after the author's name, before "commented" and the time; or in GitHub's
  right-hand column with the role labels ("Author", "Member"), the classic header's
  `d-none d-sm-flex` and the overview's badges group. For the look, GitHub's own shield
  (Octicons `shield-lock` at 16px, muted) against a text label.
- **Won:** right after the name, drawn as GitHub's shield: in the classic timeline with
  its `btn-link` class, coloured muted at rest and accent on hover as GitHub colours its
  sidebar shield (GitHub's `.muted-icon` rule applies only inside the sidebar), and in the
  overview as Primer's small invisible `IconButton` at the title row's 20px.
- **Why:** "2026-10-28: A shield for every code owner reviewer" set the precedent that
  gh-prism's shield looks like GitHub's and sits with the person it marks, so a reader
  learns one mark. Beside the name it binds to that person, as GitHub's hovercard does.
  The role-label column hides below 544px, which is the Conversation panel's usual width,
  so a shield there would vanish in the panel. A text label would add a second way to say
  "code owner". Picked without a mockup round: the direction already settles the look and
  the spot.

## 2026-11-04: Code owners drawn with avatars, linked names, filter icons, and a box per team

- **Compared:** three ways to show that a team's members in the code owner details dialog
  belong to that team:
  - a "Members of" heading before each team, with its members indented under the team's
    name;
  - a bordered box per team, with the team and its member count in the box's header and
    its members inside;
  - a line from the team's avatar down the side of its members.

  All three put each account's avatar in place of "@". For what a click on a code owner's
  name does, it compared two options: the name filters Files changed to that owner's
  files, with the avatar alone linking to the account; and the avatar and name link to the
  account together, with a filter icon after the name.
- **Won:** the box per team, and the linked name with a filter icon after it.
- **Why:** the maintainer, of the team blocks: "it needs to be more obvious that the two
  things are related - that the users are members of the team that is being called out."
  Under a hairline, a team's name and its members read as two separate things. The box
  closes each team's members inside one edge, under a header that names the team and
  counts its members, the way GitHub's team page boxes them. Shown the three, the
  maintainer: "I think I like B honestly". Everywhere on GitHub, a name opens its account.
  A name that filtered surprised people, and it needed a dotted underline and a tooltip to
  explain itself. A filter icon after the name says what it does at rest, and leaves the
  name doing what GitHub's names do.
- **Settled with it:**
  - **The link.** Every account gh-prism names shows its 16px avatar in place of "@": a
    rounded square with a 4px radius for a team, a circle for a user, on
    `--avatar-bgColor` inside a 1px `--avatar-borderColor` ring. The avatar and the name
    are one link to the team page or profile, in a new tab, named by the name. A code
    owner's name is semibold `--fgColor-default`, a member's login normal weight, and
    either underlines on hover. The link's target is 24px tall, reaching 4px above, below,
    and after the avatar's glyph. A token with no page, such as an email, stays plain text
    with no avatar. The link has no tooltip, because its visible name says where it goes.
  - **The filter icon.** Octicons `filter` at 16px in `--fgColor-muted`, drawn as Primer's
    small invisible IconButton with a 24px target, follows a code owner's name wherever
    the surface filters: the folder popover's "Owned by" headings, a file shield's owner
    list, the dialog's summary and team boxes, and the Conversation popup's "Through"
    line. Its name and tooltip read "Show only files owned by <name>", because a heading
    can hold several icons. A plain click loads Files changed with only that owner's
    files, and Cmd-click or Ctrl-click opens it in a new tab. On hover the icon turns
    `--fgColor-default`. No icon follows a team member, a commit page's owners, the
    Conversation popup inside the Conversation panel, or the box for the dialog's own code
    owner in the dialog opened from a Conversation shield, because the footer already
    offers that filter.
  - **The filtered state.** On a page filtered to an owner, that owner's icon reads "Show
    all files", clears the filter on a click, and takes the selected fill,
    `--control-transparent-bgColor-selected`, with the icon in `--fgColor-default`.
  - **The team box.** Each team is one box with Primer's Box border, 1px
    `--borderColor-default`, and the medium radius. Its header is a row on
    `--bgColor-muted`, with 6px by 12px padding and a 1px `--borderColor-default` rule
    below it. The team's avatar and name sit at its start in body-medium, and the member
    count sits at its end in muted body-small, "1 member" or "N members". The count is
    blank for a hidden or empty team. The body, with 8px by 12px padding, holds the
    members in columns at least 180px wide, 16px apart, with 4px between rows, so the
    dialog's 480px width fits two to a row. A hidden or empty team's body holds its muted
    sentence instead. A team past 15 members ends in a footer below a 1px
    `--borderColor-muted` rule, with "See all N members" linked to its team page. The
    boxes stack 12px apart, 16px below the summary, with no hairline above them.
  - **The hidden team.** When gh-prism can't read a team's avatar, as for a team GitHub
    hides, the avatar is the rounded square on `--bgColor-neutral-muted` with Octicons
    `people` at 10px in `--fgColor-muted`. It still sits inside the link to the team page.
  - **The buttons that stay.** "Show only their files" stays only in the Conversation
    popup's footer and the footer of the dialog it opens, both for the reviewer the popup
    is about, because neither surface draws a filter icon for that reviewer. Every other
    one goes, the team blocks' buttons included.

## 2026-11-04: A folder's code owners, grouped by owner set

- **Compared:** each file with its owners on a line under its name (the 2026-10-28 pick);
  and one group per distinct set of code owners, headed by its owners, over that set's
  files. For the group heading, it compared two options: a bare line of owners, and the
  owners after an "Owned by" label.
- **Won:** grouping by owner set. Owners that differ only in order or case share a group,
  headed in its first file's order. Overlapping sets stay apart. Files without a code
  owner come last under a muted "No code owner". Each group keeps the folder tree. Each
  owner set's heading reads "Owned by" followed by its owners, with the group's tree
  indented under it.
- **Why:** when the files share owners, the same team repeats under every file, ten times
  for a folder one team owns entirely, and that buries the one fact the list exists to
  show. The bare line of owners, at body-small, was smaller than the monospace file names
  under it, and the tree started flush with it, so it read as one more row of the list.
  The label marks the line as a heading over the files, not another file, and "Owned by"
  is GitHub's own wording.
- **Settled with it:** the code owner details dialog shows the same grouped list above its
  unchanged team blocks. Each group heading is an `h3` at the file list's size, with a
  muted "Owned by" and the owners in semibold, or a muted "No code owner". A file's own
  shield still lists its owners one per line.

## 2026-10-31: The pinned Conversation panel makes room for GitHub's right-hand panel

- **Compared:** keeping the pinned column at its width beside Merge status and the panels
  its dropdown switches to; and counting GitHub's open right-hand panel against the
  column's room.
- **Won:** counting it. Beside an open right-hand panel the column narrows to fit, or
  draws as the overlay when no room is left, until that panel closes. The switch has no
  slide and saves nothing, so the column comes back at its saved width.
- **Why:** the maintainer: "when I click on the "Merge status" button in the github
  interface, which brings up its on sidebar on the right, if you have the conversation
  sidebar on the left pinned, everything looks super cramped and the UI kinda blows up - a
  lot of stuff gets overlapped and whatnot".
- **Settled with it:** on a full load with a right-hand panel already open, a panel left
  open and pinned opens without focus, drawn for the room beside that panel (narrowed, or
  as the overlay when none is left), and comes back at its saved width when that panel
  closes. An overlay forced by room keeps the overlay's rules: an outside click, one
  inside Merge status included, closes it and saves closed, as on a narrow window.

## 2026-10-31: A full load restores the Conversation panel as it was left

- **Compared:** opening the panel on a full load whenever it was pinned and the window fit
  the column, as planned; and opening it only when it was also left open.
- **Won:** left open, pinned, and fitting. The reader's own opens and closes are saved; an
  open on arrival saves nothing.
- **Why:** the maintainer pinned the panel, closed it, and found it open again after a
  commit link: "I want it to always remember the last position I had it in."
- **Settled with it:** an unpinned overlay still starts closed after a full load, since it
  would cover the diffs. A window too narrow for the column starts closed and keeps the
  saved state for the next wide load. Dismissing the narrow overlay with an outside click
  saves closed, as the last position the reader saw.

## 2026-10-31: The framed Conversation ends without GitHub's site footer

- **Compared:** leaving GitHub's site footer, its Terms, Privacy, and other links over a
  copyright line, below the framed Conversation, or hiding it with the site header, PR
  title bar, and tab row.
- **Won:** hidden. The panel's content ends with the Conversation's own last item, the
  layout's 16px gap below it.
- **Why:** the maintainer: "the conversation sidebar doesn't need this footer stuff at the
  bottom, can we remove that". The footer added about 160px of links that belong to the
  site, not the pull request.

## 2026-10-31: A sidebar shortcut moves focus without a ring

- **Compared:** letting Shift+\ and `\` draw the focus ring Chrome shows after a key on
  the element they focus, or moving focus there without one.
- **Won:** no ring. Shift+\ focuses the Conversation panel, which no longer draws a ring
  of its own, and returns focus to its button with `focusVisible: false`. `\` focuses
  GitHub's tree toggle the same way before clicking it, so the toggle GitHub then focuses
  stays ringless too. Tab still rings every control it reaches.
- **Why:** the maintainer: "I don't like the focus ring that comes up when you use the
  keyboard shortcut to open these sidebars." Chrome before 145 ignores `focusVisible` and
  still rings the button and the tree toggle.

## 2026-10-31: The pinned Conversation panel stops at GitHub's real breakpoint

- **Compared:** bounding the pinned panel at the window less 1012px, letting its widest
  width tip GitHub into its narrow layout and undock the file tree, or at the window less
  1076px, where GitHub actually undocks it.
- **Won:** 1076px, the window less a classic scrollbar. On a 1600px window the widest pin
  is 524px, so the 560px default draws at 524 there. The commit message column keeps
  1012px: a commit's tree docks down to 768px.
- **Why:** GitHub measures its 1012px query against its diff viewer's content box, inside
  32px of padding a side. The maintainer saw the tree toggle and side switch jump mid-row
  as a wide pinned panel crossed it; the docked layout must hold beside any pinned width.

## 2026-10-31: The Conversation panel's header jumps to the checks and the sidebar

- **Compared:**
  - for the jump controls, Primer's small invisible Button with a text label, or its small
    invisible IconButton with a tooltip, like the pin beside them;
  - for the header's edge, a stronger border token, or the same `--borderColor-default`
    drawn where nothing covers it;
  - for the gap above the timeline, GitHub's 40px, or Primer's 16px content gap.
- **Won:**
  - IconButtons: Octicons' checklist, "Jump to checks", and people, "Jump to reviewers,
    labels, and projects", each with Primer's tooltip opening below the header. The title
    truncates to fit the mark, both controls, the pin, and ✕ at the 256px minimum.
  - `--borderColor-default` as a 1px bottom border.
  - 16px.
- **Why:**
  - The maintainer asked to reach the checks and the reviewers / projects / labels list
    without scrolling, and two text labels don't fit the header at 256px.
  - The edge was a 1px shadow below the header, which the positioned body painted over; as
    a border inside the header it shows in both themes at the default token.
  - The maintainer saw the gap as whitespace for no reason: it was the page container's
    top margin, left under the hidden header.

## 2026-10-31: The Conversation panel's overlay resizes, with one width

This widens the 2026-10-30 pinned-panel entry below, which put the separator on the pinned
panel's edge only.

- **Compared:**
  - a fixed overlay, or one that resizes from its right edge;
  - a width per mode, or one width both modes share;
  - 480px, as before, or 560px as the default.
- **Won:**
  - The overlay takes the pinned column's separator, by drag and arrow keys, held between
    256px and the window less 48px.
  - One width, saved as `conversationWidth`, which each mode holds to its own bound.
    Switching modes redraws it and never saves it.
  - 560px.
- **Why:**
  - The maintainer asked for the overlay to resize without pinning it.
  - A reader sizes the panel once, so both modes keep the size they set.
  - The overlay floats, so it only needs the strip of page that a click outside it uses.
  - The maintainer asked for a default a little wider than 480px, and 560px still fits the
    pinned column's bound of 588px on a 1600px window.

## 2026-10-31: The Conversation button and tree toggle hold their keycaps

This replaces the button forms in the 2026-10-30 keys-and-keycaps entry below. The keys,
`aria-keyshortcuts`, and tooltips stay as that entry picked them.

- **Compared:**
  - for both controls, Primer's small invisible Button, as before, or its small default
    Button, as GitHub draws "All commits" beside them;
  - for placing the tree keycap inside the toggle's padded border, a negative margin on
    the keycap, or CSS anchor positioning.
- **Won:**
  - Both are Primer's small default Button (`--button-default-*` tokens, medium radius,
    28px tall, Primer's focus ring). Each holds its icon, then its keycap.
  - GitHub's tree toggle stays the control, drawn as that Button through `side.css`, with
    inline-end padding for the keycap. Expanded, it takes the default Button's pressed
    fill, `--button-default-bgColor-active`, so expanded and collapsed still look
    different.
  - The keycap stays gh-prism's sibling `<kbd>`, anchored over that padding and taking no
    pointer. On touch screens, where the keycap is hidden, the toggle drops that padding.
- **Why:**
  - The maintainer asked, while checking the build by hand, for each control to read as
    one button holding its icon and keycap.
  - A negative margin depends on the toolbar's gap and on the row's order, both of which
    change when the sidebar docks right or the page is a commit's. An anchored keycap is
    out of the row's flow, so it sits in the same place in every layout.
  - The keycap takes no pointer, so a click on it reaches GitHub's toggle, and hover and
    active cover the whole button.

## 2026-10-30: `\` and Shift+\ for the file tree and the Conversation panel, with keycaps

- **Compared:**
  - for the keys, the maintainer's `\` for the file tree and Shift+\ for the Conversation
    panel, against no keys;
  - for the Conversation button, the 28px icon button as it was, with the key only in its
    tooltip, or Primer's small invisible Button holding the icon and then the keycap;
  - for the tree toggle's keycap, a child of GitHub's button, or gh-prism's own `<kbd>`
    beside it at the toolbar's 8px gap or 4px closer, in the button's colour or muted.
- **Won:**
  - `\` toggles the file tree and Shift+\ the Conversation panel, matched as `event.key`
    `"\"` without Shift and `"|"` with Shift held.
  - The Conversation button is Primer's small invisible Button: the icon, a 4px gap, then
    the keycap reading "⇧\", 28px tall like the toolbar's other controls. Its tooltip
    reads "Conversation (Shift+\)".
  - The tree toggle's keycap is gh-prism's own `<kbd>` after GitHub's toggle, 4px closer
    than the toolbar's gap, centred on the toggle, in `--fgColor-muted`, taking no
    pointer. Docked right, and on a commit's toolbar, it takes the toggle's place in the
    reordered row, so it still follows the toggle.
- **Why:**
  - The maintainer asked for these keys and keycaps at the hand check.
  - Both keys are free. Checked with gh-prism not loaded, signed in, on
    macintacos/gh-prism-sandbox's Files changed tab, a commit page, and the Conversation
    tab: neither key moved focus, opened a dialog, or fired a hotkey, and no `data-hotkey`
    holds `\` or `|`.
  - Shift+\ types `|` on US and UK layouts, so `event.key` is `|`, not `\`. Matching `|`
    with Shift held reads the key the reader pressed, and `\` without Shift keeps the two
    keys apart.
  - A child of GitHub's button would mutate what React renders. Beside it, the keycap
    survives React's re-renders and reads as the toggle's because it sits closer than the
    gap to the next control. Muted matches the toggle's icon, so the pair reads as one.
- **Known limits:** GitHub's tooltip on the tree toggle doesn't name the key, because
  gh-prism doesn't change GitHub's tooltips. Assistive technology hears it from
  `aria-keyshortcuts`. A live check confirmed the attribute stays on GitHub's toggle after
  four collapses and expands.

## 2026-10-30: The pinned Conversation panel moves the page with it

- **Compared:** for opening, closing, pinning, and unpinning the pinned panel, the page's
  view-transition cross-fade beside the panel's own slide; sliding the page's snapshot by
  the panel's width; or animating the page's padding alongside the panel's slide.
- **Won:** Animating the padding on `<html>` with the Web Animations API, on the panel's
  own timing: 280 ms on the Spatial row to open, pin, and unpin, and 160 ms `ease-out` to
  close. Under reduced motion the page takes its new place at once. This replaces the
  cross-fade in the pick below.
- **Why:**
  - The cross-fade moved the page at once while the panel slid, and drew GitHub's header,
    title, and diffs twice, half-faded, 480 px apart. The maintainer found it jarring.
  - A sliding snapshot can't show the page reflowing to its new width, so its far edge
    opens on an empty strip.
  - Animating the padding reflows the real page each frame, so nothing is drawn twice and
    the panel pushes the page aside and draws it back as one motion.

## 2026-10-30: The pinned Conversation panel's pin, edge, and motion

- **Compared:**
  - for the pin control, a menu item, or a header button before ✕;
  - for its state, a name that flips between "Pin" and "Unpin", or one name with
    `aria-pressed`;
  - for the pinned edge, the overlay's shadow, or a hairline;
  - for the resize handle, a new grip, or the commit message column's separator;
  - for pinning's motion, sliding the page by the panel's width, or a cross-fade with the
    panel held still.
- **Won:**
  - A header button between the title and ✕: the same small IconButton, in Primer's
    `invisible` variant, as the sidebar's side switch, with Octicons `pin`, named "Pin
    Conversation" in both states.
  - Pressed, the icon takes `--fgColor-accent`.
  - Pinned, the panel drops its shadow for a 1px `--borderColor-default` hairline on its
    right edge.
  - The commit message column's separator, shared from `ui/column-width.ts`, on the pinned
    panel's right edge only.
  - Pinning and unpinning cross-fade the page over 280 ms on
    `cubic-bezier(0.2, 0.7, 0.2, 1)`, the Spatial row in `tokens.md`, while the panel
    holds still. Under reduced motion the page takes its new place at once, with no fade.
- **Why:**
  - The pin is used often enough to sit in reach rather than in a menu, and the header
    already holds ✕.
  - The control is a toggle, so `aria-pressed` carries the state and its name stays put,
    as the Conversation button's does.
  - The accent colour shows the pressed state, since the name doesn't change.
  - Pinned, the panel is a column beside the page, not a surface above it. The hairline
    matches the commit message column's edge.
  - A second grip would teach a second way to resize a column.
  - A slide needs the panel's width before and after the toggle, but unpinning removes the
    width from the page. The cross-fade shows the page making room while the panel stays
    put, because moving the panel's iframe would reload the Conversation.

## 2026-10-30: The Conversation panel's overlay, button, loading, and failure

- **Compared:**
  - for the surface, a modal `<dialog>` like the code owner details dialog, or a fixed
    `<aside>` on the floating-surface form;
  - for the mark, the header's start, before the title, or its end, before ✕;
  - for loading, the spectrum's loading view, or a skeleton like the commit message's;
  - for the motion, a fade, or a slide from the left edge;
  - for the button's name, one that flips with the state, as a switch's does, or one name
    in both states;
  - for failure, a notice sentence, or Chrome's error page left in the frame.
- **Won:**
  - A fixed `<aside>` on `--bgColor-default` with `--shadow-floating-small`, under a
    header of the mark, "Conversation" in semibold, and ✕, ruled off by a hairline.
    `--overlay-bgColor` was tried and dropped: in dark mode it set the header a shade off
    the framed Conversation's own canvas, splitting the panel in two.
  - The mark at the header's start, its tooltip opening downward.
  - A skeleton of a title bar and three lines, which appears only if the frame hasn't
    loaded 150 ms later, then pulses. The frame fades in over 150 ms once it loads.
  - The panel slides in from the left on the Spatial row and back out on the State,
    closing row. Under reduced motion it appears and disappears in place.
  - On failure, one muted sentence: "The Conversation didn't load here. Open the
    Conversation tab." The second sentence is the link.
  - The toolbar button is the side switch's small invisible IconButton with Octicons
    `comment-discussion`, named "Conversation" in both states. Its tooltip opens
    rightward.
- **Why:**
  - A dialog can't become the pinned column, and re-creating its frame would reload the
    Conversation.
  - At the header's start, the mark's tooltip opens into the panel, never off its edge.
  - The spectrum's loading view counts progress gh-prism doesn't have here, and the
    skeleton matches the commit message's, the other wait on a rendered page.
  - A slide from the edge says where the panel lives, as the sidebar's overlay does
    mirrored.
  - The button is a disclosure, not a switch between views, so its `aria-expanded` carries
    the state and its name stays put.
  - Chrome's error page for a refused frame says nothing a reviewer can act on. The notice
    names what happened and links where the Conversation still loads.

## 2026-10-29: Header tooltips and the owner popup carry the mark; the column's moves up

This entry replaces the placement half of "The mark sweeps the spectrum, not the icon's
colours", below.

- **Compared:**
  - the header counter's tooltips and the code owner's files popup on the Conversation
    page without the mark, as the entry below ruled, or with it;
  - for the commit message column, its bottom-start corner or the start of its controls
    row.
- **Won:**
  - Both carry it: at the end of a pill tooltip's label row and of the total view's
    tooltip's last row, and just before the popup's filter action.
  - The commit column's mark sits at the start of its controls row.
- **Why:**
  - At the hand check, the maintainer flagged both the tooltips and the popup for missing
    the mark.
  - They wanted the column's mark at the top left, above the message's first line, instead
    of at the column's foot. The controls row's start is space the row already has.

## 2026-10-29: The mark is a faceted pyramid that pulses through the hues

This entry replaces the sweep recorded in the entry below it.

- **Compared:**
  - for the glyph:
    - the flat triangle and bars;
    - the faceted pyramid;
    - dispersion, a tinted prism splitting a beam into a fan of three bands;
    - a badge, the faceted pyramid and bars inside @pierre/trees' squircle tile.

    A literal three-quarter triangular prism was drawn and dropped before the mockup,
    because at 16px it read as a triangle beside a slab;
  - on hover: the bars alone cycling the hues, the whole mark cycling them, or the
    spectrum drifting along the bars.
- **Won:** the faceted pyramid, and the whole mark cycling.
- **Why:**
  - The flat triangle didn't read as a prism. The faceted pyramid reads as a solid at 16px
    in the two-tone style of @pierre/trees' icons. It keeps the toolbar icon's shape, so
    the toolbar icon needs no redraw.
  - The maintainer wanted the icon itself to pulse slowly while hovered, in place of a
    one-time sweep of its bars.

## 2026-10-29: The mark sweeps the spectrum, not the icon's colours

- **Compared:**
  - on hover, the toolbar icon's own blue, yellow, and pink bars, or the spectrum swept
    across them;
  - for each large surface, two slots: the nav's last row at its end or its start corner;
    the code owners popover's footer hint row at its end corner or before the hint; the
    code owner details dialog's footer start corner, with the footer always shown, or its
    header between the heading and ✕; the classic Files-changed dialog's footer start
    corner or its header between the heading and ✕; the commit message column's
    bottom-start or its bottom-end corner.
- **Won:**
  - the spectrum;
  - the nav's last row at the end corner, the popover footer row's end corner, the details
    dialog footer's start corner, the classic dialog footer's start corner, and the commit
    column's bottom-start corner.
- **Why:**
  - The spectrum ties the mark to gh-prism's existing signature and keeps one source of
    hues.
  - Each winning slot is space the surface already has, so the mark moves and wraps
    nothing.

## 2026-10-29: Show only a code owner's files

- **Compared:**
  - in the code owner's files popup, the action in the footer beside the hint, in a row
    under the count line, or no action;
  - in the details dialog, the action in a footer, in the header, or in each team block's
    heading row;
  - actions in the sidebar's file and folder popovers, or none;
  - a `<button>` or a link;
  - a soft navigation or a full page load;
  - the labels "Show only their files", "Review their files", and "Filter files".
- **Won:**
  - the popup's footer, beside the hint;
  - a dialog footer for the dialog's own code owner, plus each other team block's heading
    row;
  - no action in the sidebar's popovers;
  - a link that loads a new page on a plain click;
  - "Show only their files", flipping to "Show all files" once the page shows only theirs.
- **Why:**
  - The footer stays put while a long list scrolls.
  - A team block's heading already names the team the action filters to.
  - A folder popover names owners per file, so per-owner actions would crowd it, and its
    shield's click opens the dialog anyway.
  - A link opens in a new tab on Cmd-click.
  - The owner filter reads its owner once per page, so a soft navigation would not apply
    it.
  - "Only … files" is GitHub's own wording, from "Only files owned by you". The switch's
    flip makes the filter clearable where it was set.

## 2026-10-29: Older and Newer as GitHub's button group, keys inside the chevrons

- **Compared:**
  - for the order inside each link, the keycap last, "‹ Older ⇧J" and "Newer › ⇧K", or
    each keycap between its chevron and its label, "‹ ⇧J Older" and "Newer ⇧K ›";
  - for the form, Primer's small invisible Buttons, as before, or Primer's ButtonGroup:
    two default Buttons that share one border, as a pull request's commit view pairs its
    Prev and Next;
  - for a held-off link, one with nowhere to go, Primer's disabled Button, or the inactive
    Button that GitHub's own group shows for "No next commit";
  - for the keycap, GitHub's `kbd` rule as it is, or a fill that sets it apart from the
    button.
- **Won:**
  - The maintainer picked the order, the chevrons outermost with each keycap between its
    chevron and its label, and the form, Primer's ButtonGroup. The other picks follow from
    those two.
  - The group copies GitHub's own at its small size, built from GitHub's variables:
    - 28px tall, with 8px side padding and 4px gaps;
    - the `--button-default-*` fill, border colour, and resting shadow, and its hover and
      active fills;
    - one 1px border between the two links, with the medium radius on the group's outer
      corners only;
    - Primer's focus ring, 2px and inset by 2px, on each link;
    - each chevron in `--fgColor-muted`, as a Button's icon is.
  - A held-off link is Primer's disabled default Button: `--control-fgColor-disabled` for
    its label, chevron, and keycap text, on `--button-default-bgColor-disabled`, with a
    `not-allowed` cursor.
  - The keycap keeps GitHub's `kbd` rule unchanged.
  - The group leaves out Primer's `isolation: isolate`.
- **Why:**
  - The maintainer asked for native GitHub buttons. GitHub already pairs a pull request
    commit's Prev and Next in this group, so a reader knows the form. It replaces the
    invisible Buttons that the decision "Older and Newer on a commit's page" picked.
  - GitHub's group is small, 28px tall like the copy button in the row naming the commit's
    parents and SHA, so it fits that row unchanged.
  - The link sets `aria-disabled`, which Primer draws as its disabled Button. The
    `not-allowed` cursor tells a pointer the link goes nowhere, and the tooltip says why.
  - The keycap needs no fill of its own, because its edge already makes it read as a key.
    In a light theme, `--bgColor-muted` and `--button-default-bgColor-rest` are the same
    colour, so the keycap's edge and raised bottom draw it, at 1.2:1 against the button.
    On the page, before the button, its fill differed from the page by only 1.05:1, so its
    1.3:1 edge did the work there too. In a dark theme the keycap sits darker than the
    button, at 1.16:1, inside an edge at 1.3:1.
  - Primer isolates its group so a hovered or focused link's raised `z-index` stays inside
    it. But isolation also kept the tooltips inside the group's layer, so the header
    counter, the line counts below the row, painted over them. Without it, a focused link
    still rises above its neighbour, so its focus ring shows whole over the shared border.
- **Known limits:** A held-off link's text is 3.1:1 against its fill in a light theme and
  2.8:1 in a dark one, below the 4.5:1 text floor, as in every Primer disabled control.
  WCAG exempts text in an inactive control. The group's colours follow GitHub's variables,
  but its shape is a copy of Primer's ButtonGroup, so it won't follow a change to Primer's
  shape.

## 2026-10-29: Shift+J and Shift+K for Older and Newer, with keycaps at rest

- **Compared:**
  - for the keys, Shift+J for Older and Shift+K for Newer, or the reverse;
  - for where the key shows, in the tooltip alone, as every other control does, or as a
    keycap on the link at rest too;
  - for the keycap's text, "⇧J" or "Shift J"; and for the ⇧, the text glyph, set in the
    keycap's monospace or in GitHub's sans stack, or an Octicon;
  - for the keycap's look, Primer's KeybindingHint or GitHub's Markdown `<kbd>`, drawn by
    GitHub's own `kbd` rule or by a copy of it in gh-prism's sheet;
  - for where the keycap sits, last in each link, or between Newer's label and its
    chevron;
  - for how a tooltip names the key, in words, or with the glyph.
- **Won:**
  - Shift+J follows Older and Shift+K follows Newer, as a click does, so GitHub's router
    takes the step as a soft navigation.
  - Each link shows its key as a keycap at rest, last in the link: "‹ Older ⇧J" and "Newer
    › ⇧K".
  - The keycap is a `<kbd>` that GitHub's own `kbd` rule draws, the rule Markdown's
    `<kbd>` renders with. gh-prism sets only its colour, to the link's, and sets its ⇧ in
    GitHub's sans stack.
  - The tooltip names the key in words, "(Shift+J)", and only on a link that goes
    somewhere.
  - The keys do nothing in a text field, with Alt, Ctrl, or Meta held, on a held key's
    repeats, on a capital J or K typed without Shift, or on a held-off link.
- **Why:**
  - `j` moves down a list, and older commits sit lower in `git log` and in GitHub's
    commits list. gh-prism's own `j` steps down the sidebar too.
  - Bare `j` and `k` already step through files. GitHub binds `p` to the parent commit and
    `o` to a merge's other parent on this page. Checked on a live commit page with
    gh-prism off, GitHub binds neither Shift+J nor Shift+K, and the Refined GitHub browser
    extension doesn't either.
  - The maintainer asked for three things: keys a reader sees without hovering, the shift
    symbol instead of the word so the keycap stays compact, and the look of Markdown's
    `<kbd>`.
  - GitHub's `kbd` rule already styles every `<kbd>` on the page, Markdown's included, so
    a copy would repeat it and could drift from it. Taking the link's colour dims the
    keycap with a held-off link. At rest that colour matches the `kbd` rule's to within a
    shade.
  - GitHub's monospace stack has no ⇧, so the browser draws it from a fallback face at
    half the letter's height. GitHub's sans stack draws it at the letter's height, as
    GitHub's own keybinding hints do. Octicons has no shift icon.
  - Last in the link, one rule places both keycaps, and Newer's chevron stays beside its
    label. Inside the link, the keycap shares the link's target and its dim.
  - The tooltip's words spell out the ⇧ for a reader who doesn't know the glyph. A
    held-off link's key does nothing, so its tooltip doesn't offer it.
  - A capital J without Shift comes from Caps Lock, not from a reader asking to step, and
    a held key would race through history.
- **Known limits:** The keycap's look depends on GitHub's `kbd` rule. Without it, the key
  shows as plain monospace text. Its edge is below the 3:1 floor, which `exceptions.md`
  records.

## 2026-10-29: Older and Newer on a commit's page

- **Compared:**
  - for where they sit, the end of the commit card's row naming its parents and SHA, after
    GitHub's copy button; the page title's row, beside **Browse files**, as a pull
    request's commit pairs its Prev and Next with that button; or the diffs' toolbar;
  - for their form, Primer's small invisible Buttons with a chevron and a label, like the
    message's controls, or a bordered ButtonGroup reading "Prev" and "Next", like a pull
    request's commit;
  - for a link with nowhere to go, hiding it, or holding it in place, greyed out, with a
    reason;
  - for what Newer means, the next commit along the default branch's first parents; the
    commit GitHub's commits list shows just above this one; or the earliest commit with
    this one as a parent.
- **Won:**
  - Two links after the copy button: "Older", led by Octicons `chevron-left`, and "Newer",
    followed by `chevron-right`, styled as Primer's small invisible Button.
  - Each link is named "Older commit: <short SHA>" or "Newer commit: <short SHA>", and
    Primer's tooltip shows that name on hover and focus.
  - A link with nowhere to go keeps its place without an `href`. It is `aria-disabled`,
    still focusable, and its tooltip says why: the first commit, the newest on a named
    branch, or none found, which a failed read shows too. Newer reads "looking it up" in
    the same state while its read is out.
  - Newer is the earliest commit on the default branch with this one as a parent. When
    search finds none, it is the commit listed just above this one on the first branch
    GitHub names as holding it. After Older, Newer is the child the reader stepped back
    from.
- **Why:**
  - The links first read "Previous" and "Next", which left unclear which way in time each
    goes. "Older" and "Newer" name the direction.
  - The row names the parent Older goes to and the SHA both links step from. It shows
    whether the message is in the column, above the diffs, hidden, or in GitHub's box, so
    the links never move with the message's controls. The title's row sits apart from the
    parent it would go to, and the diffs' toolbar would need a new GitHub selector.
  - The row's own copy button is an invisible IconButton, so invisible Buttons sit level
    with it, as the message's labelled controls do. A bordered group would outweigh the
    row's muted text.
  - A link that appears or vanishes as Newer resolves moves the row, and the maintainer
    dislikes controls appearing and disappearing. Held in place, it keeps the row still
    and says why it goes nowhere. It stays focusable, as Primer's inactive buttons do, so
    a keyboard reaches the reason.
  - No commit records its children, and github.com offers no walk along first parents
    short of paging through a branch's history. Commit search finds a commit's children on
    the default branch in one request, and the earliest is the commit made next on top of
    this one.
  - Measured on cli/cli, which merges pull requests with merge commits, the commits list
    interleaves pull request branch commits, so the commit above this one is often not a
    child. It serves only where search finds nothing: off the default branch, where a
    branch's history is mostly a line, and at the default branch's newest commits.
  - A commit can have several children: cli/cli@9eb4db2 is the parent of both a pull
    request's commit and the merge that took it in. No single Newer undoes every Older, so
    the tab remembers the child the reader came from.
- **Known limits:** The commits list stands in for search only on its newest page, so
  Newer finds none for a commit past a branch's newest 35 when search doesn't cover it:
  off the default branch, or on it before search indexes a push.

## 2026-10-29: Labelled controls for a commit's message

- **Compared:**
  - for the view switch and the hide control, Primer's small invisible IconButtons, as
    before, or small invisible Buttons with a label, with or without an icon;
  - for the switch's label in the plaintext view, "Show rendered Markdown", "Render
    Markdown", or "Show Markdown";
  - for where the controls sit, a strip of their own down the message's side, as before; a
    row of their own above the title; or floated beside the title's first line;
  - for the column's inset, GitHub's box's 8px 12px, as before, or the 24px that GitHub's
    tree pane and diffs inset their content by.
- **Won:** small invisible Buttons with an icon and a label, in the form of the "Show
  commit message" button that brings a hidden message back. The switch reads "Show plain
  text" or "Show Markdown". The hide button reads "Hide" and keeps its `aria-label`, "Hide
  commit message". Neither has a tooltip. In the column, the controls take a 32px row of
  their own above the title, and the message is inset 24px on every side. Above the diffs,
  they float beside the title's first line, and the message keeps GitHub's box's 8px 12px.
- **Why:**
  - Icons alone left a reader guessing what each control does. A label says it, so a
    tooltip would only repeat it.
  - At rest, an invisible button with a label alone reads as text. The icon marks it as a
    control, as it does on the "Show commit message" button.
  - "Show rendered Markdown" doesn't fit beside "Hide" in the column's 256px minimum
    width, less its 24px insets. "Render Markdown" fits with 1px to spare. "Show Markdown"
    fits with 10px, and keeps both of the switch's labels starting with "Show".
  - Controls beside the whole message held an empty strip down its side, and labels would
    have widened the strip.
  - In the column, a float beside the title leaves room for a word or two at most, so the
    title would break after its first word. A row of its own reads as the column's
    toolbar, level with the search field over the diffs and the filter field over the file
    tree. Above the diffs, the title has room beside the controls, and a row of their own
    would add an empty line to GitHub's card.
  - Measured at 1280px and 1440px, GitHub's tree pane and diffs both inset their content
    24px. The column takes the same inset, so its text sits as far from the divider as the
    diffs do on the other side. Above the diffs, the message stays lined up with GitHub's
    card, whose rows inset 12px.

## 2026-10-29: Hiding a commit's message

- **Compared:**
  - for the hide control, Octicons `x`, `sidebar-collapse`, or `eye-closed`, beside the
    view switch;
  - for the way back, an icon button at the start of the diffs' toolbar, a thin rail where
    the column stood, or a labelled button in GitHub's box's place in the commit's card;
  - for the hidden state, `session:` storage, or a capped list in `local:` storage;
  - keying a commit by its route's SHA alone, or matching a full SHA against an
    abbreviated one.
- **Won:** an `eye-closed` icon button labelled "Hide commit message" beside the view
  switch; Primer's small invisible Button with `eye` and "Show commit message" in the
  box's place, in both layouts, with focus moving between the two;
  `local:hiddenCommitMessages`, the newest 100 commits, keyed `owner/repo@sha` and matched
  by SHA prefix; no motion.
- **Why:** `x` reads as dismissing for good, and `sidebar-collapse` names a panel, which
  the message isn't above the diffs; an eye says hidden and shown. The box's place is
  where GitHub shows a commit's message, so a reader looking for it looks there, in either
  layout, and it needs no new GitHub selector, as a toolbar button would; a labelled
  button is easier to find than an icon, and a rail would keep taking the diffs' room.
  `session:` storage needs the background script to open it to content scripts first, and
  loses a pick when the browser restarts; 100 keys stay a few kilobytes. GitHub links a
  commit by its full SHA, but a reader can type an abbreviated one, so either finds the
  other. Hiding is a reader's tidy-up, so the message just goes, as GitHub's file tree
  does when collapsed.

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
  look and feel: a visible 5px grip centred on the 1px border, in a 24px target reaching
  outward over the next pane's padding, `col-resize`, a `--bgColor-neutral-muted` wash
  fading in over 150 ms `ease-out` on hover and while dragged, and arrow keys at 3px; the
  width in `local:commitColumnWidth`, 320px until set; held between Primer's 256px pane
  minimum and the window's width past GitHub's 1012px docked layout; above the diffs below
  1268px.
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
- **Floor gap:** The column misses WCAG 2.2's 2.5.7, Dragging Movements, which asks for a
  single-pointer way (a click or tap) to do anything dragging does. Arrow keys don't count
  toward it, because they are keyboard input, not a pointer. The maintainer chose on
  2026-10-29 to leave the gap open: GitHub's own file-tree divider beside the column has
  no such path either, and a click that stepped or reset the width would behave unlike
  that divider. Close it if GitHub's divider gains such a path, or if a user reports
  needing one.

## 2026-10-29: A commit's message, loaded in place

- **Compared:**
  - mounting the message at idle, after GitHub's box has shown, as before;
  - hiding GitHub's box from `document_start` with a sheet keyed on its body, before the
    visit starts;
  - holding the message's place from the visit's start, with GitHub's box's plain text
    copied in, or with a skeleton;
  - rendering at the visit's start, or still after the sections and idle;
  - on a failed render, collapsing the column with motion, or at once.
- **Won:** the place held from the visit's start with a skeleton: a title bar and a line
  for each of the body's lines, up to three, held back 150 ms, pulsing as the loading
  view's skeletons do; GitHub's box hidden from the same frame; the render still after the
  sections and idle, fading in on the spatial row; a message past the length or parse-cost
  caps never held at all, and a failed render unmounting at once, back to GitHub's box.
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
