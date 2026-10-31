# gh-prism design decisions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each entry records one design pick: what was compared, what won, and why. Add new entries
at the top, dated.

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
