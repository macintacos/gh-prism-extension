# gh-prism

gh-prism is a Chrome extension that replaces the file tree on a GitHub pull request or
commit with a sidebar that splits the changes into sections, so you can review one part at
a time. It takes its idea from how Linear, an issue tracker, breaks a pull request into
parts.

A pull request can look large by its total lines changed when only a small part of it is
implementation. AI-assisted pull requests often look like this: the rest of the lines are
docs, tests, and other updates. gh-prism lets you focus on the implementation first, then
give each other part its own deliberate pass.

![The gh-prism sidebar with the sections Implementation, Tests, Docs & Comments, Config, and Generated / lockfiles. src/render.rs is marked Partial under Implementation and Docs & Comments.](docs/images/sidebar-grouped.png)

## What it does

gh-prism runs on a commit's page and on GitHub's new Files changed tab of a pull request,
at `/pull/<number>/changes`. On the classic Files changed tab, at `/pull/<number>/files`
or `/pull/<number>/commits/<sha>`, it opens a dialog that says why it isn't running and
how to get the new tab. Once you close the dialog, it stays closed, and
**Why is gh-prism off?** in the tab's toolbar opens it again.

- It groups changed files into five sections: Implementation, Tests, Docs & Comments,
  Config, and Generated / lockfiles.
- It moves a file whose changes touch only comments or docstrings to Docs & Comments, and
  a change that sits only inside inline test blocks, such as a Rust `mod tests` block, to
  Tests. Outside Implementation, it moves a comment-only change on its own.
- In a file that stays in Implementation, it counts the comment and docstring lines toward
  Docs & Comments and lists the file by them under **Implementation comments**, a
  sub-section at the end of Docs & Comments, collapsed by default.
- It lists a file whose changes belong in more than one section under each of those
  sections, and marks each entry `Partial`. It also marks `Partial` an Implementation
  entry whose comment lines count toward Docs & Comments, and every entry in the
  sub-section.
- It lays out the diffs in the order the sidebar lists their files.
- It splits the count of lines changed in the pull request or commit header into one count
  per section.
- It collapses or expands a section's files when you click its heading.
- It dims the files you've marked Viewed on GitHub, in every section that lists them, and
  once any file is Viewed, each section's heading shows how many of its files are Viewed
  (`N/M`). It follows GitHub's Viewed toggle.
- It marks a file Viewed on GitHub when you tick the checkbox on its row, or when you
  Alt-click the row (Option-click on macOS). Doing either again marks it not viewed.
- After an update, the sidebar opens with a collapsed **What's new in vX.Y.Z** block of
  that version's release notes. It goes away when you dismiss it, or 3 days after you
  first see it.
- A **Report a miscategorized file** button beside the file tree's filter opens a new
  issue on gh-prism's repository with your gh-prism version filled in, and, on a public
  repository only, the diff's URL.

## Install

You need Git, Bun (a JavaScript runtime and package manager), and Chrome. Run steps 1 to 3
in a terminal.

1. Clone the repository and enter it:

   ```bash
   git clone https://github.com/macintacos/gh-prism-extension.git
   cd gh-prism-extension
   ```

2. Install the dependencies:

   ```bash
   bun install
   ```

3. Build the extension:

   ```bash
   bun run build
   ```

   The build writes the unpacked extension to `.output/chrome-mv3`.
4. In Chrome, open `chrome://extensions` and turn on **Developer mode**.
5. Click **Load unpacked** and choose the `.output/chrome-mv3` folder inside the clone.
   The picker hides folders whose names start with a dot. Press Cmd+Shift+. on macOS, or
   Ctrl+H on Linux, to show them.
6. Sign in to GitHub in the Chrome profile where you loaded gh-prism. Then open the Files
   changed tab of any pull request you can see, at a URL that contains
   `/pull/<number>/changes`. Reload any GitHub tab that was already open when you loaded
   gh-prism. When it works, the sidebar shows the section headings.

To update gh-prism:

1. Run `git pull`.
2. Run `bun install`.
3. Run `bun run build`.
4. Click the reload button on the gh-prism card in `chrome://extensions`.
5. Reload any open GitHub tabs.

## Permissions

No token or setup is needed, because gh-prism reads each pull request through your
signed-in browser session. It sees only the repositories your account can see.

gh-prism needs access to three hosts and to Chrome's extension storage, and nothing else.

- `https://github.com/*` serves the pull request or commit page, its diff, and file
  contents. A content script, which is code that runs inside matching pages, also runs
  here, so gh-prism catches GitHub's in-page navigation into a pull request or commit. It
  acts only on Files changed and commit pages.
- `https://patch-diff.githubusercontent.com/*` is where GitHub redirects diff downloads.
- `https://raw.githubusercontent.com/*` is where GitHub redirects raw-file downloads.
- Extension storage holds the side you put the sidebar on, whether the header's
  lines-changed counter shows its breakout by section or GitHub's total, whether you
  closed the dialog on the classic Files changed tab, which version's what's-new notes you
  dismissed or first saw and when, and where gh-prism placed each file for the diffs it
  read most recently. It keeps up to 50 placement entries, and a pull request's diff can
  take two: one for the diff and one for the base and head commits it runs between. Chrome
  syncs the side and the counter's view to your other computers when Chrome sync is on.
  The notice's dismissal, the what's-new marks, and the placements stay on this computer.

## Troubleshooting

- **No sections appear.** Reload the page. Tabs that were open before you loaded or
  reloaded gh-prism don't run it. Then check that the URL contains
  `/pull/<number>/changes` or `/commit/<sha>`.
- **A pull request's Files changed URL ends in `/files` or `/commits/<sha>`, and the page
  looks like plain GitHub.** That is GitHub's classic page, where gh-prism shows only its
  dialog. If you closed it, click **Why is gh-prism off?** in the toolbar above the files.
  GitHub shows the classic page when you are signed out, even on a public pull request, so
  sign in. Signed in, GitHub shows it when its New Files Changed Experience preview is
  off. Click your profile picture, click **Feature preview**, choose
  **New Files Changed Experience**, and click **Enable**. GitHub Docs explains the dialog
  in
  [Exploring early access releases with feature preview](https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview).
- **gh-prism's dialog asks you to sign in while you are signed in.** Check that you are
  signed in to GitHub in the same Chrome profile where you loaded gh-prism, then reload
  the page. Chrome's "Block third-party cookies" setting is untested with gh-prism.
- **`bun` fails with a `mise` error about an untrusted config.** If Bun comes from mise, a
  tool version manager, run `mise trust` in the clone, then rerun the command that failed.

## Contributing

Setup commands for contributors are in [CONTRIBUTING.md](CONTRIBUTING.md), and how
gh-prism works is in [docs/](docs/README.md).

## License

gh-prism is released under the [MIT License](LICENSE).
