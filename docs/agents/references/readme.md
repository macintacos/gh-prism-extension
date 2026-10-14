# Editing `README.md`

*Audience: coding agents and contributors editing gh-prism's README.*

[`README.md`](../../../README.md) is the user-facing front door: what gh-prism does, how
to install it, what it may access, and how to fix common problems. It stays short and
points contributors to [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) and
[`docs/`](../../README.md).

When to edit it:

- A feature a user sees is added, removed, or changes behavior.
- The install steps change.
- gh-prism gains or drops a host permission, or stores something new. Update § Permissions
  and [`typescript-rules.md`](../typescript-rules.md) § Persisted state together.
- A common failure gains a known fix.

Keep contributor detail out of it. Setup and tasks belong in `CONTRIBUTING.md` and
`docs/DEVELOPMENT.md`.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
