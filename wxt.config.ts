import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "wxt";

// Outside the repo so the GitHub login survives `wxt clean` and is shared by every worktree, so only one
// `mise run dev` can hold it at a time. web-ext passes --use-mock-keychain: its cookies are not Keychain-protected.
const chromeProfile = join(homedir(), ".local/share/gh-prism-extension/chrome-profile");

export default defineConfig({
  hooks: {
    // web-ext fails with ENOENT unless the profile directory already exists.
    "server:created": () => {
      mkdirSync(chromeProfile, { recursive: true, mode: 0o700 });
    },
  },
  manifest: {
    // github.com's .diff and raw/ URLs redirect to these two githubusercontent hosts.
    host_permissions: [
      "https://github.com/*",
      "https://patch-diff.githubusercontent.com/*",
      "https://raw.githubusercontent.com/*",
    ],
  },
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
  },
});
