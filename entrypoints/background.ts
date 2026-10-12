import { storage } from "wxt/utils/storage";
import { forgetIntents } from "../utils/intent-cache";
import { PR_DATA_PORT, servePrDataPort } from "../utils/pr-port";
import { createPrDataSource } from "../utils/pr-source";

export default defineBackground(() => {
  // Installs, updates, and dev reloads alike: a new build may place files differently.
  browser.runtime.onInstalled.addListener(() => void forgetIntents(storage));
  // A fetch called as a method of anything but the global throws "Illegal invocation".
  const source = createPrDataSource((input, init) => fetch(input, init));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) servePrDataPort(port, source);
  });
});
