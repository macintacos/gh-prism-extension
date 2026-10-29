# gh-prism design brief

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

## The direction

gh-prism is a guest in GitHub's page, so it looks native to Primer, GitHub's design
system. It has an identity of its own in two places only: the five section hues, and the
spectrum, a band of all five hues that marks gh-prism announcing itself. Everything else
follows the GitHub page around it, in light and dark.

gh-prism stays out of the reviewer's way. The sidebar is quiet at rest, left-aligned, and
dense without feeling cramped. Detail such as a chevron, a tooltip, or a key appears on
hover and focus, so a reviewer who never looks for it never sees it.

## Principles

- **Take every colour, face, size, and radius from Primer.** GitHub themes Primer's
  variables, so an element built from them follows the reviewer's theme with no variant of
  its own. The file icons are the one exception, in `tokens.md` § Colour.
- **Spend colour on three things only: sections, file types, and lines added or removed.**
  A file type's colour is its icon's, such as Rust's or npm's. Git status colours stay off
  file names and icons, because a coloured name would read as one of the three.
- **Dim a Viewed file within the text floors; never hide it.** A reviewer returns to
  Viewed files, and a hidden row would change the list they are scanning. The ticked box
  marks Viewed too, so the dimming is never the only signal.
- **Keep controls quiet at rest, and show their detail on hover and focus.** A section's
  icon gives way to its chevron, and a control's tooltip names its action and key. Focus
  shows the same detail as hover, so a keyboard user gets it too.
- **Move only to confirm an action or show a state change.** Keep motion brief, never
  block input on it, and let a frequent action such as stepping through files with `j`
  land without a flourish. The one exception: a truncated name in the sidebar scrolls back
  and forth after a short hold of hover or focus (`tokens.md` § Motion), until the pointer
  or focus leaves.
- **Show the key a control takes in its tooltip, and never take a key GitHub binds on the
  page.** GitHub binds `?` to its shortcut list and `/` to search. gh-prism binds `j` and
  `k` to step through files in the sidebar's order.
- **Play no sound.** gh-prism runs inside github.com, where a sound would surprise the
  reviewer, and it has no settings surface to turn one off.
- **Say an empty or degraded state in one plain sentence, with no illustration and no
  icon.** The sidebar's "Grouped by path" notices are the model.
- **Hold a loading view back 150 ms, then show the spectrum with a label and a count.** A
  cached answer lands within 150 ms, so it never flashes a loading view, unless the owner
  filter is still waiting on the code owners.

## Floors

These floors hold for every change, and no design choice trades them away:

- Text holds 4.5:1 contrast against its background, and body text holds 7:1. Only large
  text and non-text UI, such as icons, hairlines, and the Viewed box, drop to 3:1.
- Colour is never the only signal.
- Targets are at least 24px, and focus is always visible.
- Under reduced motion, nothing moves on its own. An effect that only follows the
  reviewer's scroll, such as the what's-new notes' fade, isn't motion and stays.
- Text survives resizing to 200%.
- Check against the Web Content Accessibility Guidelines (WCAG) 2.2, with APCA (the
  contrast model proposed for WCAG 3) as an advisory second read.
