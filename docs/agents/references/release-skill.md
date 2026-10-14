# Editing the release skill

*Audience: coding agents and contributors editing gh-prism's `/release-gh-prism` skill.*

[`.claude/skills/release-gh-prism/SKILL.md`](../../../.claude/skills/release-gh-prism/SKILL.md)
drives a release: it reads `compute`, writes the notes, asks the operator once, dispatches
`mise run release`, follows the run, and reports the GitHub Release.

When to edit it:

- `compute`'s JSON, or `release`'s arguments, in `scripts/tasks/cli.ts` change.
- `.github/workflows/release.yml` changes its steps or inputs, which moves the line
  between a failure with no side effects and one after the push.
- The release-notes rules change.

Keep the skill short, keep the single confirmation, and keep the CLI as the only source of
the version.

Maintenance: the skill is a node on the documentation map. Adding, removing, or renaming
it, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
