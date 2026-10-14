# Editing `docs/ARCHITECTURE.md`

*Audience: coding agents and contributors editing gh-prism's architecture guide.*

[`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) describes how gh-prism works now, and
names the module behind each structural claim so a reader can check it. Its diagrams are
mermaid.

When to edit it:

- A module it names is renamed, moved, or removed.
- A new top-level directory appears.
- A flow it describes changes, such as the visit lifecycle, how intent is read and cached,
  or how the diffs are reordered.

Describe the current structure, not how it got there. History belongs in git.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
