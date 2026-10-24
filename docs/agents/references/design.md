# Editing `design/`

*Audience: coding agents and contributors editing gh-prism's design direction.*

[`design/`](../../../design/README.md) holds gh-prism's design direction. Its entry file,
`design/README.md`, routes to `brief.md`, `tokens.md`, `patterns.md`, `exceptions.md`, and
`decisions.md`, and its § Updating design/ says what goes in each.

When to edit it:

- A design pick is made, through `/taste mockup`, a review, or a change that settles how
  something looks. Record it in `decisions.md`, and update the file the pick changes.
- A token that `tokens.md` names is added, renamed, or moved, or a module that
  `patterns.md` names is renamed.
- A change departs from the `/taste` defaults on purpose. Add it to `exceptions.md`.

Keep `tokens.md` a set of pointers into the code, because a value copied there drifts from
its source.

Maintenance: `design/` is a node on the documentation map. Adding, removing, or renaming
it, a file in it, or this pointer follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
