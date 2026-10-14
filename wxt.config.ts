import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

// Outside the repo so the GitHub login survives `wxt clean` and is shared by every worktree, so only one
// `mise run dev` can hold it at a time. web-ext passes --use-mock-keychain: its cookies are not Keychain-protected.
const chromeProfile = join(homedir(), ".local/share/gh-prism-extension/chrome-profile");

export default defineConfig({
  imports: false,
  hooks: {
    // web-ext fails with ENOENT unless the profile directory already exists.
    "server:created": () => {
      mkdirSync(chromeProfile, { recursive: true, mode: 0o700 });
    },
  },
  manifest: {
    // Remembers which side the file sidebar docks on, and caches where each diff's files land.
    permissions: ["storage"],
    // github.com's .diff and raw/ URLs redirect to these two githubusercontent hosts.
    host_permissions: [
      "https://github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
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
    keepProfileChanges: true,
  },
});
