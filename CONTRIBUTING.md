# Contributing

*Audience: people contributing code or docs to gh-prism.*

This page gets you set up and points you onward. [`README.md`](README.md) describes what
gh-prism does, the pages under [`docs/`](docs/README.md) explain how it works and how to
develop it, and `docs/agents/` holds the rules each code area follows.

## Setup

Install the pinned tools and dependencies, and register the git hooks:

```sh
mise install && mise run setup
```

## Everyday tasks

- `mise run dev` builds gh-prism and opens it in its own Chrome profile, reloading on
  change. Only one dev session runs at a time.
- `mise run preflight` checks formatting, lint, and tests. Run it before you push.

The full task catalog, the benchmark, and CI are in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Where tests live

Unit tests are in `tests/`, and Playwright end-to-end tests are in `e2e/`. The rules for
writing them are in [`docs/agents/testing-rules.md`](docs/agents/testing-rules.md).

## Going deeper

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how gh-prism's parts fit together.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md): tasks, tests, hooks, CI, and patches.
- [`CONTEXT.md`](CONTEXT.md): the terms the code and issues share.
- [`docs/agents/styling-rules.md`](docs/agents/styling-rules.md): how to write styles.
