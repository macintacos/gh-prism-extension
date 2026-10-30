# Editing `README.md`

*Audience: coding agents and contributors editing gh-prism's README.*

[`README.md`](../../../README.md) is the user-facing front door: what gh-prism does, how
to install it, what it may access, and how to fix common problems. It stays short and
points contributors to [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) and
[`docs/`](../../README.md).

When to edit it:

- A feature a user sees is added, removed, or changes behavior.
- The install steps change.
- gh-prism gains or drops a host permission. Update § Permissions.
- gh-prism stores a new kind of data. Update § Permissions.
- A common failure gains a known fix.
- A surface the README pictures changes how it looks.\
  Recapture both its light and dark screenshots in the same change.

Each pictured surface has a pair in `docs/images/`, `<surface>-light.png` and
`<surface>-dark.png`, with the same crop and size. Capture them in GitHub's default Light
and Dark themes, cropped below GitHub's global header, and compress them losslessly with
`oxipng -o max --strip safe`. Section shots come from gh-prism-sandbox, and code-owner
shots from gh-prism-codeowners-sandbox.

Keep contributor detail out of it. Setup and tasks belong in `CONTRIBUTING.md` and
`docs/DEVELOPMENT.md`.

Maintenance: `README.md` is a node on the documentation map. Adding, removing, or renaming
it, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
