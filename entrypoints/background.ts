import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import { PR_DATA_PORT, servePrDataPort } from "../utils/github/pr-port";
import { createPrDataSource } from "../utils/github/pr-source";
import { forgetIntents } from "../utils/intent/cache";
import { whatsNewSeen } from "../utils/prefs";
import { dismissWhatsNew } from "../utils/whats-new";

/**
 * Serves pull request data to content scripts, clears the intent cache on install, and marks a
 * fresh install's what's-new notes dismissed.
 */
export default defineBackground(() => {
  // Intents clear on installs, updates, and dev reloads alike: a new build may place files
  // differently. Only a fresh install marks the notes, so an update still shows them.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void forgetIntents(storage);
    if (reason !== "install") return;
    void whatsNewSeen
      .setValue(dismissWhatsNew({}, browser.runtime.getManifest().version))
      .catch((error: unknown) =>
        console.error("gh-prism: saving the what's-new mark failed", error),
      );
  });
  // A fetch called as a method of anything but the global throws "Illegal invocation".
  const source = createPrDataSource((input, init) => fetch(input, init));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) servePrDataPort(port, source);
  });
});
