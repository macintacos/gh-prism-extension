/**
 * Offline proof that `withLayoutRestored` puts the saved Layout back, on success and on a thrown
 * failure, against a stubbed Layout write: no browser, no account.
 *
 *   bun bench/structural-mode-live/restore-check.ts
 */

import { strict as assert } from "node:assert";
import { type Layout, withLayoutRestored } from "./layout";

function stub(saved: Layout) {
  const writes: Layout[] = [];
  return {
    writes,
    saved: () => saved,
    layout: {
      read: async () => saved,
      choose: async (to: Layout) => {
        writes.push(to);
        saved = to;
      },
    },
  };
}

for (const original of ["split", "unified"] as const) {
  const ok = stub(original);
  await withLayoutRestored(ok.layout, async () => ok.layout.choose("unified"));
  assert.equal(ok.saved(), original, `success from ${original}`);
  assert.equal(ok.writes.at(-1), original);

  const failed = stub(original);
  await assert.rejects(
    withLayoutRestored(failed.layout, async () => {
      await failed.layout.choose("unified");
      throw new Error("assertion failed mid-pass");
    }),
    /mid-pass/,
  );
  assert.equal(failed.saved(), original, `failure from ${original}`);
  assert.equal(failed.writes.at(-1), original);
}
console.log("restore: ok");
