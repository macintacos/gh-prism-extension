# Editing `CONTEXT.md`

*Audience: coding agents and contributors editing gh-prism's glossary.*

[`CONTEXT.md`](../../../CONTEXT.md) is the glossary of terms the extension, its code, its
docs, and its issues share. Terms are coined or changed here first. Code, docs, and issues
then use these words, not their synonyms.

When to edit it:

- A change introduces a concept that needs a name.
- A term's meaning shifts, or a term is renamed. Rename it in the code and docs in the
  same change.
- Two terms turn out to mean one thing. Merge them and record the loser under *Avoid*.

Keep each term's *Avoid* list. It names the synonyms that caused confusion, so removing it
lets them back in.

Maintenance: this doc is a node on the documentation map. If you rename or restructure it,
update [`documentation-rules.md`](../documentation-rules.md) per its maintenance rule.
