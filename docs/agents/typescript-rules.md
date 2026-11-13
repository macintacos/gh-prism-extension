# TypeScript Rules

*Audience: coding agents changing gh-prism's TypeScript, and the people who maintain these
rules.*

These rules govern TypeScript under `entrypoints/` and `utils/`. Rules for TypeScript that
imports a sheet or writes `tw:` classes are in [`styling-rules.md`](styling-rules.md).

## Function bodies

- **Split a body of 10 or more lines into steps separated by blank lines**: setup, build,
  wire listeners, mount, teardown, return. A body with no breaks hides where one step
  ends.
- **Group related module-level code, with each constant beside its only consumer.** A
  reader then finds a value where it is used.
- **Keep side-effect order exactly when a refactor regroups code.** Paragraphing and
  grouping change layout, never behavior.

## Persisted state

- **Persist through `wxt/utils/storage`, never hand-rolled `chrome.storage` or
  `localStorage`.** It types each item and handles its migrations.
- **Keep preferences in [`utils/prefs.ts`](../../utils/prefs.ts), and change a stored key
  or value only through the item's `version` and `migrations`.** Stored values persist
  across updates.
- **List a new kind of stored data in
  [`README.md` § Permissions](../../README.md#permissions) in the same change.** The
  `storage` permission already exists, so that line is the only other change needed.
- **Retire a released key by removing it, not by leaving it.** A key no item reads any
  more still sits in users' browsers. Name it in `utils/prefs.ts` and remove it with
  `storage.removeItem` in the background's `runtime.onInstalled` listener, beside
  `forgetIntents`, and keep that removal.

## Workers

- **Give a dedicated Worker script no `browser.*` and no `wxt/browser` import.** A Worker
  has no extension API, so it derives a packaged file's URL from `self.location`, as
  [`structural-engine.ts`](../../entrypoints/structural-engine.ts) does.
- **Give an HTML entrypoint's `<script>` the `wxt-ignore` attribute.** Without it, a dev
  build points the script at the dev server, and the page runs nothing once that server
  stops, while the dev Chrome and its registered content scripts live on. The offscreen
  document then answered no request, and every file the engine compares showed the
  `failed` notice.
  [`tests/structural-offscreen-page.test.ts`](../../tests/structural-offscreen-page.test.ts)
  runs WXT's dev rewrite over the page.

## Failures

- **Warn with a `gh-prism:` line at every exit that answers a read or a Structural file
  `failed`.** `failed` names no cause, and the notice it puts on a file says only that
  Structural mode couldn't compare it, so the warning is the only record of which exit
  fired. An exit that answers a more specific problem, such as `no-access`, needs none.

## Firefox

- **Never let a content script define a custom element.** Firefox hands content scripts
  the page's registry, and a definition there gives the script its own `Element` and
  `Node`. Every `instanceof` against a page node then fails.
  [`sidebar/custom-elements-stub.ts`](../../entrypoints/content/sidebar/custom-elements-stub.ts)
  stubs the registry.
- **Branch on `import.meta.env.BROWSER === "firefox"`, never `import.meta.env.FIREFOX`.**
  Vitest reads `FIREFOX` as the string `"false"`, which is truthy.
- **Parse markup with `new DOMParser().parseFromString(html, "text/html")`.** AMO's linter
  warns when non-literal markup is assigned to `innerHTML` or `outerHTML`, or passed to
  `insertAdjacentHTML`, `createContextualFragment`, `setHTMLUnsafe`, or `document.write`,
  but not to `DOMParser`, whose nodes survive adoption into a shadow root behind Firefox's
  Xrays. Prefix a fragment with `<body>` whenever you read its nodes from `.body`: without
  it the parser moves leading head content, such as `<style>`, `<script>`, `<template>`,
  or a comment, out of `.body`. `parseSpriteSheet` in the `@pierre/trees` patch is the
  pattern for querying the parsed document, and `setSlotHtml` for moving a fragment's
  nodes.
