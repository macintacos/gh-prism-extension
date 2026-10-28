# gh-prism design decisions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each entry records one design pick: what was compared, what won, and why. Add new entries
at the top, dated.

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
  so the hidden team gets a plain sentence, as `brief.md` asks of a degraded state.

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
