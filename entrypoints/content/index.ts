import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import { readCodeOwners } from "@/utils/github/code-owners";
import { ownerOf } from "@/utils/github/files-route";
import { connectPrData } from "@/utils/github/pr-port";
import { readDiffPin, readViewedSeed } from "@/utils/github/pr-ref";
import { storedIntents } from "@/utils/intent/cache";
import { type IntentSources, intentFor, shareIntent } from "@/utils/intent/read";
import {
  classicNoticeDismissed,
  type DiffstatView,
  diffstatView,
  sidebarSide,
  whatsNewSeen,
} from "@/utils/prefs";
import {
  dismissWhatsNew,
  type WhatsNewState,
  whatsNewAt,
  whatsNewStateOf,
} from "@/utils/whats-new";
import { type NoticeChoice, showClassicNotice } from "./classic/notice";
import { visitViewed } from "./diffs/viewed";
import type { DiffstatChoice, DiffstatOptions } from "./header/diffstat-view";
import { showOwnerSection } from "./sidebar/owner-section";
import { showReportLink } from "./sidebar/report";
import { dockSidebar, type Side, type SideChoice } from "./sidebar/side";
import type { WhatsNew } from "./sidebar/whats-new";
import { showHeaderTab, showVisit } from "./visit/land";
import { watchClassicPages, watchFilesPages, watchHeaderPages } from "./visit/watch";

const CACHED_DIFFS = 50;

/**
 * On every Files view on github.com, shows the sidebar's sections, narrowed on a pull request to
 * the `gh-prism-owner` owner's files when set, orders the diffs to match, stands in for the
 * diffstat, docks the sidebar on the saved side with a switch, adds a link to report a
 * miscategorized file, adds an "Only files owned by…" section to GitHub's filter menu, and, after
 * an update, opens the sidebar with that release's notes. On a pull request's header tabs, stands
 * in for the diffstat alone. On its classic Files changed page, explains why gh-prism is off
 * there.
 */
export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  runAt: "document_start",
  async main(ctx) {
    const version = browser.runtime.getManifest().version;
    const sources = {
      connect: connectPrData,
      cache: storedIntents(storage, CACHED_DIFFS),
      pinOf: (diff) => readDiffPin(document, diff),
    } satisfies IntentSources;
    const release = releaseOf(import.meta.env.WXT_RELEASE_NOTES, version);
    // Read before watching, so a saved side, view, or dismissal never shows its default first.
    const [savedSide, savedDiffstat, dismissed, whatsNewForPage] = await Promise.all([
      readSavedSide(),
      readSavedDiffstat(),
      readNoticeDismissed(),
      release && followWhatsNew(release, ctx),
    ]);
    const side = sideChoiceOf(savedSide);
    // Shared by every visit, so a switch on one tab or page carries to the next.
    const diffstat = {
      choice: diffstatChoiceOf(savedDiffstat),
      save: saveDiffstat,
    } satisfies DiffstatOptions;
    const notice: NoticeChoice = { dismissed };
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
          const codeOwners = readCodeOwners(route.diff, fetch, visit);
          // Route data is fresh only until GitHub's first navigation.
          const viewed = visitViewed(fullLoad ? readViewedSeed(document, route.diff) : undefined);
          fullLoad = false;
          const reportOptions = {
            repo: route.diff,
            diffUrl: location.origin + location.pathname,
            version,
          };
          return (page, signal) => {
            showReportLink(page, signal, reportOptions);
            showOwnerSection(page, signal, {
              codeOwners,
              navigate: (href) => location.assign(href),
            });
            showVisit(page, signal, {
              intent,
              diffstat,
              viewed,
              codeOwners,
              owner: route.diff.kind === "pr" ? ownerOf(location.search) : undefined,
              whatsNew: whatsNewForPage?.(),
            });
            dockSidebar(page, signal, { choice: side, save: saveSide });
          };
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
    watchHeaderPages(
      window,
      (pr, visit) => {
        const intent = shareIntent((onProgress) =>
          intentFor({ diff: pr, commitFiltered: false }, visit, sources, onProgress),
        );
        return (page, signal) => showHeaderTab(page, signal, { intent, diffstat });
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

/** The stored diffstat view, unchecked, or the default when storage won't read. */
const readSavedDiffstat = (): Promise<unknown> =>
  diffstatView.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the diffstat view failed", error);
    return diffstatView.fallback;
  });

/** The view the header counter opens on: `saved`, when it names one, else the default. */
function diffstatChoiceOf(saved: unknown): DiffstatChoice {
  // `fallback` covers only a missing view; a corrupt one reads back as stored.
  return { view: saved === "breakout" || saved === "total" ? saved : diffstatView.fallback };
}

const saveDiffstat = (view: DiffstatView) =>
  diffstatView
    .setValue(view)
    .catch((error: unknown) => console.error("gh-prism: saving the diffstat view failed", error));

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

interface Release {
  readonly version: string;
  readonly notes: string;
}

/** The release whose notes this build carries; none for a build without notes. */
function releaseOf(notes: unknown, version: string): Release | undefined {
  return typeof notes === "string" && notes !== "" ? { version, notes } : undefined;
}

/** The tab's latest what's-new state, kept current across tabs. */
interface WhatsNewChoice {
  state: WhatsNewState;
}

/**
 * Each page's block for `release`, from stored state kept current across tabs until `ctx` ends.
 * A version hidden at startup never shows again, so its tab skips the watch.
 */
async function followWhatsNew(release: Release, ctx: ContentScriptContext) {
  const choice: WhatsNewChoice = { state: whatsNewStateOf(await readWhatsNew()) };
  if (whatsNewAt(choice.state, release.version, Date.now()).shows) {
    ctx.onInvalidated(whatsNewSeen.watch((saved) => (choice.state = whatsNewStateOf(saved))));
  }
  return () => whatsNewOn(choice, release);
}

/** The stored what's-new state, unchecked, or the default when storage won't read. */
const readWhatsNew = (): Promise<unknown> =>
  whatsNewSeen.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the what's-new state failed", error);
    return whatsNewSeen.fallback;
  });

const saveWhatsNew = (state: WhatsNewState) =>
  whatsNewSeen
    .setValue(state)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the what's-new state failed", error),
    );

/** `release`'s block for this page, when it shows; stores the stamp a first showing makes. */
function whatsNewOn(choice: WhatsNewChoice, release: Release): WhatsNew | undefined {
  const { version } = release;
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
  return { ...release, dismiss };
}
