# gh-prism design exceptions

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

The `/taste` skill starts every repo from the same defaults, the maintainer's design taste
across projects. gh-prism departs from those defaults on purpose in the places below. Each
entry names the default it replaces and why, so `/taste review` and a human reviewer read
the departure as intended.

- **Palette: Primer's, not a palette of gh-prism's own.** The default is a palette with
  near-black and warm-light grounds. gh-prism paints inside GitHub's page, where grounds
  of its own would clash with the page around them, and Primer's variables already follow
  the reviewer's theme.
- **Faces: GitHub's font stacks, not Berkeley Mono for code.** Reviewers don't have
  Berkeley Mono installed. A file name in the sidebar should also match its diff header,
  which GitHub sets in its own monospace stack.
- **Radius: one medium radius for sections and their controls, not a 12px, 6px, and 3px
  hierarchy.** A 12px section looked too round beside GitHub's file cards, which use the
  same medium radius.
- **Motion: a 240 ms decelerating open and a 160 ms close, not 240 ms `ease-out` both
  ways.** Reviewers fold sections often, and a close as slow as the open reads as lag.
- **Motion: a truncated name's reveal loops, not a brief motion.** The default keeps
  motion brief and never animates a repeated action. The scroll runs only while the
  reviewer holds a row on hover or focus, which they do to read it.
- **Key hints: in the tooltip, not on the control.** The default puts a keycap on every
  control. GitHub shows its own shortcuts in tooltips, and keycaps at rest would make the
  sidebar louder than the page around it.
- **Keys: no `?` help and no `/` search.** The default binds both. On this page, GitHub
  binds `?` to its shortcut list and `/` to search, and gh-prism takes no key GitHub
  binds.
- **Sound: none, not on by default.** gh-prism runs inside github.com, where a sound would
  surprise the reviewer, and it has no settings surface to turn one off. Revisit this if
  gh-prism gains an options page.
- **Section edge: a different Primer variable per theme.** Every other colour gh-prism
  paints, except the file icons, is one Primer variable that GitHub themes. The edge needs
  a darker ground in a dark theme, because the border variable it mixes into in a light
  theme would brighten the section. `tokens.md` § Section edge has the recipe.
