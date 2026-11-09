// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ConversationPanel,
  showConversationButton,
} from "../../../entrypoints/content/conversation/panel";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import {
  type PrOwnersPressGuard,
  prOwnersButton,
  prOwnersPressGuard,
  showPrOwnersButton,
} from "../../../entrypoints/content/ui/pr-owners";
import {
  type PrCodeOwners,
  type PrReviewer,
  readCodeOwners,
  readReviewersWithTeams,
  teamMembersReader,
} from "../../../utils/github/code-owners";
import type { PrRef } from "../../../utils/github/pr-ref";
import codeownersNone from "../../fixtures/codeowners-none.json?raw";
import codeownersSandbox from "../../fixtures/codeowners-sandbox.json?raw";
import { routedFetch } from "../../fixtures/fetch";
import fixture from "../../fixtures/files-page.html?raw";
import reviewRequests from "../../fixtures/review-requests-sandbox.json?raw";

const SANDBOX: PrRef = {
  kind: "pr",
  owner: "excessive-dev",
  repo: "gh-prism-codeowners-sandbox",
  number: 1,
};
const SANDBOX_PR = "https://github.com/excessive-dev/gh-prism-codeowners-sandbox/pull/1";
const MEMBERS = "https://github.com/orgs/excessive-dev/teams/";

const OWNED: PrCodeOwners = new Map([
  ["src/app.ts", { owners: [{ token: "@o/web" }], ownedByViewer: false }],
  ["README.md", { owners: [], ownedByViewer: false }],
]);

const panel: ConversationPanel = {
  toggle: () => {},
  close: () => {},
  open: false,
  attach: () => {},
  refit: () => {},
  name: "Conversation",
};

let visit: AbortController;
let guard: PrOwnersPressGuard;

function page(): FilesPage {
  const found = findFilesPage(document);
  if (!found) throw new Error("fixture has no Files page");
  return found;
}

const ownersButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>(".gh-prism-pr-owners"),
];
const ownersButton = () => ownersButtons()[0];
const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
const closeDialog = () =>
  dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

/** Mounts a page's Conversation button and, after it, the code owners button, as a page does. */
function show(
  codeOwners: Promise<PrCodeOwners | undefined> = Promise.resolve(OWNED),
  prReviewers: Promise<readonly PrReviewer[] | undefined> = Promise.resolve([]),
  signal = visit.signal,
) {
  const anchor = showConversationButton(page(), signal, panel);
  if (!anchor) throw new Error("fixture has no toolbar");
  showPrOwnersButton(anchor, signal, {
    codeOwners,
    prReviewers,
    guard,
    teamMembers: async () => undefined,
    teamAvatar: async () => undefined,
  });
  return anchor;
}

/** Shows the button over the sandbox PR's real reads, through `fetchFn`. */
function showSandbox(fetchFn: typeof fetch) {
  const codeOwners = readCodeOwners(SANDBOX, fetchFn, visit.signal);
  const teamMembers = teamMembersReader(fetchFn, visit.signal);
  const prReviewers = readReviewersWithTeams(SANDBOX, codeOwners, {
    fetchFn,
    teamMembers,
    signal: visit.signal,
  });
  const anchor = showConversationButton(page(), visit.signal, panel);
  if (!anchor) throw new Error("fixture has no toolbar");
  showPrOwnersButton(anchor, visit.signal, {
    codeOwners,
    prReviewers,
    guard,
    teamMembers,
    teamAvatar: async () => undefined,
  });
}

const sandboxFetch = (reviewers: string) =>
  routedFetch({
    [`${SANDBOX_PR}/page_data/codeowners`]: () => Promise.resolve(new Response(codeownersSandbox)),
    [`${SANDBOX_PR}/page_data/review_requests`]: () => Promise.resolve(new Response(reviewers)),
    [`${MEMBERS}frontend/members`]: () =>
      Promise.resolve(new Response(JSON.stringify({ total: 1, members: ["ada"] }))),
    [`${MEMBERS}platform/members`]: () =>
      Promise.resolve(new Response(JSON.stringify({ total: 1, members: ["grace"] }))),
  });

/** Lets the reads' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = fixture;
  visit = new AbortController();
  guard = prOwnersPressGuard(document, visit.signal);
});

afterEach(() => {
  visit.abort();
  document.head.innerHTML = "";
});

describe("showPrOwnersButton", () => {
  it("sits right after its anchor once both reads settle", async () => {
    let answer: (reviewers: readonly PrReviewer[]) => void = () => {};
    const anchor = show(Promise.resolve(OWNED), new Promise((resolve) => (answer = resolve)));
    await settled();
    expect(ownersButton()).toBeUndefined();

    answer([]);
    await settled();

    expect(anchor.nextElementSibling).toBe(ownersButton());
  });

  it("shows when a changed file has a code owner but the PR reviewers can't be read", async () => {
    show(Promise.resolve(OWNED), Promise.resolve(undefined));

    await settled();

    expect(ownersButton()).toBeDefined();
  });

  it.each<[string, Promise<PrCodeOwners | undefined>]>([
    ["the code-owner read failed", Promise.resolve(undefined)],
    [
      "no file has a code owner",
      Promise.resolve(new Map([["a.md", { owners: [], ownedByViewer: false }]])),
    ],
  ])("shows no button when %s", async (_, codeOwners) => {
    show(codeOwners);

    await settled();

    expect(ownersButton()).toBeUndefined();
  });

  it("shows no button for a repository without CODEOWNERS", async () => {
    const fetchFn = routedFetch({
      [`${SANDBOX_PR}/page_data/codeowners`]: () => Promise.resolve(new Response(codeownersNone)),
    });

    show(readCodeOwners(SANDBOX, fetchFn, visit.signal));
    await settled();

    expect(ownersButton()).toBeUndefined();
  });

  it("shows no button once its anchor has left the page", async () => {
    show().remove();

    await settled();

    expect(ownersButton()).toBeUndefined();
  });

  it("is named by its tooltip and says it opens a dialog", async () => {
    show();

    await settled();

    expect(ownersButton()?.type).toBe("button");
    expect(ownersButton()?.getAttribute("aria-label")).toBeTruthy();
    expect(ownersButton()?.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("opens the whole pull request's code owners, handing focus back on close", async () => {
    show();
    await settled();

    ownersButton()?.click();
    expect(dialog()?.textContent).toContain("Code owners of this pull request");
    expect(dialog()?.textContent).toContain("src/app.ts");
    closeDialog();

    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(ownersButton());
  });

  describe("a press the page re-mounts the button under", () => {
    // GitHub hydrates the toolbar on the first press and re-renders it, so the press starts on one
    // button and ends on its replacement, and the browser fires no click.
    it("opens the dialog when released on the replacement", async () => {
      const first = new AbortController();
      show(undefined, undefined, first.signal);
      await settled();
      ownersButton()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

      first.abort();
      show();
      await settled();
      ownersButton()?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

      expect(dialog()).not.toBeNull();
    });

    it.each(["pointerup", "pointercancel"])(
      "forgets a press ended by a %s elsewhere",
      async (type) => {
        const first = new AbortController();
        show(undefined, undefined, first.signal);
        await settled();
        ownersButton()?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        document.body.dispatchEvent(new PointerEvent(type, { bubbles: true }));

        first.abort();
        show();
        await settled();
        ownersButton()?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

        expect(dialog()).toBeNull();
      },
    );

    it("still opens the dialog once for a press on an unchanged button", async () => {
      show();
      await settled();
      const control = ownersButton();

      control?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      control?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      control?.click();

      expect(document.querySelectorAll("dialog.gh-prism-owners-dialog")).toHaveLength(1);
    });
  });

  it("opens from the reads the visit already made, sending GitHub no new request", async () => {
    const fetchFn = sandboxFetch(reviewRequests);
    showSandbox(fetchFn);
    await settled();
    await settled();
    const requests = fetchFn.mock.calls.length;

    ownersButton()?.click();
    await settled();

    expect(dialog()).not.toBeNull();
    expect(fetchFn.mock.calls.length).toBe(requests);
  });

  it("reads each owning team's members at most once per visit on a PR with no reviewer", async () => {
    const fetchFn = sandboxFetch(JSON.stringify({ pendingReviewRequests: [] }));
    showSandbox(fetchFn);
    await settled();
    await settled();

    ownersButton()?.click();
    await settled();
    closeDialog();
    ownersButton()?.click();
    await settled();

    const members = fetchFn.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith(MEMBERS));
    expect(members.toSorted()).toEqual([
      `${MEMBERS}frontend/members`,
      `${MEMBERS}platform/members`,
    ]);
  });

  it("is gone when the page's signal aborts", async () => {
    const pageSignal = new AbortController();
    show(undefined, undefined, pageSignal.signal);
    await settled();

    pageSignal.abort();

    expect(ownersButton()).toBeUndefined();
  });

  it("is never doubled when the renderer runs again on the same visit", async () => {
    show();
    show();

    await settled();

    expect(ownersButtons()).toHaveLength(1);
  });

  it("replaces an earlier button a cloned toolbar carried", async () => {
    document.body.append(prOwnersButton(document));
    show();

    await settled();

    expect(ownersButtons()).toHaveLength(1);
  });
});
