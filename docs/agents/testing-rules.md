# Testing Rules

*Audience: coding agents writing or running gh-prism's tests, and the people who maintain
these rules.*

These rules govern `tests/`, `e2e/`, `bench/`,
[`vitest.config.ts`](../../vitest.config.ts), and
[`playwright.config.ts`](../../playwright.config.ts). Facts about the GitHub pages the
tests stand in for are in [`github-rules.md`](github-rules.md).

## Vitest and happy-dom

- **Opt a sheet in before a test reads it.** Vitest returns `""` for every CSS import,
  `?raw` and `?inline` included, unless the file matches `test.css.include` in
  `vitest.config.ts`.
- **Give `:has()` compound arguments only** (`:has(a[href="#x"])`). happy-dom ignores
  combinators inside `:has()`, so `:has([role=region] a[href="#x"])` matches any element
  that has a region at all. Relative chains such as `:has(> * > .x)` work.
- **Write a selector list instead of complex selectors inside `:is()`.** happy-dom
  mishandles them when it computes style.
- **Test layout order with `getComputedStyle`, not DOM order.** happy-dom computes
  `order`, custom properties, and `!important`, including from rules matched through
  `:has()`.
- **Don't depend on `hashchange` after `replaceState`.** happy-dom fires it a tick later,
  and browsers never fire it.
- **Check media queries and reduced motion in Playwright Chromium, not happy-dom.**
  happy-dom doesn't evaluate them.

## Test bodies

- **Split a test body into arrange, act, and assert paragraphs, and a describe-level setup
  block into one paragraph per setup step.** Tests follow the same
  [paragraphing as source](typescript-rules.md#function-bodies), so a reader finds each
  step at a glance.

## End-to-end and bench

- **Name end-to-end tests `*.e2e.ts`.** Vitest's default include would collect a
  `.spec.ts` and try to run a Playwright test.
- **Route fixtures to a github.com URL.** The content script matches github.com, so
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts) serves each fixture at a pull request or
  commit URL.
- **Never let a `bench/` file match a test glob** (`*.{test,spec}.*` or `*.e2e.ts`). The
  benchmark stays out of Vitest, Playwright, and CI.

## Verifying in a real browser

To check behaviour live, build the extension and drive Playwright's bundled Chromium:

- **Launch with `launchPersistentContext` and `--load-extension=.output/chrome-mv3`, and
  pass `channel: "chromium"` for headless.** Headless extension loading needs that
  channel.
- **Sample paint-level state in a `requestAnimationFrame` loop added with
  `addInitScript`.** A single read after load misses intermediate frames.
- **Use routed fixtures for pull request pages when signed out.** Signed-out GitHub serves
  the classic Files view. Intent fails fast on a routed fixture, because its repository
  doesn't exist, so progress steps need a real pull request.
- **Use a public commit page to run the whole extension signed out.** Signed-out GitHub
  serves commit pages in the new UI. Batch probes into few page loads, because many
  signed-out loads in a row hit the rate limit.
- **For a signed-in pull request, sign in through Playwright and save its
  `storageState`.** Never extract cookies from a browser profile.
- **Wrap the service worker's `fetch` to observe pull request data requests.** The
  background script calls the global `fetch` at request time, so wrapping `self.fetch`
  through `worker.evaluate` logs each request.
- **Expect a page head only after a soft navigation from Conversation.** The page head is
  the head SHA read from the page's embedded data (`pageHeadSha` in
  [`utils/github/pr-port.ts`](../../utils/github/pr-port.ts)). The Conversation page's
  embedded data names the pull request, so that navigation keeps it. Entering from
  `/pulls` leaves none, so the service worker fetches the head itself. Take that path to
  check the head lookup.
