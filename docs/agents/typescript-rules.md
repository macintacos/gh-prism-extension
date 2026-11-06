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
  Xrays. Prefix a fragment with `<body>` when it may open with `<style>`, `<link>`, or
  `<meta>`, which the parser otherwise moves into the parsed `<head>`, out of `.body`.
  `parseSpriteSheet` in the `@pierre/trees` patch is the pattern.
