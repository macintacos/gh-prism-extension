# Editing `docs/STRUCTURAL-DIFFS.md`

*Audience: coding agents and contributors editing gh-prism's structural diff explainer.*

[`docs/STRUCTURAL-DIFFS.md`](../../STRUCTURAL-DIFFS.md) is a short, human-facing post on
what a structural diff is, the tools that inspired Structural mode, how gh-prism draws it
with tree-sitter, and where to see it on the sandbox showcase pull requests.

When to edit it:

- Structural mode's behaviour changes: what it highlights, tints, or leaves alone.
- The covered languages change in a way the doc's own wording names. The language list
  itself lives in `README.md` § Structural diffs (Beta), which the doc links.
- The sandbox showcase pull requests move or are replaced.

Maintenance: shipped builds link to `docs/STRUCTURAL-DIFFS.md` on `main`, with its H1,
"What's a structural diff?", as the link text, so never rename or move the file. Adding,
removing, or renaming this pointer follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
