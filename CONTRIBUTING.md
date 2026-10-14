# Contributing

## Development

Contributors start with these commands:

- `mise install && mise run setup` installs the pinned tools and dependencies and
  registers the git hooks.
- `mise run dev` builds and opens gh-prism in its own Chrome profile at
  `~/.local/share/gh-prism-extension/chrome-profile`. Only one dev session can run at a
  time.
- `mise tasks` lists the rest.
- `scripts/create-sandbox.sh <owner>/<repo>` uses the `gh` CLI to create a private
  repository under an account you control, with three test pull requests.

## Styling

New UI is styled with Tailwind CSS v4 utilities carrying the `tw:` prefix, written as
whole literal class strings beside the element's `gh-prism-*` name. Colours, radii and
type come from Primer through the tokens in `entrypoints/content/ui/tailwind.css`, so
themes follow GitHub with no `dark:` variant; spacing is a 4px scale.

Each feature's sheet sits beside its module and opens with an `@import` of
`ui/tailwind.css` with `prefix(tw)` and an `@source` for every module whose classes land
on elements it styles. It reaches the page by an `?inline` import, never a plain import:
the head sheets mount as a `<style>` removed on abort, the loading view's travels inside
its root, and the section tree's goes to its shadow root. Rules that target GitHub's
markup, keyframes, pseudo-elements and parent-driven states stay plain CSS in that sheet,
listed in its `GitHub hooks:` header. Utilities are unlayered and there is no preflight.

Each sheet carries its own copy of the utilities it uses, and sheets mount in feature
order, so a hand-written rule overrides a utility only by higher specificity, never by
coming later. A declaration a `@media`, `@container` or reduced-motion block overrides
stays CSS on its base rule, and no element carries a shorthand utility beside one of its
longhands (`tw:p-0 tw:px-2`). In the section tree's shadow root, where `@property` is
ignored, no utility may read a `--tw-*` variable: border, outline, shadow, ring,
transform, gradient, leading, font-weight and tabular-nums.
