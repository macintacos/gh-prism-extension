import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Outside the repo so the GitHub login survives `wxt clean` and is shared by every worktree, so only one
// `mise run dev` can hold each at a time. Keep in sync with .mise/tasks/dev, which closes a browser already
// holding one.
// web-ext passes Chrome --use-mock-keychain: its cookies are not Keychain-protected.
const chromeProfile = join(homedir(), ".local/share/gh-prism-extension/chrome-profile");
const firefoxProfile = join(homedir(), ".local/share/gh-prism-extension/firefox-profile");

export default defineConfig({
  imports: false,
  // WXT defaults Firefox to MV2.
  manifestVersion: 3,
  hooks: {
    // web-ext needs each profile directory to exist: Chrome fails with ENOENT, and Firefox reads a missing path
    // as a profile name.
    "server:created": () => {
      for (const profile of [chromeProfile, firefoxProfile])
        mkdirSync(profile, { recursive: true, mode: 0o700 });
    },
  },
  manifest: ({ browser }) => ({
    // The Chrome Web Store's title, which its search weighs. The release zip keeps package.json's name.
    name: "gh-prism: Sectioned Pull Request Review",
    // storage holds preferences, the what's-new state, and the intent cache.
    // declarativeNetRequestWithHostAccess lifts GitHub's framing refusal for the Conversation
    // panel's frame only; unlike declarativeNetRequest it adds no install warning, so an update
    // doesn't disable gh-prism.
    permissions: ["storage", "declarativeNetRequestWithHostAccess"],
    // github.com's .diff and raw/ URLs redirect to these two githubusercontent hosts.
    host_permissions: [
      "https://github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              // Permanent: Firefox keys stored data and the AMO listing to it.
              id: "gh-prism@excessive.dev",
              // CSS anchor positioning (sidebar/side.css) needs 147, gh-prism's highest floor.
              strict_min_version: "147.0",
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : {}),
  }),
  vite: ({ browser }) => ({
    plugins: [tailwindcss()],
    build: {
      // light-dark() landed in Chrome 123. Under Vite's older default, the CSS minifier rewrites it into a fallback
      // that reads only a color-scheme set in gh-prism's own sheets, never GitHub's. Firefox 147 is the manifest's
      // floor, and Lightning CSS lowers nothing gh-prism uses at that target.
      cssTarget: browser === "firefox" ? "firefox147" : "chrome123",
      rolldownOptions: {
        // Dev builds emit sourcemaps, but @tailwindcss/vite returns none for the sheets it compiles. Every sheet is
        // imported ?inline as a JS string, so its map is never read.
        onLog(level, log, handler) {
          if (log.code === "SOURCEMAP_BROKEN" && log.plugin === "@tailwindcss/vite:generate:build")
            return;
          handler(level, log);
        },
      },
    },
  }),
  webExt: {
    chromiumProfile: chromeProfile,
    firefoxProfile,
    keepProfileChanges: true,
  },
});
