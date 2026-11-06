// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ConversationPanel,
  showConversationButton,
} from "../../../entrypoints/content/conversation/panel";
import { type FilesPage, findFilesPage } from "../../../entrypoints/content/files-page";
import { showPrOwnersButton } from "../../../entrypoints/content/ui/pr-owners";
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
};

let visit: AbortController;

function page(): FilesPage {
  const found = findFilesPage(document);
  if (!found) throw new Error("fixture has no Files page");
  return found;
}

const conversationButton = () => document.querySelector(".gh-prism-conversation-button");
const ownersButtons = () => [
  ...document.querySelectorAll<HTMLButtonElement>(".gh-prism-pr-owners"),
];
const ownersButton = () => ownersButtons()[0];
const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");

function show(
  codeOwners: Promise<PrCodeOwners | undefined> = Promise.resolve(OWNED),
  prReviewers: Promise<readonly PrReviewer[] | undefined> = Promise.resolve([]),
  signal = visit.signal,
) {
  showPrOwnersButton(page(), signal, {
    codeOwners,
    prReviewers,
    teamMembers: async () => undefined,
    teamAvatar: async () => undefined,
  });
}

/** Lets the reads' promises settle. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = fixture;
  visit = new AbortController();
  showConversationButton(page(), visit.signal, panel);
});

afterEach(() => {
  visit.abort();
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("showPrOwnersButton", () => {
  it("sits right after the Conversation button once both reads settle", async () => {
    let answer: (reviewers: readonly PrReviewer[]) => void = () => {};
    show(Promise.resolve(OWNED), new Promise((resolve) => (answer = resolve)));
    await settled();
    expect(ownersButton()).toBeUndefined();

    answer([]);
    await settled();
    expect(conversationButton()?.nextElementSibling).toBe(ownersButton());
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

  it("shows no button without a Conversation button", async () => {
    conversationButton()?.remove();
    show();
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
    dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(ownersButton());
  });

  it("opens from a press whose button the toolbar re-mounted mid-press", async () => {
    show();
    await settled();
    const pressed = ownersButton();
    pressed?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    pressed?.remove();
    document.body.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(dialog()).not.toBeNull();
  });

  it("opens from the reads the visit already made, sending GitHub no new request", async () => {
    const fetchFn = routedFetch({
      [`${SANDBOX_PR}/page_data/codeowners`]: () =>
        Promise.resolve(new Response(codeownersSandbox)),
      [`${SANDBOX_PR}/page_data/review_requests`]: () =>
        Promise.resolve(new Response(reviewRequests)),
      "https://github.com/orgs/excessive-dev/teams/frontend/members": () =>
        Promise.resolve(new Response(JSON.stringify({ total: 1, members: ["ada"] }))),
      "https://github.com/orgs/excessive-dev/teams/platform/members": () =>
        Promise.resolve(new Response(JSON.stringify({ total: 1, members: ["grace"] }))),
    });
    const codeOwners = readCodeOwners(SANDBOX, fetchFn, visit.signal);
    const teamMembers = teamMembersReader(fetchFn, visit.signal);
    const prReviewers = readReviewersWithTeams(SANDBOX, codeOwners, {
      fetchFn,
      teamMembers,
      signal: visit.signal,
    });
    showPrOwnersButton(page(), visit.signal, {
      codeOwners,
      prReviewers,
      teamMembers,
      teamAvatar: async () => undefined,
    });
    await Promise.all([codeOwners, prReviewers]);
    await settled();
    const requests = fetchFn.mock.calls.length;

    ownersButton()?.click();
    await settled();

    expect(dialog()).not.toBeNull();
    expect(fetchFn.mock.calls.length).toBe(requests);
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
});
