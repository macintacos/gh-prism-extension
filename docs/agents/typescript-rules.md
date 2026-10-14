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
  grouping change layout, never behaviour.

## Persisted state

- **Persist through `wxt/utils/storage`, never hand-rolled `chrome.storage` or
  `localStorage`.** It types each item and handles its migrations.
- **Keep preferences in [`utils/prefs.ts`](../../utils/prefs.ts), and change a stored key
  or value only through the item's `version` and `migrations`.** Stored values persist
  across updates.
- **List a new kind of stored data in
  [`README.md` § Permissions](../../README.md#permissions) in the same change.** The
  `storage` permission already exists, so that line is the only other change needed.
