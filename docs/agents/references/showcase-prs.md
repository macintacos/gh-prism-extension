# Editing the sandbox showcase pull requests

*Audience: coding agents and contributors changing what Structural mode shows.*

The Structural mode showcase is five stacked pull requests on
`macintacos/gh-prism-sandbox`, from
<https://github.com/macintacos/gh-prism-sandbox/pull/13> to
<https://github.com/macintacos/gh-prism-sandbox/pull/18>.
[`docs/DEVELOPMENT.md`](../../DEVELOPMENT.md) § Sandbox repositories describes the stack.
The pull requests' bodies are living documentation for people using gh-prism.
[`docs/STRUCTURAL-DIFFS.md`](../../STRUCTURAL-DIFFS.md) sends readers to them, and each
body's "What each file shows" section says, file by file, what GitHub's Split diff shows
and what Structural mode shows instead. A body that no longer matches gh-prism misleads
every reader who follows that link.

When to re-check them:

- A change alters what Structural mode shows on a diff: which code it marks, which lines
  it quiets or leaves untinted, or which old line sits opposite which new line. These
  changes usually land in `utils/structural/` or `entrypoints/content/diffs/structural*`.
  Check `docs/STRUCTURAL-DIFFS.md` against the same change.
- The showcase moves or is replaced. Update the links in `docs/STRUCTURAL-DIFFS.md`,
  `docs/DEVELOPMENT.md`, and this file in the same change.

How to update them:

1. Load the change in the dev browser, as [`docs/DEVELOPMENT.md`](../../DEVELOPMENT.md) §
   The dev browser describes. Step through all five pull requests with Structural mode on,
   and compare each file with its entry in the body.
2. Rewrite each entry the change makes wrong, in the body's own terms: a *mark* is the
   strong highlight on changed code, and a *quiet* line keeps a paler tint than GitHub
   gives it. Say which old line sits opposite which new line where the pairing changed.
   Each file's heading links to its diff as `/pull/<number>/files#diff-<sha256>`, the
   SHA-256 hex of the file's path; a new heading gets one too. The `/changes` page doesn't
   scroll to that anchor.
3. Once the change is on `main`, set the commit in each body's "These examples were
   checked against gh-prism built from `<sha>`" line to that `main` commit. Set it on all
   five bodies, including those whose entries didn't change, because step 1 re-checked
   them all. This repository squash-merges pull requests, so a branch commit's link breaks
   on merge.
4. Push each body with
   `gh pr edit <number> -R macintacos/gh-prism-sandbox --body-file <file>`.

On a pull request branch, stop after step 2 and put the rewritten entries in that pull
request's description under a `## Showcase` heading. The contributor who merges it runs
steps 3 and 4 with the merge commit.

Edit only the bodies. Never push to, merge, or rebase a showcase branch, because each pull
request builds on the one below it and links to them must keep working. When the change
adds a behaviour the stack has no example of, propose a new example to the user instead of
adding it yourself.

Maintenance: the showcase is a node on the documentation map. Adding, removing, or
renaming it, or this pointer, follows the maintenance rule in
[`documentation-rules.md`](../documentation-rules.md).
