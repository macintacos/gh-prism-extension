import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import {
  type PrCodeOwners,
  type PrReviewer,
  readCodeOwners,
  readPrReviewers,
  type TeamMembersOf,
  teamMembersReader,
  withMemberTeams,
} from "@/utils/github/code-owners";
import { ownerOf } from "@/utils/github/files-route";
import { connectPrData } from "@/utils/github/pr-port";
import { type DiffRef, readDiffPin, readViewedSeed } from "@/utils/github/pr-ref";
import { hiddenKeyOf, hiddenKeysOf, isHidden, withHidden } from "@/utils/hidden-commits";
import { storedIntents } from "@/utils/intent/cache";
import {
  type IntentSources,
  intentFor,
  type PendingIntent,
  shareIntent,
} from "@/utils/intent/read";
import {
  type CommitMessageView,
  classicNoticeDismissed,
  commitColumnWidth,
  commitMessageView,
  type DiffstatView,
  diffstatView,
  hiddenCommitMessages,
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
import {
  type CommitMessageChoice,
  type CommitMessageVisit,
  showCommitMessage,
} from "./commit/message-view";
import { showReviewerFiles } from "./conversation/reviewer-files";
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
 * in for the diffstat, and on Conversation lists a code owner's files from their Reviewers sidebar
 * shield. On a commit's page, shows its message rendered as Markdown, above the diffs or in a
 * column beside them, with a switch to its plain text. On its classic Files changed page,
 * explains why gh-prism is off there.
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
    const [
      savedSide,
      savedDiffstat,
      savedCommitMessage,
      savedColumnWidth,
      savedHidden,
      dismissed,
      whatsNewForPage,
    ] = await Promise.all([
      readSavedSide(),
      readSavedDiffstat(),
      readSavedCommitMessage(),
      readSavedColumnWidth(),
      readHiddenMessages(),
      readNoticeDismissed(),
      release && followWhatsNew(release, ctx),
    ]);
    const side = sideChoiceOf(savedSide);
    const commitMessage = commitMessageChoiceOf(savedCommitMessage, savedColumnWidth);
    const hiddenMessages: HiddenMessages = { keys: hiddenKeysOf(savedHidden) };
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
          const teamMembers = teamMembersReader(fetch, visit);
          const prReviewers = readReviewersWithTeams(route.diff, codeOwners, {
            teamMembers,
            signal: visit,
          });
          // Route data is fresh only until GitHub's first navigation.
          const viewed = visitViewed(fullLoad ? readViewedSeed(document, route.diff) : undefined);
          fullLoad = false;
          const reportOptions = {
            repo: route.diff,
            diffUrl: location.origin + location.pathname,
            version,
          };
          const hiddenKey = route.diff.kind === "commit" ? hiddenKeyOf(route.diff) : undefined;
          const messageVisit: CommitMessageVisit = {
            since: performance.now(),
            hidden: hiddenKey !== undefined && isHidden(hiddenMessages.keys, hiddenKey),
          };
          const saveHidden = (hidden: boolean) => {
            if (hiddenKey) saveHiddenMessage(hiddenMessages, hiddenKey, hidden);
          };
          return (page, signal) => {
            showReportLink(page, signal, reportOptions);
            showOwnerSection(page, signal, {
              codeOwners,
              prReviewers,
              navigate: (href) => location.assign(href),
            });
            showVisit(page, signal, {
              intent,
              diffstat,
              viewed,
              codeOwners,
              prReviewers,
              teamMembers,
              owner: route.diff.kind === "pr" ? ownerOf(location.search) : undefined,
              whatsNew: whatsNewForPage?.(),
            });
            showCommitMessage(page, signal, {
              afterSections: afterLanding(intent),
              choice: commitMessage,
              save: saveCommitMessage,
              saveWidth: saveColumnWidth,
              saveHidden,
              visit: messageVisit,
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
        const teamMembers = teamMembersReader(fetch, visit);
        // Rides the header visit, so it runs only where findHeaderPage finds the counter's slot.
        showReviewerFiles(document, visit, {
          read: async () => {
            const codeOwners = readCodeOwners(pr, fetch, visit);
            const prReviewers = readReviewersWithTeams(pr, codeOwners, {
              teamMembers,
              signal: visit,
            });
            return { codeOwners: await codeOwners, prReviewers: await prReviewers };
          },
          teamMembers,
        });
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

/**
 * `diff`'s PR reviewers, each with the owning teams in `codeOwners` that list them as members,
 * read until `signal` aborts.
 */
async function readReviewersWithTeams(
  diff: DiffRef,
  codeOwners: Promise<PrCodeOwners | undefined>,
  { teamMembers, signal }: { teamMembers: TeamMembersOf; signal: AbortSignal },
): Promise<readonly PrReviewer[] | undefined> {
  const [reviewers, owners] = await Promise.all([readPrReviewers(diff, fetch, signal), codeOwners]);
  if (!reviewers || !owners) return reviewers;
  return withMemberTeams(reviewers, owners, async (team) => (await teamMembers(team))?.members);
}

// Keeps a slow intent read from holding GitHub's message box up.
const INTENT_WAIT_MS = 1000;
// Bounds how long GitHub's box shows on a busy page.
const IDLE_TIMEOUT_MS = 1000;

/**
 * Runs a task once `intent` settles, or `INTENT_WAIT_MS` passes, then once the browser is idle.
 * The sidebar's sections draw only once the intent lands.
 */
const afterLanding =
  (intent: PendingIntent) =>
  (task: () => void): void => {
    const schedule = () => requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
    const bound = new Promise((resolve) => setTimeout(resolve, INTENT_WAIT_MS));
    void Promise.race([Promise.resolve(intent(() => {})), bound]).then(schedule, schedule);
  };

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

/** The stored commit message view, unchecked, or the default when storage won't read. */
const readSavedCommitMessage = (): Promise<unknown> =>
  commitMessageView.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the commit message view failed", error);
    return commitMessageView.fallback;
  });

/** The stored commit message column width, unchecked, or the default when storage won't read. */
const readSavedColumnWidth = (): Promise<unknown> =>
  commitColumnWidth.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the commit message column's width failed", error);
    return commitColumnWidth.fallback;
  });

/**
 * The view a commit's message opens on and its column's width: `savedView` and `savedWidth`, when
 * each is one, else the defaults.
 */
function commitMessageChoiceOf(savedView: unknown, savedWidth: unknown): CommitMessageChoice {
  // `fallback` covers only a missing value; a corrupt one reads back as stored.
  const known = savedView === "rendered" || savedView === "plaintext";
  const knownWidth = typeof savedWidth === "number" && Number.isFinite(savedWidth);
  return {
    view: known ? savedView : commitMessageView.fallback,
    width: knownWidth ? savedWidth : commitColumnWidth.fallback,
  };
}

const saveCommitMessage = (view: CommitMessageView) =>
  commitMessageView
    .setValue(view)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the commit message view failed", error),
    );

const saveColumnWidth = (width: number) =>
  commitColumnWidth
    .setValue(width)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the commit message column's width failed", error),
    );

/** The commits whose message this tab knows are hidden, kept current as its visits hide them. */
interface HiddenMessages {
  keys: readonly string[];
}

/** The stored hidden commit messages, unchecked, or none when storage won't read. */
const readHiddenMessages = (): Promise<unknown> =>
  hiddenCommitMessages.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the hidden commit messages failed", error);
    return hiddenCommitMessages.fallback;
  });

/**
 * Records `key`'s commit message as `hidden` or shown in the tab's `hiddenMessages` and in storage,
 * read afresh so a pick another tab made since this one started survives.
 */
function saveHiddenMessage(hiddenMessages: HiddenMessages, key: string, hidden: boolean): void {
  hiddenMessages.keys = withHidden(hiddenMessages.keys, key, hidden);
  hiddenCommitMessages
    .getValue()
    .then((saved) => hiddenCommitMessages.setValue(withHidden(hiddenKeysOf(saved), key, hidden)))
    .catch((error: unknown) =>
      console.error("gh-prism: saving the hidden commit messages failed", error),
    );
}

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
