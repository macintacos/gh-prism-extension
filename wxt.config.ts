import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "wxt";

// Outside the repo so the GitHub login survives `wxt clean` and is shared by every worktree.
const chromeProfile = join(homedir(), ".local/share/gh-prism-extension/chrome-profile");

export default defineConfig({
  hooks: {
    // web-ext fails with ENOENT unless the profile directory already exists.
    "server:created": () => {
      mkdirSync(chromeProfile, { recursive: true });
    },
  },
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
  },
});
