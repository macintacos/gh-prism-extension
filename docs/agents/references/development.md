# Editing `docs/DEVELOPMENT.md`

*Audience: coding agents and contributors editing gh-prism's development guide.*

[`docs/DEVELOPMENT.md`](../../DEVELOPMENT.md) covers developing gh-prism past the first
run: the dev browser, the task catalog, tests, the benchmark, the sandbox repository, git
hooks, CI, and patched dependencies.

When to edit it:

- A task under `.mise/tasks/` is added, renamed, removed, or takes new arguments. Update
  the task catalog.
- A git hook or CI workflow changes.
- A dependency patch is added or dropped.
- A setup step changes. Update [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) in the same
  change.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
