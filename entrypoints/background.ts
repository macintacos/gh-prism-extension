import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { storage } from "wxt/utils/storage";
import { CONVERSATION_FRAME_PORT, conversationFraming } from "../utils/github/conversation-frame";
import { PR_DATA_PORT, servePrDataPort } from "../utils/github/pr-port";
import { createPrDataSource } from "../utils/github/pr-source";
import { forgetIntents } from "../utils/intent/cache";
import {
  installedWithOnboarding,
  onboarded,
  RETIRED_HIDDEN_COMMITS,
  structuralIntroDismissed,
  whatsNewSeen,
} from "../utils/prefs";
import { yieldToMessages } from "../utils/structural/engine-script";
import { engineThread } from "../utils/structural/engine-thread";
import { CACHED_SPANS, type FileChanges, fileChanges } from "../utils/structural/file-changes";
import { structuralHost } from "../utils/structural/host";
import { dismissWhatsNew } from "../utils/whats-new";

/**
 * Serves pull request data and, on request, a file's structural changes to content scripts, lets
 * a tab's Conversation panel frame its pull request's Conversation tab, clears the intent cache
 * and retired storage keys on install, and marks a fresh install's what's-new notes and Structural
 * popup dismissed.
 */
export default defineBackground(() => {
  // Intents clear on installs, updates, and dev reloads alike: a new build may place files
  // differently. Only a fresh install marks the notes and the popup, so an update still shows them.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    void forgetIntents(storage);
    void storage
      .removeItem(RETIRED_HIDDEN_COMMITS)
      .catch((error: unknown) =>
        console.error("gh-prism: removing the retired hidden commit list failed", error),
      );
    void settleOnboarding(reason).catch((error: unknown) =>
      console.error("gh-prism: settling the onboarding failed", error),
    );
    if (reason !== "install") return;
    void whatsNewSeen
      .setValue(dismissWhatsNew({}, browser.runtime.getManifest().version))
      .catch((error: unknown) =>
        console.error("gh-prism: saving the what's-new mark failed", error),
      );
    void structuralIntroDismissed
      .setValue(true)
      .catch((error: unknown) =>
        console.error("gh-prism: saving the Structural popup's dismissal failed", error),
      );
  });
  if (import.meta.env.DEV) {
    browser.runtime.onStartup.addListener(() => {
      void applyDevOnboarding(import.meta.env.WXT_DEV_ONBOARDING).catch((error: unknown) =>
        console.error("gh-prism: applying the dev onboarding flag failed", error),
      );
    });
  }
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

/**
 * Marks a fresh install as this browser's new user, and stores the sidebar as revealed on an
 * update without that mark: that user had gh-prism before the onboarding shipped.
 */
async function settleOnboarding(reason: string): Promise<void> {
  if (reason === "install") await installedWithOnboarding.setValue(true);
  else if (reason === "update" && !(await installedWithOnboarding.getValue())) {
    await onboarded.setValue(true);
  }

  // After the rule above, so a dev reload ends in the state `mise run dev` asked for.
  if (import.meta.env.DEV) await applyDevOnboarding(import.meta.env.WXT_DEV_ONBOARDING);
}

/** Puts the onboarding in the state `mise run dev` asked for, if any. */
async function applyDevOnboarding(flag: unknown): Promise<void> {
  if (flag === "fresh") {
    await Promise.all([onboarded.removeValue(), installedWithOnboarding.setValue(true)]);
  } else if (flag === "tenured") await onboarded.setValue(true);
}
