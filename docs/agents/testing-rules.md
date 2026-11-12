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
- **Stub `showPopover` and `hidePopover` before a test opens a popover, and prove light
  dismiss, Escape, one open at a time, and `toggle` ordering in Chromium.** happy-dom has
  no Popover API, and a stub's `toggle` fires at once, where a browser queues it. In
  Chromium a click on an open popover's own control runs light dismiss on `pointerup`,
  before `click`, so the hidden popover's `toggle` arrives after the same click re-opens
  it.
  [`sections-view-owners.test.ts`](../../tests/content/sidebar/sections-view-owners.test.ts)
  stubs both at its top. Prove a popover that opens on focus in Chromium too: a stub skips
  Chromium's focus return, where `hidePopover()` on a popover that holds focus moves focus
  back to the element that had it, such as the popover's `source`, before the hide ends,
  and a `showPopover()` from that focus throws.
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
- **Don't read a sibling's computed style after a combinator's subject changes back.**
  Under `.a[data-v] + * { display: none }`, happy-dom updates the sibling's computed
  `display` when `.a` gains the attribute, but keeps `none` once it loses it. Prove the
  way back in Chromium: [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a commit's message
  switches to GitHub's box from the keyboard, and opens there after a reload with no flash
  of the rendering" covers the commit message's switch.
- **Read a computed style only after the attribute its rule keys on lands on an
  ancestor.** happy-dom keeps the style it computed before `<html>` gains
  `data-gh-prism-panel`, so a read before `dressConversationFrame` and one after compare
  equal whatever `frame.css` says.
- **End a Web Animations API animation with `finish()`.** happy-dom's animations report
  `running` and never advance, under real or fake timers, so `finished` settles only once
  a test calls `finish()`.
  [`message-view.test.ts`](../../tests/content/commit/message-view.test.ts)'s
  `finishSlides` does it. Prove what an animation draws in the e2e suite:
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a commit's message column slides out
  with the diffs at its edge in every frame…" samples each frame. Prove that `reverse()`
  turns an animation around in a live check.
- **Stub `Highlight` and `CSS.highlights` on happy-dom's window before a test runs
  Highlight API code.** happy-dom has neither. Its `window.CSS` is a getter that returns a
  new object on every read, so assigning `highlights` onto it is lost; define `CSS` with
  `Object.defineProperty` and delete it afterwards. happy-dom keeps no live ranges either,
  so a range over removed text nodes never collapses; prove that in a browser.
  [`structural.test.ts`](../../tests/content/diffs/structural.test.ts) stubs and restores
  `CSS` this way.
- **Stub an iframe's `contentWindow`.** happy-dom's `disableIframePageLoading` means an
  iframe never gets one.

## Test bodies

- **Split a test body into arrange, act, and assert paragraphs, and a describe-level setup
  block into one paragraph per setup step.** Tests follow the same
  [paragraphing as source](typescript-rules.md#function-bodies), so a reader finds each
  step at a glance.
- **Give a source-code fixture a `.txt` suffix.** Biome formats and lints every `.ts`,
  `.tsx`, and `.js` file and `tsc` type-checks every `.ts` and `.tsx`, so a fixture that
  must keep odd indentation or must not parse would be rewritten or would fail the hooks;
  `tests/fixtures/structural/` names its pairs `<case>.old.<ext>.txt` and
  `<case>.new.<ext>.txt`.

## End-to-end and bench

- **Name end-to-end tests `*.e2e.ts`.** Vitest's default include would collect a
  `.spec.ts` and try to run a Playwright test.
- **Route fixtures to a github.com URL.** The content script matches github.com, so
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts) serves each fixture at a pull request or
  commit URL.
- **Round a measured distance to 0.01 px before comparing it exactly.** Firefox reports
  box coordinates as float32, so an 8 px gap between two boxes can come back as 7.99999
  px. [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s `toHundredths` does it.
- **Compare install warnings with `chrome.management.getPermissionWarningsByManifest` from
  the service worker.** It needs no `management` permission, so
  [`bench/structural-host/serve.ts`](../../bench/structural-host/serve.ts)'s `warnings` op
  checks a permission's warning in the built extension. In Chromium 156 the `offscreen`
  permission added none (2026-11-10).
- **Never let a `bench/` file match a test glob** (`*.{test,spec}.*` or `*.e2e.ts`). The
  benchmark stays out of Vitest, Playwright, and CI.
- **Give a large fixture's first wait `LARGE_PR_READ_TIMEOUT`.** The extension reads the
  300-file diff before the sections land, and on a loaded runner that can take longer than
  expect's 5 s default. In [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts), the large-fixture
  tests pass it to their opening `toBeVisible`. A test that opens on an action already
  waits up to the test timeout.
- **Let the sections' reveal finish before a test clicks or hovers in the sidebar and
  reads its scroll.** The reveal animation moves every row for up to half a second after
  the sections land. Playwright retries a click or hover whose target is moving, and its
  retries scroll the target into view with forced alignments, even when it is already in
  view. Which alignment the click lands on depends on the machine's speed, so the sidebar
  can stay put locally and move on CI. [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s
  "ticking a box doesn't scroll the sidebar" awaits the animations' `finished` first.
- **Retry a jump and its check together after a test wheels the sidebar.** A wheel's
  scroll can land after a later `scrollTop` write and carry the sidebar past the target. A
  poll for `scrollTop > 0` only proves that the wheel started. In
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts), "…the sidebar scrolls as one" wraps
  `scrollSidebarToBulkRow` and `toBeInViewport` in `toPass`.
- **Let the Conversation panel's slide finish before a test hovers or clicks in its
  frame.** Playwright measures an element's stability inside its own frame, so it can't
  see the frame sliding in with the panel, and a hover mid-slide lands on a shield that
  then slides away, whose `pointerout` cancels the popup's open.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a code owner reviewer's shield in the
  Conversation panel opens their files and details" awaits the panel's animations first.
- **Let the sections land and their reveal finish before a test hovers in the diffs.**
  Their load lays the diff list out anew, and scroll anchoring slides what sits under the
  pointer, whose `pointerout` cancels a popup's open.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a code-owning review comment author's
  shield on the new Files changed page lists their files on hover and opens a modal on
  click" awaits a `.gh-prism-section` and `revealSettled` in its `ready` first.
- **Let the cover lift before a test clicks a control in the diffs' toolbar.** A routed
  fixture loads no GitHub sheet, so the sidebar stacks above that toolbar, and the
  sections landing push it down. A click that comes between Playwright's hit test and the
  landing lands on whatever moved under the pointer.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "the side switch docks the sidebar on the
  other side and remembers it" waits for `data-gh-prism-diffs` to leave `covered` first.
- **Let the sections land before a test measures the diffs' toolbar on a commit.** The
  fixture's sidebar stacks above the toolbar, and a commit's sections land after its
  `.diff` read returns, well after the toolbar's controls mount. Wait for the sections'
  `navigation` to drop `aria-busy` before the first measurement.
- **Read the page in a route handler only for the request the test measures.** The page
  can send another request as the test's last step settles, whose handler then runs after
  the test has closed the page, and a page read there fails the test. A handler that only
  fulfills is safe, since Playwright drops a fulfill once the page closes.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a commit's Older and Newer hold their
  place from its first frame…" reads the page for the first search only.
- **After a test scrolls the sidebar, wait for the tree to take pointer events before it
  clicks a row.** @pierre/trees sets `pointer-events: none` on the tree while it scrolls,
  so a click that comes too soon is intercepted and retried, with the same forced scroll.
  "ticking a box doesn't scroll the sidebar" polls the box's computed `pointer-events`
  first.
- **Hover a tree row before a test tabs to its code owners shield.** A focus that scrolls
  the window delivers the scroll event a frame later, after the focus has opened the
  shield's popover, and the popover closes on any scroll outside it.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "Shift+Tab from an owners popover back to
  its shield keeps the same popover open" is the pattern.
- **Click a control drawn over a tree row on GitHub's current file too, with Playwright's
  `click()`.** @pierre/trees stacks the focused and selected rows above their siblings, so
  either can cover a control that works on every other row, and `dispatchEvent` skips the
  hit test that would show it. A routed fixture runs no GitHub script, so make a file
  current by setting `aria-current` on GitHub's tree item.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "ticking GitHub's current file's box
  saves its Viewed state" is the pattern.
- **Sample a routed page's frames from gh-prism's first mark, not the page's first
  frame.** A fixture served from a route parses before the content script has read its
  stored preferences, so GitHub's markup paints before the visit starts, where a live page
  streams in after them. A fixture loads no GitHub sheet either, so a test that reads
  where the diffs sit gives the layout row GitHub's flex and the tree a fixed width.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s "a commit's message holds its column from
  its first frame…" is the pattern.
- **Wait for `data-gh-prism-glide` to clear before a test clicks after a glide.** A view
  transition's pseudo-elements take the pointer until it clears.
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s `openPinned` is the pattern.
- **In Chromium, read session rules through `worker.evaluate` on
  `chrome.declarativeNetRequest`.** [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s
  `sessionRules` is the pattern. Playwright's Firefox has no `context.serviceWorkers()`.
- **Run the one suite in both browsers.** It runs as the `chromium` and `firefox`
  projects, and the `context` fixture picks the launcher and build from `browserName`.
  There is no Firefox copy of a test, and no assertion branches on the browser.
- **Skip a test in Firefox only for a harness limit,** something Playwright can't reach in
  Firefox. Use `test.skip(browserName === "firefox", "<the limit>")` as the test's first
  statement. Fix any other Firefox failure in gh-prism, or make the test browser-neutral.
- **Firefox loads the build through playwright-webextext,** which needs a real profile
  directory, and `tslib` beside it, since 0.0.5 requires it without declaring it. If the
  package breaks, install the add-on over Firefox's remote debugging protocol instead of
  switching harnesses.
- **Expect Firefox's focus to differ from Chromium's in four ways.** Shift+Tab from the
  page's first control keeps focus there, so start a keyboard move from a control after
  it. A parent's `focus()` doesn't take while a child frame holds focus, until the frame
  is blurred. Removing the focused element fires no `focusout`. Tab enters any scroll
  container, where Chromium enters only one with no control inside.
- **Expect Firefox to route only the page's own requests.** `context.route` never sees an
  add-on background script's fetch, such as the commit's `.diff`. The `context` fixture
  launches Firefox with a proxy on a port nothing listens on, so such a fetch fails at
  once, as Chromium's routed 404 does, instead of waiting on the real github.com and
  failing any test that waits for intent when github.com is slow. Never drop that proxy. A
  content script's fetch is routed, but Firefox holds it to the page's CSP, so a routed
  page's policy keeps GitHub's `connect-src 'self'`. A test that routes such a fetch skips
  in Firefox with `BACKGROUND_ROUTE_LIMIT`.
- **Prove a module that takes an injected dependency in real browsers by bundling it, not
  through the built extension.** No spec can reach a content script's parameters.
  [`bench/bundle.ts`](../../bench/bundle.ts) bundles the module with a harness, and the
  test runs it in the page's main world:
  [`e2e/structural.e2e.ts`](../../e2e/structural.e2e.ts) on fixtures, and
  [`bench/structural-live.ts`](../../bench/structural-live.ts) on live GitHub. Check the
  built extension's Structural mode live with
  `bun bench/structural-mode-live.ts <chromium|firefox> <storage-state path> [url…]`
  ([`bench/structural-mode-live.ts`](../../bench/structural-mode-live.ts)). It changes the
  account's saved Layout and restores it;
  `bun bench/structural-mode-live/restore-check.ts` proves that restore offline. Its
  fourth pass drives the diff view control on each URL: each press checked against the
  gear's Layout, the stored mode, and the count of `POST /users/diffview`, a clean page
  after leaving Structural, the choice kept across a reload, the control following a
  Layout chosen from the gear, and ArrowDown in the diffs unchanged by the mode.
- **Click a live control through its locator, never at coordinates read earlier.**
  GitHub's toolbar moves: a commit's drops its "Top" button about 50 ms after a scroll to
  the top, shifting the diff view control 71px, so a `mouse.click` at a `boundingBox()`
  read before lands on the next segment. `locator.click()` waits for the box to hold still
  and checks the target is under the pointer.
- **Compare two live loads' markup only after masking what GitHub generates per load and
  per pointer.** React ids (`_r_t9_`, `id`, `aria-*` references) differ between loads, and
  GitHub adds `style="anchor-name: …"` to an overlay's button only once the pointer has
  been near it.
  [`bench/structural-parity-live.ts`](../../bench/structural-parity-live.ts)'s `signature`
  masks both, and waits for gh-prism's "Sorting files into sections" to leave a large pull
  request before it reads the sidebar.
- **Find GitHub's live review controls by what they are, not by guessed names**
  (2026-11-11). "Write a reply" is `aria-hidden`, so match it by text; a suggestion comes
  from the file header's line menu ("Suggest change on line R<n>"), which acts on the
  selected line; a commit's hovered line offers `button[aria-label="Add comment"]` where a
  pull request's offers `button[data-add-comment-button]`; and the Submit review dialog
  has no discard, so a bench discards its pending review with `gh api -X DELETE`.
- **Reach a file on a huge pull request by scrolling from the top, not by its hash, and
  judge a reveal by the revealed file's own region.** In Firefox, nodejs/node#66212 never
  mounts a file's region from `#diff-<sha>`, even with no extension loaded. A sidebar
  reveal on a profile's first load of a page can come to rest up to 150 px lower, in trunk
  too, so "the file below the sticky headers" names the neighbour. Wait until the clicked
  file's region stops moving, then check that it is in the viewport's top half.
- **Give an e2e page a gear and a Layout menu by splicing a captured toolbar and adding
  `installLayoutMenu` with `page.addInitScript`.** The page fixtures have no gear, so
  [`e2e/smoke.e2e.ts`](../../e2e/smoke.e2e.ts)'s `layoutBody` swaps in
  `files-page-toolbar.html` or `commit-page-toolbar.html` and one diff table, and
  [`tests/fixtures/layout-menu.ts`](../../tests/fixtures/layout-menu.ts) plays GitHub's
  menu from `layout-menu-pr.html` or `layout-menu-commit.html`. A pull request's
  three-column table counts as Unified only when it changes both sides, so the pull
  request pages use `files-page-diff-rename.html` for Unified.
- **Keep a live check's screenshots outside `test-results/`.** Playwright empties it at
  the start of every run.
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
- **Cut a `review_requests` capture down to `pendingReviewRequests` and
  `completedReviews`, without `avatarUrl`, user or team `id`, or review `id`.** The rest
  is Copilot's settings, with links to the viewer's own Copilot settings. Where the
  viewer's login is data, as in a CODEOWNERS token, replace it with `sandbox-user`. Import
  a JSON capture `?raw`, so each test parses its own copy to edit.
- **Wrap the service worker's `fetch` to observe pull request data requests.** The
  background script calls the global `fetch` at request time, so wrapping `self.fetch`
  through `worker.evaluate` logs each request.
- **Enter from `/pulls` to check the head lookup.** That entry leaves no page head, so the
  service worker fetches the head itself. The page head is the head SHA read from the
  page's embedded data (`pageHeadSha` in
  [`utils/github/pr-port.ts`](../../utils/github/pr-port.ts)), which a full load of Files
  changed or a soft navigation from Conversation provides.
- **In Firefox, drive a stock headless Firefox over WebDriver BiDi.** The e2e fixture
  loads the build into Playwright's Firefox through playwright-webextext; for a live
  check, use a stock Firefox: Playwright's Firefox can't route or observe the background
  script's requests, and this recipe's `network.*` events are how a live check sees them.
  Start Firefox with `--remote-debugging-port` on a fresh temporary profile, never your
  own or the dev profile, and drive it from a Node script on the global `WebSocket`:
  `session.new`, then `webExtension.install` with a copy of `.output/firefox-mv3`, since a
  rebuild mid-check changes what Firefox reads. Set the GitHub cookies from the saved
  `storageState` with `storage.setCookie`, then use `browsingContext.navigate`,
  `script.evaluate`, `input.performActions`, and the `log.entryAdded` and `network.*`
  events for evidence. By hand, load the build as a temporary add-on from
  `about:debugging#/runtime/this-firefox`, and read session rules with
  `await browser.declarativeNetRequest.getSessionRules()` in gh-prism's Inspect console.
- **Select a range of diff lines with a real Shift key, not a click modifier.** Under
  Playwright, a pointer drag across number cells, or a click and then a click with Shift
  held as real key state (`keyboard.down("Shift")`), selects a range; a click's
  `modifiers` option does not. Loading a line hash in a fresh headless tab selected no
  cell within 15 s (Chromium 157 and Firefox 157, sandbox PR #3 in Split, 2026-11-10).
- **Check GitHub's own markup with no extension loaded.** A plain `playwright-cli` session
  with the saved `storageState` loaded serves the signed-in React views; build nothing for
  a selector or layout check.
- **Save a captured page byte for byte by piping it through `jq -j .`.**
  `playwright-cli --raw eval` prints its result as a JSON string literal, and `jq -r`
  would append a newline the page doesn't have.
- **For a markup check in Firefox, point `playwright-cli` at Playwright's cached Firefox
  with a `--config` file.** Its `--browser=firefox` fails when the CLI's bundled
  Playwright expects a Firefox build that isn't installed, as playwright-cli 0.1.22 did on
  2026-11-10. A config whose `browser.launchOptions.executablePath` names the build under
  `firefox-*/` in Playwright's browser cache (`~/Library/Caches/ms-playwright/` on macOS)
  works; never install a browser for a check.
