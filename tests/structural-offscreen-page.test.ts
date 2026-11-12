import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE = `${ROOT}entrypoints/structural-offscreen/index.html`;
const DEV_SERVER = "http://localhost:3000";

/** The part of WXT's dev-server plugin this test runs: its rewrite of one HTML entrypoint. */
interface DevHtmlPrerender {
  devHtmlPrerender(
    config: object,
    server: object,
  ): [{ transform: { handler(code: string, id: string): string } }];
}

// Not in wxt's exports, and it ships no types: the rewrite `wxt` runs over each HTML entrypoint
// while its dev server is up.
const PRERENDER = new URL(
  "../node_modules/wxt/dist/core/builders/vite/plugins/devHtmlPrerender.mjs",
  import.meta.url,
).href;

/** `PAGE` as a dev build writes it, before Vite bundles the scripts it left in the package. */
async function devPage(): Promise<string> {
  const { devHtmlPrerender }: DevHtmlPrerender = await import(/* @vite-ignore */ PRERENDER);

  const [prerender] = devHtmlPrerender(
    { command: "serve", root: ROOT, alias: {}, wxtModuleDir: ROOT, logger: { debug() {} } },
    { origin: DEV_SERVER },
  );
  return prerender.transform.handler(readFileSync(PAGE, "utf8"), PAGE);
}

describe("the structural offscreen page", () => {
  // A dev Chrome outlives its dev server, and a page whose script the server held would then
  // answer no request: every file the engine compares would show the "couldn't compare" notice.
  it("keeps its script in the extension package under the dev server", async () => {
    const page = await devPage();

    expect(page).toContain('src="./main.ts"');
    expect(page).not.toContain(`${DEV_SERVER}/entrypoints`);
  });
});
