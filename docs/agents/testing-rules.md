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
  that has a region at all. A one-step relative argument (`:has(> .x)`) is reliable too,
  but a multi-step chain such as `:has(> * > .x)` matches any element with a child, so
  prove that form in Chromium.
- **Write a selector list instead of complex selectors inside `:is()`.** happy-dom
  mishandles them when it computes style.
- **Test layout order with `getComputedStyle`, not DOM order.** happy-dom computes
  `order`, custom properties, and `!important`, including from rules matched through
  `:has()`.
- **Don't depend on `hashchange` after `replaceState`.** happy-dom fires it a tick later,
  and browsers never fire it.
- **Run pending fake timers before `vi.useRealTimers()` in a test that renders a tree.**
  Uninstalling the clock drops its pending callbacks. Preact, which @pierre/trees renders
  with, schedules its after-paint flush only when its module-level queue is empty, so one
  dropped flush keeps every later tree in the file alive until the worker runs out of
  heap. `mountsVisit()` in [`tests/fixtures/visit.ts`](../../tests/fixtures/visit.ts) does
  this for every test it mounts.
- **Toggle reduced motion through
  `window.happyDOM.settings.device.prefersReducedMotion`.** happy-dom evaluates media
  queries, so
  [`tests/content/diffs/reveal.test.ts`](../../tests/content/diffs/reveal.test.ts) tests
  the reduced-motion path without a browser.
- **Prove a `<dialog>`'s modality, Esc, and light dismiss in Chromium, not happy-dom.**
  happy-dom's `showModal()` only sets `open`, with no top layer, no Esc, and no
  `closedby`, and its `close()` fires `close` at once, where a browser queues it.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s classic Files changed test checks
  `:modal` and closes the dialog by its backdrop.
- **Prove tree row layout in Chromium, not happy-dom.** happy-dom computes no style from
  the section tree's shadow-root sheets, even with `section-tree.css` in
  `test.css.include`. [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s `rowLayout` is the
  pattern.
- **Read a computed animation through `animation`, not `animationName`.** happy-dom
  computes the shorthand alone, so `animationName` reads `""` whatever the sheet says.
- **Prove ordering inside one click dispatch in Chromium, not happy-dom.** happy-dom runs
  no microtask checkpoint between a scripted click's listeners, so a stand-in that flips
  in a microtask still lands after the dispatch ends.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s `copyGitHubToggles` covers the Viewed
  toggle's flip.

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
- **Let the sections' reveal finish before a test clicks in the sidebar and reads its
  scroll.** The reveal animation moves every row for up to half a second after the
  sections land. Playwright retries a click whose target is moving, and its retries scroll
  the target into view with forced alignments, even when it is already in view. Which
  alignment the click lands on depends on the machine's speed, so the sidebar can stay put
  locally and move on CI. [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "ticking a box
  doesn't scroll the sidebar" awaits the animations' `finished` first.
- **After a test scrolls the sidebar, wait for the tree to take pointer events before it
  clicks a row.** @pierre/trees sets `pointer-events: none` on the tree while it scrolls,
  so a click that comes too soon is intercepted and retried, with the same forced scroll.
  "ticking a box doesn't scroll the sidebar" polls the box's computed `pointer-events`
  first.
- **Click a control drawn over a tree row on GitHub's current file too, with Playwright's
  `click()`.** @pierre/trees stacks the focused and selected rows above their siblings, so
  either can cover a control that works on every other row, and `dispatchEvent` skips the
  hit test that would show it. A routed fixture runs no GitHub script, so make a file
  current by setting `aria-current` on GitHub's tree item.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "ticking GitHub's current file's box
  saves its Viewed state" is the pattern.
- **Keep each end-to-end test independent of the others.** `playwright.config.ts` sets
  `fullyParallel`, so the tests in one file run across workers in no fixed order. The
  `context` fixture gives each test its own browser profile.
- **Reproduce CI's e2e timing on Linux with 4 CPUs.** macOS runs too fast to show a
  slowdown CI fails on. With the extension built on the host, run the suite in
  `mcr.microsoft.com/playwright:v<version>-noble` with the repository mounted, through
  `container run -c 4 -m 8G` or `docker run --cpus 4` with `-e CI=1` for CI's 4 workers,
  and `node node_modules/@playwright/test/cli.js test`.

## Verifying in a real browser

To check behavior live, build the extension and drive Playwright's bundled Chromium:

- **Launch with `launchPersistentContext` and `--load-extension=.output/chrome-mv3`, and
  pass `channel: "chromium"` for headless.** Headless extension loading needs that
  channel.
- **Sample paint-level state in a `requestAnimationFrame` loop added with
  `addInitScript`.** A single read after load misses intermediate frames.
- **Use routed fixtures for pull request pages when signed out.** Signed-out GitHub serves
  the classic Files view. Intent fails fast on a routed pull request fixture, because its
  repository doesn't exist, so progress steps need a real pull request. A commit fixture
  can land intent if the test also routes its `<url>.diff`, as `COMMIT_DIFF` in
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts) does.
- **Check colors and contrast on a live GitHub page, never on a routed fixture.** The
  fixtures load no GitHub stylesheet, so every Primer token is unset there, and a rule
  that reads one, such as the Viewed box's `var(--gh-prism-hue)`, computes as invalid. On
  a signed-in page, switch theme by setting `<html>`'s `data-color-mode` and
  `data-dark-theme`, after giving the theme's `link[data-color-theme]` its `data-href` as
  `href`.
- **Use a public commit page to run the whole extension signed out.** Signed-out GitHub
  serves commit pages in the new UI. Batch probes into few page loads, because many
  signed-out loads in a row hit the rate limit.
- **For a signed-in pull request, sign in through Playwright and save its
  `storageState`.** Never extract cookies from a browser profile.
- **Scrub a signed-in capture before it becomes a fixture.** Signed-in markup and route
  data carry the session's identity and tokens, which must never reach the repository.
  Remove the login (except inside repository paths), avatar URLs, `authenticity_token` and
  CSRF inputs, `csrf_tokens`, `nonce` values, `aliveChannel`, `data-hydro-*` and
  `octolytics` attributes, user ids, and JSON fields that identify the viewer. Keep
  per-file state such as `diffSummaries[].markedAsViewed`.
- **Cut a `merge_box` capture down to `pullRequest.pendingReviewRequests` and
  `pullRequest.latestOpinionatedReviews`, without `avatarUrl` or review `id`.** The rest
  carries the viewer's commit emails and signed alive-channel tokens. Where the viewer's
  login is data, as in a CODEOWNERS token, replace it with `sandbox-user`. Import a JSON
  capture `?raw`, so each test parses its own copy to edit.
- **Wrap the service worker's `fetch` to observe pull request data requests.** The
  background script calls the global `fetch` at request time, so wrapping `self.fetch`
  through `worker.evaluate` logs each request.
- **Enter from `/pulls` to check the head lookup.** That entry leaves no page head, so the
  service worker fetches the head itself. The page head is the head SHA read from the
  page's embedded data (`pageHeadSha` in
  [`utils/github/pr-port.ts`](../../utils/github/pr-port.ts)), which a full load of Files
  changed or a soft navigation from Conversation provides.
