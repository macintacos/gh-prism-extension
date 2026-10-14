# Adding or editing a `docs/agents/*-rules.md` rule file

*Audience: coding agents and contributors adding or editing a rule file.*

`docs/agents/*-rules.md` holds gh-prism's rules, one file per code area: styling, GitHub's
pages, testing, TypeScript, and documentation. Each file is short and scoped to its area,
and [`AGENTS.md`](../../../AGENTS.md) routes a change to the ones it needs.

To add a rule file:

1. Create `docs/agents/<area>-rules.md`. Write each rule as a bold lead plus the reason
   for it, as [`typescript-rules.md`](../typescript-rules.md) does. State its audience on
   line 3.
2. Add its edge to the digraph in `AGENTS.md`, labeled with the paths and concepts it
   governs. See [`agents-md.md`](agents-md.md).
3. Add it to the map in [`documentation-rules.md`](../documentation-rules.md), per its
   maintenance rule.

To edit a rule file, keep the edit surgical and on-topic. Don't fold one area's rules into
another's file.

A lesson learned about this repo lands in a rule file, per
[`documentation-rules.md`](../documentation-rules.md) § Keeping the docs true.

## When to break a rule out

Break a section out into its own rule file when either holds:

- It governs a code area that deserves its own `AGENTS.md` edge.
- An agent loading the file for one area would read a long section about another.

Move the section to a new `<area>-rules.md`, give it an edge, and add it to the map. Leave
no stub behind in the old file.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
