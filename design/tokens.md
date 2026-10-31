# gh-prism design tokens

*Audience: coding agents changing how gh-prism looks, moves, or reads, and the people who
maintain its design direction.*

Tokens live in the code. This file points at each source instead of copying its values, so
it can't drift from them. A value the code doesn't have yet, such as the
[motion scale](#motion), lives here until it lands.

## Colour

Every colour gh-prism paints is a Primer variable, such as `--fgColor-muted`, that
GitHub's page defines for the reviewer's theme. gh-prism defines no colour of its own. The
one exception is the file icons, which keep the palette of `@pierre/trees`, the library
that draws each section's file tree. `sidebar/section-tree.css` makes that palette follow
GitHub's theme and colours the icons it adds.

[`entrypoints/content/ui/tailwind.css`](../entrypoints/content/ui/tailwind.css) maps the
Primer variables gh-prism uses to `tw:` utilities, so Primer's `--fgColor-muted` becomes
`tw:text-fg-muted`. A Primer variable used in one rule stays a `var()` there until a
second rule uses it.

Each section's hue is the Primer foreground variable in its row of `SECTION_CATALOG`, in
[`entrypoints/content/ui/section-catalog.ts`](../entrypoints/content/ui/section-catalog.ts).
`markSection` sets it on an element as `--gh-prism-hue`, and every colour tied to a
section reads that property.

A section's tint mixes its hue into `--bgColor-default`. Its strength, `--gh-prism-tint`
in
[`entrypoints/content/sidebar/sections-view.css`](../entrypoints/content/sidebar/sections-view.css),
colours the backgrounds of sections and of the what's-new block of release notes. The
header counter paints no tint. Its pills' icons rest in `--fgColor-muted`, and
`--borderColor-default` hairlines rule the pills apart, in `header/diffstat-view.css`.

The Viewed box's edge and hover colours are in `sidebar/sections-view.css` too. They are
mixed so the box holds 3:1 against every row background.

The spectrum is `SECTION_SPECTRUM` in `ui/section-catalog.ts`: a left-to-right band of
every section's hue, in section order.

## Section edge

A section's hairline is `--color-hue-edge` in `ui/tailwind.css`, applied as
`tw:border-hue-edge`. It mixes the section's hue into a ground darker than the section's
fill: `--borderColor-default` in a light theme, and `--bgColor-inset` in a dark one. In a
dark theme the line sits below the tint, so it edges the section without brightening it.
The section also takes Primer's resting shadow, `--shadow-resting-small`. The what's-new
block takes the same edge and shadow.

Unlike every other Primer colour here, the edge picks a different Primer variable per
theme, with `light-dark()`. That follows GitHub's theme, not the OS, because GitHub sets
`color-scheme` on the page; `sidebar/section-tree.css` relies on the same fact when it
inherits `color-scheme`. `light-dark()` is also why `build.cssTarget` in `wxt.config.ts`
is Chrome 123: under an older target, the build rewrites it into a fallback that ignores
GitHub's theme.

## Type

Prose and labels use GitHub's sans stack, which they inherit from the page. File names in
the sidebar use `--fontStack-monospace` at `--text-body-size-small`, the face and size
GitHub sets diff code in, so a name reads the same in the sidebar and in its diff header.
Counts, markers, and status letters in a row use `--fontStack-sansSerif`, with tabular
figures so columns of counts line up.

Sizes, line heights, and weights are the `--text-body-*`, `--leading-body-*`, and
`--font-weight-*` tokens in `ui/tailwind.css`, and the monospace face is its `--font-mono`
(`tw:font-mono`).

## Radius

Sections and the controls inside them share Primer's medium radius,
`--borderRadius-medium`, which GitHub's file cards beside the sidebar use too. The
sidebar's file-row decorations, such as the `Partial` pill, and section counters use
`2em`, so they stay fully round. The Viewed box and the loading bar keep small fixed radii
of their own, in `sidebar/section-tree.css` and `ui/loading-view.ts`, because they are too
small for the medium radius. The skeleton lines in `diffs/order.css` and
`sidebar/sections-view.css` take a fixed radius of half their height, so they stay round
too. `exceptions.md` says why sections don't step up to a larger radius.

## Spacing

Space follows the 4px scale that `--spacing` sets in `ui/tailwind.css`, so `tw:gap-1.5` is
6px. A height a module fixes stays in that module: a file row's is `ROW_HEIGHT` in
`sidebar/section-tree.ts`, and a section header's is `tw:h-9` in
`sidebar/sections-view.ts`.

## Motion

Motion has no token source yet, so this table is the source until the scale lands in
`ui/tailwind.css`. Pick the row by what the motion does:

| Row | Duration and curve | Use |
| --- | --- | --- |
| Feedback | 120–150 ms, `ease-out` | hover, tooltips, icon swaps, the Viewed box filling |
| State, opening | 240 ms, `cubic-bezier(0.16, 1, 0.3, 1)` | a section or block expanding, its chevron turning open, a popover opening |
| State, closing | 160 ms, `ease-out` | a section or block collapsing, its chevron turning closed, a dismissal |
| Spatial | 280 ms, `cubic-bezier(0.2, 0.7, 0.2, 1)` | the sidebar's slide, sections dropping in after loading, the Conversation panel opening and pinning with the page moving beside it |
| Reveal | 500 ms wait, then a 150 ms `ease-out` fade-in; 1,000 ms holds at each end, legs at 60 px/s on `ease-in-out` | a truncated name on hover and focus (`ui/reveal.css`, `ui/reveal.ts`) |
| Pulse | a slow loop, not a state change: hues 8 s per cycle, 2 s per hue on `ease-in-out`; breathing between 100% and 70% opacity, 2.4 s each way on `ease-in-out` | a hovered mark (`ui/mark.css`) |

Under `prefers-reduced-motion: reduce`, every row drops to no motion. A stopped spinner
keeps its open ring, so it still reads as working. A revealed name keeps its 500 ms wait,
which isn't motion, and scrolls by hand. A hovered mark shows a still `--fgColor-accent`
copy. `decisions.md` says why a close runs quicker than an open.

The closing row also sets the timer in `sidebar/whats-new.ts` that removes a dismissed
what's-new block, so a change to that row's duration changes the timer too.

Two motions in `sidebar/section-tree.css` predate this scale: the Viewed box's check pops
in on an overshoot curve, and the on-screen hairlines fade over 250 ms `ease-in-out`. Move
each to its row when that code next changes.

The classic-page dialog's entrance stays as it is, because it copies Primer's own dialog
entrance.
