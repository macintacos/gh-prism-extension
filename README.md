# gh-prism

On a pull request's Files changed tab, gh-prism replaces GitHub's file tree with a sidebar
that groups changed files into sections. You can review implementation, tests, docs, and
config separately. It is for anyone who reviews pull requests on GitHub in Chrome.

![The gh-prism sidebar with the sections Implementation, Tests, Documentation, Config, and Generated / lockfiles. src/render.rs is marked Partial under Implementation and Documentation.](docs/images/sidebar-grouped.png)

## What it does

- gh-prism groups files by path into Implementation, Tests, Documentation, Config, and
  Generated / lockfiles.
- gh-prism moves a file whose changes are only docstrings or comments to Documentation.
- gh-prism moves a Rust, Python, or TypeScript file whose changes sit only inside inline
  test blocks to Tests. Examples of inline test blocks are a Rust `mod tests` block, a
  Python `def test_` function, and a TypeScript `describe` or `it` call.
- gh-prism lists a file with several kinds of change under each section it touches. Each
  entry is marked `Partial`, with rows such as `Lines 2–8` that jump to that hunk, a block
  of contiguous changed lines.
- When you pick one commit instead of all commits in the Files changed view, gh-prism
  keeps path-only grouping and shows this notice:
  `Grouped by path. Docstring-only and inline-test changes are detected when viewing all commits.`
- gh-prism works only on GitHub's new Files changed page, whose URL ends in `/changes`. It
  leaves the classic page untouched.

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
5. Click **Load unpacked** and choose the `.output/chrome-mv3` folder.

To update gh-prism:

1. Run `git pull`.
2. Run `bun install`.
3. Run `bun run build`.
4. Click the reload button on the gh-prism card in `chrome://extensions`.

## Try it

1. Sign in to GitHub in the Chrome profile where you loaded gh-prism.
2. Open the Files changed tab of any pull request you can see, at a URL that ends in
   `/changes`.

When it works, the sidebar shows the section headings.

No token or setup is needed, because gh-prism reads each pull request through your
signed-in browser session. It sees only the repositories your account can see. If it can't
read the diff, it still groups files by path. It also shows a one-line notice saying why.

## Permissions

gh-prism needs access to three hosts, and nothing else.

- `https://github.com/*` serves the pull request page, its diff, and file contents. A
  content script, which is code that runs inside matching pages, also runs here, so
  gh-prism catches GitHub's in-page navigation into a pull request. It acts only on Files
  changed.
- `https://patch-diff.githubusercontent.com/*` is where GitHub redirects diff downloads.
- `https://raw.githubusercontent.com/*` is where GitHub redirects raw-file downloads.

It doesn't store anything in your browser.

## Troubleshooting

- **No sections appear.** Open the Files changed page at a URL that ends in `/changes`.
- **A notice asks you to sign in while you are signed in.** Chrome's "Block third-party
  cookies" setting is untested with gh-prism. Sign in to GitHub in that profile, then
  reload the page.
- **`bun` fails with a `mise` error about an untrusted config.** If Bun comes from mise, a
  tool version manager, run `mise trust` in the clone, then run `bun install` again.

## Development

Contributors start with these commands:

- `mise install && mise run setup` installs the pinned tools and dependencies and
  registers the git hooks.
- `mise run dev` builds and opens gh-prism in its own Chrome profile at
  `~/.local/share/gh-prism-extension/chrome-profile`. Only one dev session can run at a
  time.
- `mise tasks` lists the rest.
- `scripts/create-sandbox.sh [owner/repo]` creates a private sandbox repository with test
  pull requests.

## License

gh-prism is released under the [MIT License](LICENSE).
