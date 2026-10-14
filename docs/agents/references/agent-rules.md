# Adding or editing a `docs/agents/*-rules.md` rule file

*Audience: coding agents and contributors adding or editing a rule file.*

`docs/agents/*-rules.md` holds gh-prism's rules, one file per code area, each with its own
edge in [`AGENTS.md`](../../../AGENTS.md). Each file is short and scoped to its area.

To add a rule file:

1. Create `docs/agents/<area>-rules.md`. Open with `# <Area> Rules`, the audience line on
   line 3, and a paragraph naming the paths it governs (the same paths as its `AGENTS.md`
   edge) and linking any rule file it borders. Write each rule as a bold lead plus the
   reason for it, as [`typescript-rules.md`](../typescript-rules.md) does.
2. Add its edge to the digraph in `AGENTS.md`, labeled with the paths and concepts it
   governs. See [`agents-md.md`](agents-md.md).

No map edit is needed; the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md) covers rule files through
`AGENTS.md`.

To edit a rule file, keep the edit surgical and on-topic. Don't fold one area's rules into
another's file.

A lesson learned about this repo lands in a rule file, per
[`documentation-rules.md`](../documentation-rules.md) § Keeping the docs true.

## When to break a rule out

Break a section out into its own rule file when either holds:

- It governs a code area that deserves its own `AGENTS.md` edge.
- An agent loading the file for one area would read a long section about another.

Move the section to a new `<area>-rules.md`, and give it an edge. Leave no stub behind. A
one-line cross-link in the old file's scope paragraph is enough.

Maintenance: each `docs/agents/*-rules.md` file is a node on the documentation map.
Adding, removing, or renaming one, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
