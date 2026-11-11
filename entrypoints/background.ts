import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import { CONVERSATION_FRAME_PORT, conversationFraming } from "../utils/github/conversation-frame";
import { PR_DATA_PORT, servePrDataPort } from "../utils/github/pr-port";
import { createPrDataSource } from "../utils/github/pr-source";
import { forgetIntents } from "../utils/intent/cache";
import { RETIRED_HIDDEN_COMMITS, whatsNewSeen } from "../utils/prefs";
import { yieldToMessages } from "../utils/structural/engine-script";
import { engineThread } from "../utils/structural/engine-thread";
import { CACHED_SPANS, type FileChanges, fileChanges } from "../utils/structural/file-changes";
import { structuralHost } from "../utils/structural/host";
import { dismissWhatsNew } from "../utils/whats-new";

/**
 * Serves pull request data, a file's structural changes among it, to content scripts, lets a tab's Conversation panel frame its pull
 * request's Conversation tab, clears the intent cache and retired storage keys on install, and
 * marks a fresh install's what's-new notes dismissed.
 */
export default defineBackground(() => {
  // Intents clear on installs, updates, and dev reloads alike: a new build may place files
  // differently. Only a fresh install marks the notes, so an update still shows them.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void forgetIntents(storage);
    void storage
      .removeItem(RETIRED_HIDDEN_COMMITS)
      .catch((error: unknown) =>
        console.error("gh-prism: removing the retired hidden commit list failed", error),
      );
    if (reason !== "install") return;
    void whatsNewSeen
      .setValue(dismissWhatsNew({}, browser.runtime.getManifest().version))
      .catch((error: unknown) =>
        console.error("gh-prism: saving the what's-new mark failed", error),
      );
  });
  // A fetch called as a method of anything but the global throws "Illegal invocation".
  const source = createPrDataSource((input, init) => fetch(input, init));
  const framing = conversationFraming({
    update: (options) => browser.declarativeNetRequest.updateSessionRules(options),
  });
  // Built on the first structural request, so a worker that never gets one constructs nothing.
  let changes: FileChanges | undefined;
  const structural: FileChanges = (pr, path, signal) => {
    changes ??= fileChanges({
      source,
      run: structuralHost({ engine: engineThread(), pause: yieldToMessages }),
      cachedSpans: CACHED_SPANS,
    });
    return changes(pr, path, signal);
  };
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === PR_DATA_PORT) servePrDataPort(port, source, structural);
    if (port.name === CONVERSATION_FRAME_PORT) framing.serve(port);
  });
  browser.tabs.onRemoved.addListener((tabId) => framing.forget(tabId));
});
