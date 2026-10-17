import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import { PR_DATA_PORT, servePrDataPort } from "../utils/github/pr-port";
import { createPrDataSource } from "../utils/github/pr-source";
import { forgetIntents } from "../utils/intent/cache";

/**
 * Serves pull request data to content scripts, clears the intent cache on install, and opens the
 * welcome page on a first install.
 */
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(({ reason }) => {
    // Installs, updates, and dev reloads alike: a new build may place files differently.
    void forgetIntents(storage);
    if (reason === "install")
      void browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") });
  });
  // A fetch called as a method of anything but the global throws "Illegal invocation".
  const source = createPrDataSource((input, init) => fetch(input, init));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) servePrDataPort(port, source);
  });
});
