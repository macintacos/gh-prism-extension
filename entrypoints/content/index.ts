import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import { connectPrData } from "@/utils/github/pr-port";
import { readDiffPin, readViewedSeed } from "@/utils/github/pr-ref";
import { storedIntents } from "@/utils/intent/cache";
import { type IntentSources, intentFor, shareIntent } from "@/utils/intent/read";
import { classicNoticeDismissed, sidebarSide, whatsNewSeen } from "@/utils/prefs";
import {
  dismissWhatsNew,
  type WhatsNewState,
  whatsNewAt,
  whatsNewStateOf,
} from "@/utils/whats-new";
import { type NoticeChoice, showClassicNotice } from "./classic/notice";
import { visitViewed } from "./diffs/viewed";
import type { DiffstatChoice } from "./header/diffstat-view";
import { dockSidebar, type Side, type SideChoice } from "./sidebar/side";
import type { WhatsNew } from "./sidebar/whats-new";
import { showVisit } from "./visit/land";
import { watchClassicPages, watchFilesPages } from "./visit/watch";

const CACHED_DIFFS = 50;

/**
 * On every Files view on github.com, shows the sidebar's sections, orders the diffs to match,
 * stands in for the diffstat, and docks the sidebar on the saved side with a switch. On a pull
 * request's classic Files changed page, explains why gh-prism is off there.
 */
export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  runAt: "document_start",
  async main(ctx) {
    const diffstat: DiffstatChoice = { view: "breakout" };
    const sources = {
      connect: connectPrData,
      cache: storedIntents(storage, CACHED_DIFFS),
      pinOf: (diff) => readDiffPin(document, diff),
    } satisfies IntentSources;
    // Read before watching, so a saved side or dismissal never shows its default first.
    const env: unknown = import.meta.env.WXT_RELEASE_NOTES;
    const notes = typeof env === "string" ? env : "";
    const version = notes ? browser.runtime.getManifest().version : "";
    const [savedSide, dismissed, savedWhatsNew] = await Promise.all([
      readSavedSide(),
      readNoticeDismissed(),
      notes ? readWhatsNew() : {},
    ]);
    const side = sideChoiceOf(savedSide);
    const notice: NoticeChoice = { dismissed };
    const whatsNew: WhatsNewChoice = { state: whatsNewStateOf(savedWhatsNew) };
    if (notes) {
      ctx.onInvalidated(whatsNewSeen.watch((saved) => (whatsNew.state = whatsNewStateOf(saved))));
    }
    let fullLoad = true;
    // Registered before watchFilesPages, so the flag clears before a navigation's visit runs.
    const navigated = () => (fullLoad = false);
    document.addEventListener("soft-nav:end", navigated, { once: true, signal: ctx.signal });
    window.addEventListener("popstate", navigated, { once: true, signal: ctx.signal });

    watchFilesPages(
      window,
      {
        onVisit: (route, visit) => {
          const intent = shareIntent((onProgress) => intentFor(route, visit, sources, onProgress));
          // Route data is fresh only until GitHub's first navigation.
          const viewed = visitViewed(fullLoad ? readViewedSeed(document, route.diff) : undefined);
          fullLoad = false;
          return (page, signal) => {
            showVisit(page, signal, {
              intent,
              diffstat,
              viewed,
              whatsNew: notes ? whatsNewOn(whatsNew, version, notes) : undefined,
            });
            dockSidebar(page, signal, { choice: side, save: saveSide });
          };
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
    watchClassicPages(
      window,
      (page, signal) => showClassicNotice(page, signal, { choice: notice, save: saveDismissed }),
      ctx.signal,
    );
  },
});

/** The stored sidebar side, unchecked, or the default when storage won't read. */
const readSavedSide = (): Promise<unknown> =>
  sidebarSide.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the sidebar side failed", error);
    return sidebarSide.fallback;
  });

/** The side to dock on: `saved`, when it names one, else the default. */
function sideChoiceOf(saved: unknown): SideChoice {
  // `fallback` covers only a missing side; a corrupt one reads back as stored.
  return { side: saved === "left" || saved === "right" ? saved : sidebarSide.fallback };
}

const saveSide = (picked: Side) =>
  sidebarSide
    .setValue(picked)
    .catch((error: unknown) => console.error("gh-prism: saving the sidebar side failed", error));

/** Whether the user dismissed the classic page's notice; not, when storage won't read. */
const readNoticeDismissed = (): Promise<boolean> =>
  classicNoticeDismissed
    .getValue()
    .then((saved: unknown) => saved === true)
    .catch((error: unknown) => {
      console.error("gh-prism: reading the notice's dismissal failed", error);
      return false;
    });

const saveDismissed = () =>
  classicNoticeDismissed
    .setValue(true)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the notice's dismissal failed", error),
    );

/** The tab's latest what's-new state, kept current across tabs. */
type WhatsNewChoice = { state: WhatsNewState };

/** The stored what's-new state, unchecked, or none when storage won't read. */
const readWhatsNew = (): Promise<unknown> =>
  whatsNewSeen.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading what's new failed", error);
    return {};
  });

const saveWhatsNew = (state: WhatsNewState) =>
  whatsNewSeen
    .setValue(state)
    .catch((error: unknown) => console.error("gh-prism: saving what's new failed", error));

/** `version`'s block for this page, when it shows; stores the stamp a first showing makes. */
function whatsNewOn(choice: WhatsNewChoice, version: string, notes: string): WhatsNew | undefined {
  const { shows, state } = whatsNewAt(choice.state, version, Date.now());
  if (state !== choice.state) {
    choice.state = state;
    void saveWhatsNew(state);
  }
  if (!shows) return undefined;
  const dismiss = () => {
    choice.state = dismissWhatsNew(choice.state, version);
    void saveWhatsNew(choice.state);
  };
  return { version, notes, dismiss };
}
