# Editing `docs/DEVELOPMENT.md`

*Audience: coding agents and contributors editing gh-prism's development guide.*

[`docs/DEVELOPMENT.md`](../../DEVELOPMENT.md) covers developing gh-prism past the first
run: the dev browser, the task catalog, tests, the benchmark, the sandbox repositories,
git hooks, CI, and patched dependencies.

When to edit it:

- A task under `.mise/tasks/` is added, renamed, removed, or takes new arguments. Update
  the task catalog; if it is `dev`, `preflight`, `test`, or `e2e`, also update `AGENTS.md`
  § Verifying changes and `CONTRIBUTING.md` § Everyday tasks.
- A git hook or CI workflow changes.
- A dependency patch is added or dropped.
- A setup step changes. Update [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) in the same
  change.

Maintenance: `docs/DEVELOPMENT.md` is a node on the documentation map. Adding, removing,
or renaming it, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
