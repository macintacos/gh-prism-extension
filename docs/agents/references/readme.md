# Editing `README.md`

*Audience: coding agents and contributors editing gh-prism's README.*

[`README.md`](../../../README.md) is the user-facing front door: what gh-prism does, how
to install it, what it may access, and how to fix common problems. It stays short and
points contributors to [`CONTRIBUTING.md`](../../../CONTRIBUTING.md) and
[`docs/`](../../README.md).

When to edit it:

- A feature a user sees is added, removed, or changes behavior.
- The install steps change.
- gh-prism gains or drops a host permission. Update § Permissions.
- gh-prism stores a new kind of data. Update § Permissions.
- A common failure gains a known fix.
- Recapture both its light and dark screenshots in the same change when a surface the
  README pictures changes how it looks, and update its `<img>` `width` and `alt` and its
  `<summary>` to match the new capture.

§ What it does has one `###` per headline feature: a lead line that reads without the
screenshot, at most three bullets, and the feature's screenshot in a collapsed
`<details>`. A new feature joins the headline it extends, or gets its own `###` and
screenshot pair. The hero above § What it does stays expanded. Keep the headings
`## What it does` and `## Permissions`: the opening links the first, and
[`typescript-rules.md`](../typescript-rules.md) links the second.

Each picture is a `<picture>` whose `<source media="(prefers-color-scheme: dark)">` names
`docs/images/<surface>-dark.png` and whose `<img>` names `<surface>-light.png`, with
`width` half the PNG's pixel width. Capture both at 2× device pixels with the same crop,
below GitHub's global header, by emulating the colour scheme while the account's
Appearance is "Sync with system" with Light default and Dark default. Compress them with
`mise x oxipng@latest -- oxipng -o max --strip safe`.

| Surface | Source |
| --- | --- |
| `hero`, `sections`, `viewed` | Files changed of pull request #3 (`complicated-change`) in a sandbox from `scripts/create-sandbox.sh` |
| `lines-changed` | the Conversation tab of that pull request |
| `code-owners` | pull request #1 in `excessive-dev/gh-prism-codeowners-sandbox` |
| `commit` | this repository's commit `f98efef`: the sandbox's commits have one-line messages, and a message with no body renders no column |

Keep contributor detail out of it. Setup and tasks belong in `CONTRIBUTING.md` and
`docs/DEVELOPMENT.md`.

Maintenance: `README.md` is a node on the documentation map. Adding, removing, or renaming
it, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
