import { browser } from "wxt/browser";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import {
  readCodeOwners,
  readOwnership,
  readReviewersWithTeams,
  teamAvatarReader,
  teamMembersReader,
} from "@/utils/github/code-owners";
import { allowConversationFrame } from "@/utils/github/conversation-frame";
import { ownerFilterLink, ownerOf } from "@/utils/github/files-route";
import { type NextCommit, readNextCommit } from "@/utils/github/next-commit";
import { connectPrData, type PrDataClient } from "@/utils/github/pr-port";
import {
  type CommitHead,
  prKeyOf,
  readDiffPin,
  readGeneratedPaths,
  readViewedSeed,
} from "@/utils/github/pr-ref";
import { teamRosterReader } from "@/utils/github/team-roster";
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
  commitMessageHidden,
  commitMessageView,
  conversationOpen,
  conversationPinned,
  conversationWidth,
  type DiffstatView,
  diffstatView,
  sidebarSide,
  structuralMode,
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
import { type StepLinksOptions, showStepLinks } from "./commit/step-links";
import {
  type ConversationChoice,
  conversationPanel,
  fitsPinned,
  showConversationButton,
} from "./conversation/panel";
import { showReviewerFiles } from "./conversation/reviewer-files";
import { hashLanding } from "./diffs/reveal";
import { structuralFiles } from "./diffs/structural-files";
import type { StructuralMode } from "./diffs/structural-mode";
import { visitViewed } from "./diffs/viewed";
import { findCommentAuthors, findFilesCommentAuthors, followRightPanel } from "./files-page";
import type { DiffstatChoice, DiffstatOptions } from "./header/diffstat-view";
import { showOwnerSection } from "./sidebar/owner-section";
import { showReportLink } from "./sidebar/report";
import { dockSidebar, type Side, type SideChoice } from "./sidebar/side";
import type { WhatsNew } from "./sidebar/whats-new";
import { prOwnersPressGuard, showPrOwnersButton } from "./ui/pr-owners";
import { showHeaderTab, showVisit } from "./visit/land";
import { watchClassicPages, watchFilesPages, watchHeaderPages } from "./visit/watch";

const CACHED_DIFFS = 50;

/**
 * On every Files view on github.com, shows the sidebar's sections, narrowed on a pull request to
 * the `gh-prism-owner` owner's files when set, orders the diffs to match, stands in for the
 * diffstat, docks the sidebar on the saved side with a switch, adds a link to report a
 * miscategorized file, adds an "Only files owned by…" section to GitHub's filter menu, on a pull
 * request adds a button opening its Conversation in a panel, and, after an update, opens the
 * sidebar with that release's notes. On a pull request's header tabs, stands in for the diffstat,
 * and on Conversation lists a code owner's files from their Reviewers sidebar shield. On
 * Conversation and Files changed, lists them from the shield beside their comments. On a commit's
 * page, shows its message rendered as Markdown, above the diffs or in a column beside them, with a
 * switch to its plain text and a toolbar toggle that hides it. On a pull request's classic Files
 * changed page, explains why gh-prism is off there, and shields its review comment authors.
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
      generatedOf: (diff) => readGeneratedPaths(document, diff),
    } satisfies IntentSources;
    const release = releaseOf(import.meta.env.WXT_RELEASE_NOTES, version);
    // Read before watching, so a saved side, view, or dismissal never shows its default first.
    const [
      savedSide,
      savedDiffstat,
      savedCommitMessage,
      savedColumnWidth,
      savedHidden,
      savedPinned,
      savedOpen,
      savedConversationWidth,
      dismissed,
      savedStructural,
      whatsNewForPage,
    ] = await Promise.all([
      readSavedSide(),
      readSavedDiffstat(),
      readSavedCommitMessage(),
      readSavedColumnWidth(),
      readSavedHidden(),
      readSavedPinned(),
      readSavedOpen(),
      readSavedConversationWidth(),
      readNoticeDismissed(),
      readSavedStructural(),
      release && followWhatsNew(release, ctx),
    ]);
    const side = sideChoiceOf(savedSide);
    const commitMessage = commitMessageChoiceOf(savedCommitMessage, savedColumnWidth);
    // Shared by every visit, so a soft navigation to another commit opens as the reader last left it.
    const messageHidden = { hidden: savedHidden === true };
    const seenChildren: SeenChildren = new Map();
    // Shared by every visit, so a switch on one tab or page carries to the next.
    const diffstat = {
      choice: diffstatChoiceOf(savedDiffstat),
      save: saveDiffstat,
    } satisfies DiffstatOptions;
    // Shared by every visit; a later control reads and sets it.
    const structural: StructuralChoice = {
      choice: { on: savedStructural === true },
      save: saveStructural,
    };
    const notice: NoticeChoice = { dismissed };
    const conversation = conversationChoiceOf(
      { pinned: savedPinned, open: savedOpen, width: savedConversationWidth },
      fitsPinned(window),
    );
    const navigate = (href: string) => location.assign(href);
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
          // A commit filter's breakout isn't the one the pull request's header tabs show.
          const visitDiffstat = {
            ...diffstat,
            pr: route.diff.kind === "pr" && !route.commitFiltered ? prKeyOf(route.diff) : undefined,
          };
          const codeOwners = readCodeOwners(route.diff, fetch, visit);
          const teamMembers = teamMembersReader(fetch, visit);
          const teamAvatar = teamAvatarReader(fetch, visit);
          const teamRoster = teamRosterReader(fetch, visit);
          const prReviewers = readReviewersWithTeams(route.diff, codeOwners, {
            fetchFn: fetch,
            teamMembers,
            signal: visit,
          });
          const filter =
            route.diff.kind === "pr"
              ? {
                  linkOf: (token: string) =>
                    ownerFilterLink(location.href, ownerOf(location.search), token),
                  navigate,
                }
              : undefined;
          // Reads the visit's own promises and shares its cached team readers, so badging sends
          // no request per comment.
          if (route.diff.kind === "pr")
            showReviewerFiles(document, visit, {
              findAuthors: findFilesCommentAuthors,
              read: async () => ({ codeOwners: await codeOwners, prReviewers: await prReviewers }),
              teamMembers,
              teamAvatar,
              teamRoster,
              filter,
            });
          // Route data is fresh only until GitHub's first navigation.
          const viewed = visitViewed(fullLoad ? readViewedSeed(document, route.diff) : undefined);
          fullLoad = false;
          const reportOptions = {
            repo: route.diff,
            diffUrl: location.origin + location.pathname,
            version,
          };
          const messageVisit: CommitMessageVisit = {
            since: performance.now(),
            hidden: messageHidden.hidden,
          };
          const saveHidden = (hidden: boolean) => {
            messageHidden.hidden = hidden;
            saveMessageHidden(hidden);
          };
          const steps =
            route.diff.kind === "commit"
              ? stepLinksFor(route.diff, seenChildren, { after: afterLanding(intent), visit })
              : undefined;
          // ponytail: the panel lives per visit, so a same-PR route change that starts a new
          // visit (e.g. into one commit's diff) reloads the frame; key the panel by PR if that
          // bites.
          const panel =
            route.diff.kind === "pr"
              ? conversationPanel(document, {
                  pr: route.diff,
                  choice: conversation,
                  fetch,
                  allowFraming: allowConversationFrame,
                  savePinned,
                  saveOpen,
                  saveWidth: saveConversationWidth,
                  visit,
                })
              : undefined;
          const prOwnersGuard = panel && prOwnersPressGuard(document, visit);
          const landHash = hashLanding(document, visit);
          // Built on first use while on, and afresh once turned off, so nothing runs while off.
          let mode: StructuralMode | undefined;
          const structuralFor = () => {
            if (!structural.choice.on) return undefined;
            if (!mode || mode.until.aborted) {
              mode = structuralModeOf(structural, {
                connect: () => sources.connect(route.diff),
                commit: route.diff.kind === "commit",
                visit,
              });
            }
            return mode;
          };
          return (page, signal) => {
            const owner = route.diff.kind === "pr" ? ownerOf(location.search) : undefined;
            showReportLink(page, signal, reportOptions);
            showOwnerSection(page, signal, { codeOwners, prReviewers, navigate });
            showVisit(page, signal, {
              intent,
              diffstat: visitDiffstat,
              viewed,
              codeOwners,
              prReviewers,
              teamMembers,
              teamAvatar,
              teamRoster,
              owner,
              filter,
              whatsNew: whatsNewForPage?.(),
              landHash,
              structural: structuralFor(),
            });
            showCommitMessage(page, signal, {
              afterSections: afterLanding(intent),
              choice: commitMessage,
              save: saveCommitMessage,
              saveWidth: saveColumnWidth,
              saveHidden,
              visit: messageVisit,
            });
            if (steps) showStepLinks(page, signal, steps);
            dockSidebar(page, signal, { choice: side, save: saveSide });
            if (panel) {
              const conversationButton = showConversationButton(page, signal, panel);
              if (conversationButton && prOwnersGuard)
                showPrOwnersButton(conversationButton, signal, {
                  codeOwners,
                  prReviewers,
                  guard: prOwnersGuard,
                  teamMembers,
                  teamAvatar,
                  teamRoster,
                  filter,
                });
              followRightPanel(document, panel.refit, { signal });
            }
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
        // Shields Reviewers rows and Conversation comment authors, and adds a code owners button
        // beside each Reviewers heading. Rides the header visit, so it runs only where
        // findHeaderPage finds the counter's slot.
        showReviewerFiles(document, visit, {
          read: () => readOwnership(pr, { fetchFn: fetch, teamMembers, signal: visit }),
          teamMembers,
          teamAvatar: teamAvatarReader(fetch, visit),
          teamRoster: teamRosterReader(fetch, visit),
          findAuthors: findCommentAuthors,
          filter: {
            linkOf: (token) =>
              ownerFilterLink(
                `${location.origin}/${pr.owner}/${pr.repo}/pull/${pr.number}/files`,
                undefined,
                token,
              ),
            navigate,
          },
        });
        const visitDiffstat = { ...diffstat, pr: prKeyOf(pr) };
        return (page, signal) => showHeaderTab(page, signal, { intent, diffstat: visitDiffstat });
      },
      ctx.signal,
    );
    watchClassicPages(
      window,
      (route, visit) => {
        const teamMembers = teamMembersReader(fetch, visit);
        // No filter: the classic page ignores gh-prism-owner, so the action would reload it
        // unfiltered.
        showReviewerFiles(document, visit, {
          findAuthors: findFilesCommentAuthors,
          read: () => readOwnership(route.diff, { fetchFn: fetch, teamMembers, signal: visit }),
          teamMembers,
          teamAvatar: teamAvatarReader(fetch, visit),
          teamRoster: teamRosterReader(fetch, visit),
        });
        return (page, signal) =>
          showClassicNotice(page, signal, { choice: notice, save: saveDismissed });
      },
      ctx.signal,
    );
  },
});

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

/**
 * The child of each commit, by `owner/repo@sha` in lowercase, under which this tab last showed it
 * as the parent, so Next undoes Previous even where a commit has several children.
 */
type SeenChildren = Map<string, string>;

/**
 * `commit`'s step links: Next goes to the child `seenChildren` last saw it under, else to what a
 * read started `after` the sections land finds, until `visit` aborts. The parent the page names
 * records `commit` as its child.
 */
function stepLinksFor(
  commit: CommitHead,
  seenChildren: SeenChildren,
  { after, visit }: { after: (task: () => void) => void; visit: AbortSignal },
): StepLinksOptions {
  const keyOf = (sha: string) => `${commit.owner}/${commit.repo}@${sha}`.toLowerCase();
  const child = seenChildren.get(keyOf(commit.headSha));
  const next: Promise<NextCommit | undefined> = child
    ? Promise.resolve({ kind: "commit", sha: child })
    : new Promise((resolve) => after(() => resolve(readNextCommit(commit, fetch, visit))));
  const sawParent = (parent: string) => seenChildren.set(keyOf(parent), commit.headSha);
  return { commit, next, sawParent };
}

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
  return {
    view: known ? savedView : commitMessageView.fallback,
    width: knownWidth(savedWidth, commitColumnWidth.fallback),
  };
}

/** `saved` when it is a finite number, else `fallback`. */
const knownWidth = (saved: unknown, fallback: number): number =>
  typeof saved === "number" && Number.isFinite(saved) ? saved : fallback;

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

/**
 * Whether the Conversation panel was left pinned, unchecked, or the default when storage won't
 * read.
 */
const readSavedPinned = (): Promise<unknown> =>
  conversationPinned.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the Conversation panel's pin failed", error);
    return conversationPinned.fallback;
  });

/**
 * Whether the Conversation panel was left open, unchecked, or the default when storage won't
 * read.
 */
const readSavedOpen = (): Promise<unknown> =>
  conversationOpen.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading whether the Conversation panel is open failed", error);
    return conversationOpen.fallback;
  });

/** The stored Conversation panel width, unchecked, or the default when storage won't read. */
const readSavedConversationWidth = (): Promise<unknown> =>
  conversationWidth.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the Conversation panel's width failed", error);
    return conversationWidth.fallback;
  });

/**
 * The Conversation panel's start on a full load: pinned and its width from `saved`, when each
 * is one, else the defaults, and open only when it was left open and pinned and the window
 * `fits` the column.
 */
function conversationChoiceOf(
  saved: { pinned: unknown; open: unknown; width: unknown },
  fits: boolean,
): ConversationChoice {
  const pinned = saved.pinned === true;
  return {
    open: saved.open === true && pinned && fits,
    pinned,
    width: knownWidth(saved.width, conversationWidth.fallback),
  };
}

const saveOpen = (open: boolean) =>
  conversationOpen
    .setValue(open)
    .catch((error: unknown) =>
      console.error("gh-prism: saving whether the Conversation panel is open failed", error),
    );

const savePinned = (pinned: boolean) =>
  conversationPinned
    .setValue(pinned)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the Conversation panel's pin failed", error),
    );

const saveConversationWidth = (width: number) =>
  conversationWidth
    .setValue(width)
    .catch((error: unknown) =>
      console.error("gh-prism: saving the Conversation panel's width failed", error),
    );

/** Whether a commit's message was left hidden, unchecked, or shown when storage won't read. */
const readSavedHidden = (): Promise<unknown> =>
  commitMessageHidden.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading whether the commit message is hidden failed", error);
    return commitMessageHidden.fallback;
  });

const saveMessageHidden = (hidden: boolean) =>
  commitMessageHidden
    .setValue(hidden)
    .catch((error: unknown) =>
      console.error("gh-prism: saving whether the commit message is hidden failed", error),
    );

/** Whether Structural mode is on, shared by every visit. */
interface StructuralChoice {
  readonly choice: { on: boolean };
  readonly save: (on: boolean) => void;
}

/** Whether Structural mode was left on, unchecked, or off when storage won't read. */
const readSavedStructural = (): Promise<unknown> =>
  structuralMode.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading whether Structural mode is on failed", error);
    return structuralMode.fallback;
  });

const saveStructural = (on: boolean) =>
  structuralMode
    .setValue(on)
    .catch((error: unknown) =>
      console.error("gh-prism: saving whether Structural mode is on failed", error),
    );

/**
 * A visit's Structural mode, asking `connect`'s port for its files, until `visit` ends or GitHub's
 * Unified layout turns `structural` off.
 */
function structuralModeOf(
  structural: StructuralChoice,
  { connect, commit, visit }: { connect: () => PrDataClient; commit: boolean; visit: AbortSignal },
): StructuralMode {
  const off = new AbortController();
  const until = AbortSignal.any([visit, off.signal]);
  return {
    files: structuralFiles(connect, until),
    until,
    commit,
    search: () => location.search,
    unifiedSeen: () => {
      structural.choice.on = false;
      structural.save(false);
      off.abort();
    },
  };
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
