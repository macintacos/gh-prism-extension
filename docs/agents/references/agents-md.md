# Editing `AGENTS.md`

*Audience: coding agents and contributors editing gh-prism's agent router.*

[`AGENTS.md`](../../../AGENTS.md) is the code-change router. Its digraph has one edge per
rule file, labeled with the paths and concepts that file governs, and it says how to
verify a change. [`CLAUDE.md`](../../../CLAUDE.md) holds only an `@AGENTS.md` import, so
Claude Code loads the router too. Never add content to `CLAUDE.md`.

When to edit it:

- A rule file is added, renamed, or removed. Add, rename, or remove its edge.
- A rule file starts or stops governing a path. Update its edge's label.
- The verify commands change.

Keep it a checklist of edges. Rule bodies go in the rule files, never here.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
