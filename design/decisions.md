# gh-prism design decisions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Each entry records one design pick: what was compared, what won, and why. Add new entries
at the top, dated.

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
