# Styling Rules

*Audience: coding agents changing gh-prism's styles, and the people who maintain these
rules.*

These rules govern every sheet under `entrypoints/content/` (`**/*.css`), the shared token
sheet [`entrypoints/content/ui/tailwind.css`](../../entrypoints/content/ui/tailwind.css),
and any TypeScript that imports a sheet or writes `tw:` classes. Rules about the GitHub
markup a sheet targets are in [`github-rules.md`](github-rules.md).

## Utilities

- **Style new UI with Tailwind CSS v4 utilities carrying the `tw:` prefix.** The prefix
  keeps gh-prism's classes from colliding with GitHub's.
- **Write each class string whole and literal, beside the element's `gh-prism-*` name.**
  Tailwind finds classes by scanning source text, so a class built from pieces never gets
  generated.
- **Take colors, radii, and type from the Primer tokens in `ui/tailwind.css`, and space on
  the 4px scale.** The tokens follow GitHub's theme, so no element needs a `dark:`
  variant.
- **Never put a shorthand utility beside one of its longhands on one element**
  (`tw:p-0 tw:px-2`). One sheet orders a shorthand before its longhands, but every sheet
  carries its own copy, and a later-mounted sheet's shorthand beats an earlier sheet's
  longhand.

## Sheets

- **Put each feature's sheet beside its module, opening with an `@import` of
  `ui/tailwind.css` with `prefix(tw)`.** Each sheet carries its own copy of the utilities
  it uses.
- **Put a partial that several features' sheets share in `ui/` beside its module, as plain
  CSS with no Tailwind import of its own, and `@import` it right after `ui/tailwind.css`
  in each sheet.** [`ui/reveal.css`](../../entrypoints/content/ui/reveal.css) is the
  model: its selectors start at `:host` or `.gh-prism-sections`, so they match in a shadow
  root and only gh-prism's own markup in the light DOM.
- **Give a builder that several features mount no `tw:` classes, and keep all its styling
  in its `ui/` partial, so no host sheet `@source`s it.**
  [`ui/mark.ts`](../../entrypoints/content/ui/mark.ts) is the model. A host places it with
  a hand-written rule more specific than the partial's, such as
  `.gh-prism-commit-column > .gh-prism-mark`, never a utility: utilities are unlayered
  single classes, and the partial is imported after them, so its base rules win a tie.
- **`@source` every module whose classes land on elements the sheet styles.** Tailwind
  generates only the classes it finds in those sources. A module whose classes land in
  other sheets has no sheet of its own, so every caller's sheet `@source`s it:
  [`ui/line-counts.ts`](../../entrypoints/content/ui/line-counts.ts) is `@source`d by both
  `header/diffstat-view.css` and `sidebar/sections-view.css`.
- **Import a sheet with `?inline`, never a plain import, and say why in a comment on the
  import.** A plain import ships the sheet in the manifest, where it styles every
  github.com page. The `?inline` string mounts where its feature lives: the head sheets as
  a `<style>` removed on abort, the loading view's inside its root, and the section tree's
  in its shadow root.
- **Keep rules that target GitHub's markup, keyframes, pseudo-elements, and parent-driven
  states as plain CSS in the sheet, and list each GitHub selector in the sheet's
  `GitHub hooks:` header.** Utilities can't express these, and the header is where an
  agent finds every place GitHub's markup can break the sheet.
- **Expect utilities to be unlayered, with no preflight.**
  [`ui/tailwind.css`](../../entrypoints/content/ui/tailwind.css) imports
  `tailwindcss/utilities.css` alone, so utilities meet GitHub's unlayered rules on
  specificity and nothing resets GitHub's page.
- **Raise `build.cssTarget` in [`wxt.config.ts`](../../wxt.config.ts) rather than let the
  build rewrite a CSS feature.** The build's CSS minifier, Lightning CSS, rewrites any
  feature that target lacks and can emulate. Its rewrite of `light-dark()` reads only a
  `color-scheme` set in gh-prism's own sheets, never GitHub's, so the section edge would
  lose its theme. After using a feature newer than the target, check the built sheet in
  `.output/chrome-mv3/`.
- **Set a scroll-driven animation through its longhands, never the `animation`
  shorthand.** Lightning CSS folds an `animation-timeline` written after the shorthand
  into it, and Chrome drops a shorthand that sets a timeline, so the animation never runs.
  It leaves longhands apart.

## Overrides

- **Override a utility with a hand-written rule only by higher specificity, never by
  coming later.** Sheets mount in feature order and each carries its own utilities, so a
  later sheet's copy of a utility can outrank an earlier hand-written rule.
- **Keep a declaration that a `@media`, `@container`, or reduced-motion block overrides as
  CSS on its base rule.** As a utility it could outrank the override.
- **Put no display utility on a `<dialog>` or on an element the `hidden` attribute
  toggles.** Their `display: none` comes from the user-agent sheet, which any author rule
  beats, so `tw:flex` on a closed dialog shows it.
- **In the section tree's shadow root, use no utility that reads a `--tw-*` variable.**
  Shadow roots ignore `@property`, so those variables have no initial value. That rules
  out border, outline, shadow, ring, transform, gradient, leading, font-weight, and
  tabular-nums utilities there.
- **Keep `:host { color-scheme: inherit; }` in the section tree's sheet.** @pierre/trees
  sets `color-scheme: light dark` on its host, so without the override the library's
  `light-dark()` palette, which colors the file icons, follows the OS instead of GitHub's
  theme. The file icons keep that palette rather than Primer tokens.

## Testing styles

Vitest stubs every CSS import unless the sheet is opted in; see
[`testing-rules.md`](testing-rules.md#vitest-and-happy-dom).
