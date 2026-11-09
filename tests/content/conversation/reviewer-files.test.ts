// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showReviewerFiles } from "../../../entrypoints/content/conversation/reviewer-files";
import {
  type CommentAuthor,
  findCommentAuthors,
  findFilesCommentAuthors,
  findReviewerRows,
} from "../../../entrypoints/content/files-page";
import type { OwnerFilter } from "../../../entrypoints/content/ui/owners-dialog";
import {
  codeOwnerOf,
  type Ownership,
  type PrCodeOwners,
  type PrReviewer,
  readOwnership,
  type TeamMembersOf,
  teamMembersReader,
} from "../../../utils/github/code-owners";
import type { DiffRef } from "../../../utils/github/pr-ref";
import nodeCodeowners from "../../fixtures/codeowners-node.json?raw";
import sandboxCodeowners from "../../fixtures/codeowners-sandbox.json?raw";
import commentsFixture from "../../fixtures/conversation-comments.html?raw";
import nodeConversation from "../../fixtures/conversation-node.html?raw";
import overviewConversation from "../../fixtures/conversation-overview.html?raw";
import overviewAssigned from "../../fixtures/conversation-overview-assigned.html?raw";
import overviewCommentsFixture from "../../fixtures/conversation-overview-comments.html?raw";
import emptyOverviewConversation from "../../fixtures/conversation-overview-empty.html?raw";
import conversationFixture from "../../fixtures/conversation-page.html?raw";
import { routedFetch } from "../../fixtures/fetch";
import { outline } from "../../fixtures/file-list";
import {
  byId,
  COMMENT_THREADS,
  diffList,
  loadClassicCommentsFixture,
  loadCommentsFixture,
} from "../../fixtures/files-page";
import nodeReviewRequests from "../../fixtures/review-requests-node.json?raw";
import sandboxMembers from "../../fixtures/team-members-sandbox.json?raw";

// happy-dom has no Popover API.
HTMLElement.prototype.showPopover = () => {};
HTMLElement.prototype.hidePopover = () => {};

interface RawOwnership {
  readonly owners: readonly string[];
  readonly isOwnedByViewer: boolean;
}

/** The sandbox pull request's code owners, with `edit` applied to the raw body first. */
function sandboxOwners(
  edit: (byPath: Record<string, RawOwnership>) => void = () => {},
): PrCodeOwners {
  const byPath: Record<string, RawOwnership> = JSON.parse(sandboxCodeowners).ownershipByPath;
  edit(byPath);
  return new Map(
    Object.entries(byPath).map(([path, { owners, isOwnedByViewer }]) => [
      path,
      { owners: owners.map(codeOwnerOf), ownedByViewer: isOwnedByViewer },
    ]),
  );
}

const SANDBOX_REVIEWERS: readonly PrReviewer[] = [
  { token: "@excessive-dev/frontend", teams: [], codeOwner: true },
  { token: "@excessive-dev/platform", teams: [], codeOwner: true },
];

type Json = Record<string, unknown>;
const node: DiffRef = {
  kind: "pr",
  owner: "nodejs",
  repo: "node",
  number: 67056,
};
const NODE_CRYPTO = [
  "src/crypto/crypto_context.cc",
  "src/crypto/crypto_context.h",
  "src/crypto/crypto_hash.cc",
  "src/crypto/crypto_rsa.cc",
  "src/crypto/crypto_tls.cc",
  "src/crypto/crypto_util.cc",
];

interface NodeEdits {
  readonly ownership?: (byPath: Record<string, RawOwnership>) => void;
  readonly reviewRequests?: (body: {
    pendingReviewRequests: Json[];
    completedReviews: Json[];
  }) => void;
  /** The members nodejs/crypto lists; unset, its members can't be read. */
  readonly cryptoMembers?: readonly string[];
}

/**
 * nodejs/node#67056's code owners and PR reviewers, read from its captures after `edits` as a
 * visit reads them, owning teams' members included.
 */
async function nodeOwnership(edits: NodeEdits = {}): Promise<Ownership> {
  const fetchFn = nodeFetch(edits);
  const { signal } = new AbortController();
  return readOwnership(node, { fetchFn, teamMembers: teamMembersReader(fetchFn, signal), signal });
}

/** GitHub as it answers nodejs/node#67056's reads, after `edits`. */
function nodeFetch({ ownership, reviewRequests, cryptoMembers }: NodeEdits) {
  const codeowners = JSON.parse(nodeCodeowners);
  ownership?.(codeowners.ownershipByPath);
  const requests = JSON.parse(nodeReviewRequests);
  reviewRequests?.(requests);
  return routedFetch({
    "https://github.com/nodejs/node/pull/67056/page_data/codeowners": () =>
      Promise.resolve(new Response(JSON.stringify(codeowners))),
    "https://github.com/nodejs/node/pull/67056/page_data/review_requests": () =>
      Promise.resolve(new Response(JSON.stringify(requests))),
    ...(cryptoMembers && {
      "https://github.com/orgs/nodejs/teams/crypto/members": () =>
        Promise.resolve(
          new Response(JSON.stringify({ total: cryptoMembers.length, members: cryptoMembers })),
        ),
    }),
  });
}

/** A team as review_requests names one. */
const team = (displayLogin: string) => ({
  displayLogin,
  name: "",
  reviewerType: "Team",
});
/** Assigns jasnell's pending request from nodejs/crypto, as team review assignment does. */
const assignedFromCrypto = ({
  pendingReviewRequests: [jasnell],
}: {
  pendingReviewRequests: Json[];
}) =>
  Object.assign(jasnell ?? {}, {
    delegatedFromTeam: team("nodejs/crypto"),
    isCodeOwner: true,
    isCodeOwnerFromDelegation: true,
  });
/** Records pimterry's review as on behalf of nodejs/crypto. */
const reviewedForCrypto = ({ completedReviews: [pimterry] }: { completedReviews: Json[] }) =>
  Object.assign(pimterry ?? {}, { onBehalfOfTeams: [team("nodejs/crypto")] });

/** Marks jasnell's pending request a code owner's, naming no team. */
const markedCodeOwner = ({ pendingReviewRequests: [jasnell] }: { pendingReviewRequests: Json[] }) =>
  Object.assign(jasnell ?? {}, { isCodeOwner: true });

/** Gives jasnell's classic row GitHub's code-owner shield, then rests the pointer on it. */
async function hoverJasnellsShield() {
  addGitHubShield("jasnell");
  await hoverOn(document.getElementById("codeowner-jasnell") as Element);
}

/** Gives `login`'s classic row GitHub's code-owner shield, shaped as it draws a team's. */
function addGitHubShield(login: string) {
  const row = document.querySelector(`[data-assignee-name="${login}"]`)?.parentElement;
  row?.insertAdjacentHTML(
    "beforeend",
    `<button type="button" id="codeowner-${login}" class="mr-2 btn-link muted-icon"><span class="reviewers-status-icon"><svg class="octicon octicon-shield-lock"></svg></span></button>`,
  );
}

/**
 * Gives `login`'s classic row the shield GitHub draws once nodejs/crypto's review assignment
 * picks them, and returns it.
 */
function addAssignedShield(login: string): HTMLElement {
  const id = `assigned-codeowner-${login}`;
  const row = document.querySelector(`[data-assignee-name="${login}"]`)?.parentElement;
  row?.insertAdjacentHTML(
    "beforeend",
    `<button name="button" type="button" id="${id}" class="mr-2 btn-link muted-icon" aria-labelledby="tooltip-${id}"><span class="reviewers-status-icon"><svg class="octicon octicon-shield-lock"></svg></span></button><tool-tip id="tooltip-${id}" for="${id}" popover="manual" data-direction="nw" data-type="label" class="sr-only position-absolute" aria-hidden="true" role="tooltip">${login} is a code owner automatically assigned from nodejs/crypto</tool-tip>`,
  );
  return document.getElementById(id) as HTMLElement;
}

let controller: AbortController;

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = "";
  document.body.innerHTML = conversationFixture;
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

const FRONTEND_MEMBERS = "https://github.com/orgs/excessive-dev/teams/frontend/members";
let membersFetch: ReturnType<typeof routedFetch>;

beforeEach(() => {
  membersFetch = routedFetch({
    [FRONTEND_MEMBERS]: () => Promise.resolve(new Response(sandboxMembers)),
  });
});

function show(
  read: () => Promise<Ownership> = async () => ({
    codeOwners: sandboxOwners(),
    prReviewers: SANDBOX_REVIEWERS,
  }),
  teamMembers: TeamMembersOf = teamMembersReader(membersFetch, controller.signal),
  filter?: OwnerFilter,
  findAuthors: (doc: Document) => CommentAuthor[] = findCommentAuthors,
) {
  showReviewerFiles(document, controller.signal, {
    read,
    teamMembers,
    teamAvatar: async () => undefined,
    teamRoster: async () => undefined,
    filter,
    findAuthors,
  });
}

/** Shows the popups on the code-owners sandbox's Overview `page`, read through `read`, once settled. */
async function showOverview(page: string, read?: () => Promise<Ownership>) {
  document.body.innerHTML = page;
  show(read);
  await vi.advanceTimersByTimeAsync(0);
}

/** Shows the popups on nodejs/node#67056's `page`, read after `edits`, once its reads settle. */
async function showNode(edits: NodeEdits = {}, page = nodeConversation, filter?: OwnerFilter) {
  document.body.innerHTML = page;
  const ownership = await nodeOwnership(edits);
  show(async () => ownership, undefined, filter);
  await vi.advanceTimersByTimeAsync(0);
}

const shieldOf = (team: string) =>
  document.getElementById(`codeowner-excessive-dev/${team}`) as HTMLElement;
/** GitHub's shield beside `team` in the PR overview's Reviewers list: the row's first icon. */
const overviewShieldOf = (team: string) =>
  document
    .querySelector(`a[href="/orgs/excessive-dev/teams/${team}"]`)
    ?.closest('[class*="reviewerRow__"]')
    ?.querySelector('[class*="indicators__"] > button') as HTMLElement;
/** gh-prism's shields, by the reviewer each marks. */
const ownShields = () =>
  [...document.querySelectorAll<HTMLElement>("button[data-gh-prism-owner]")].map(
    (shield) => shield.dataset.ghPrismOwner,
  );
const ownShieldOf = (token: string) =>
  document.querySelector<HTMLElement>(`button[data-gh-prism-owner="${token}"]`) as HTMLElement;
/** The row a classic or overview reviewer's identity link sits in. */
const rowOf = (login: string) =>
  document.querySelector(`a[href="/${login}"]`)?.closest("li, div.d-flex") as HTMLElement;
const popups = () => [...document.querySelectorAll<HTMLElement>(".gh-prism-reviewer-files")];
const popup = () => document.querySelector<HTMLElement>(".gh-prism-reviewer-files");
const listed = () => outline(popup()?.querySelector("ul"));
const cryptoListing = [
  "src/crypto/",
  ...NODE_CRYPTO.map((path) => `  ${path.replace(/^src\/crypto\//, "")}`),
];
const sortedAfterFolder = ([folder, ...files]: string[]) => [folder, ...files.sort()];

function pointerOver(target: Element, from: Element | null = null) {
  target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: from }));
}
function pointerOut(target: Element, to: Element | null = document.body) {
  target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: to }));
}

async function hoverOpen(team: string) {
  await hoverOn(shieldOf(team));
}

async function hoverOn(shield: Element) {
  pointerOver(shield);
  await vi.advanceTimersByTimeAsync(200);
}

describe("showReviewerFiles", () => {
  it("lists the files a shielded reviewer owns once the pointer rests on the shield", async () => {
    show();

    pointerOver(shieldOf("frontend"));
    await vi.advanceTimersByTimeAsync(199);
    const popupsBeforeDelay = popups().length;
    await vi.advanceTimersByTimeAsync(1);

    expect(popupsBeforeDelay).toBe(0);
    expect(popups()).toHaveLength(1);
    expect(listed()).toEqual(["api/generated/", "  client.ts", "web/", "  app.ts"]);
    expect(popup()?.textContent).toContain("Code owner of 2 files in this pull request");
  });

  it("opens nothing when the pointer leaves the shield before the delay", async () => {
    show();

    pointerOver(shieldOf("frontend"));
    await vi.advanceTimersByTimeAsync(100);
    pointerOut(shieldOf("frontend"));
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("leaves a reviewer's name and avatar to GitHub's own card", async () => {
    show();
    const row = shieldOf("frontend").parentElement as HTMLElement;

    pointerOver(row.querySelector("a.assignee") as Element);
    pointerOver(row.querySelector("img.avatar") as Element);
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing from a reviewer row without a shield", async () => {
    const row = shieldOf("frontend").parentElement as HTMLElement;
    shieldOf("frontend").remove();
    show();

    pointerOver(row.querySelector("a.assignee") as Element);
    pointerOver(row.querySelector(".reviewers-status-icon") as Element);
    pointerOver(row);
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing for a shield whose reviewer owns no changed file", async () => {
    show(async () => ({
      codeOwners: sandboxOwners((byPath) => {
        for (const [path, entry] of Object.entries(byPath)) byPath[path] = { ...entry, owners: [] };
      }),
      prReviewers: [],
    }));

    await hoverOpen("frontend");

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing when the code owners can't be read", async () => {
    show(async () => ({
      codeOwners: undefined,
      prReviewers: SANDBOX_REVIEWERS,
    }));

    await hoverOpen("frontend");

    expect(popups()).toHaveLength(0);
  });

  it("opens at once on focus and describes the shield with the popup", async () => {
    show();

    shieldOf("frontend").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(popups()).toHaveLength(1);
    expect(shieldOf("frontend").getAttribute("aria-describedby")).toBe("gh-prism-reviewer-files");
    expect(popup()?.id).toBe("gh-prism-reviewer-files");
  });

  it("closes on Escape and clears the shield's description", async () => {
    show();
    shieldOf("frontend").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    shieldOf("frontend").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(popups()).toHaveLength(0);
    expect(shieldOf("frontend").hasAttribute("aria-describedby")).toBe(false);
  });

  it("closes when focus leaves the shield", async () => {
    show();
    shieldOf("frontend").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    shieldOf("frontend").dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );

    expect(popups()).toHaveLength(0);
    expect(shieldOf("frontend").hasAttribute("aria-describedby")).toBe(false);
  });

  it("closes when the page removes the focused shield", async () => {
    show();
    const shield = shieldOf("frontend");
    shield.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    shield.replaceWith(shield.cloneNode(true));
    await vi.advanceTimersByTimeAsync(0);

    expect(popups()).toHaveLength(0);
  });

  it("keeps a hovered shield's popup when the page removes a shield focus has left", async () => {
    show();
    const shield = shieldOf("frontend");
    shield.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    shield.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );
    await hoverOpen("platform");

    shield.replaceWith(shield.cloneNode(true));
    await vi.advanceTimersByTimeAsync(0);

    expect(popups()).toHaveLength(1);
  });

  it("closes once the pointer has left the shield and popup for the grace period", async () => {
    show();
    await hoverOpen("frontend");

    pointerOut(shieldOf("frontend"));
    await vi.advanceTimersByTimeAsync(149);
    const popupsDuringGrace = popups().length;
    await vi.advanceTimersByTimeAsync(1);

    expect(popupsDuringGrace).toBe(1);
    expect(popups()).toHaveLength(0);
  });

  it("stays open while the pointer moves from the shield into the popup", async () => {
    show();
    await hoverOpen("frontend");
    const open = popup() as HTMLElement;

    pointerOut(shieldOf("frontend"), document.body);
    await vi.advanceTimersByTimeAsync(100);
    pointerOver(open, document.body);
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toEqual([open]);
  });

  it("shows one reviewer's files at a time", async () => {
    show();
    await hoverOpen("frontend");

    pointerOut(shieldOf("frontend"), shieldOf("platform"));
    await hoverOpen("platform");

    expect(popups()).toHaveLength(1);
    expect(listed()).toEqual(["infra/", "  deploy.yml", "api/", "  routes.ts"]);
  });

  it("closes on a scroll outside it", async () => {
    show();
    await hoverOpen("frontend");

    document.dispatchEvent(new Event("scroll"));

    expect(popups()).toHaveLength(0);
  });

  it("describes the shield again when focus reopens it after a scroll", async () => {
    show();
    const shield = shieldOf("frontend");
    shield.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    document.dispatchEvent(new Event("scroll"));

    shield.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
    shield.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(popups()).toHaveLength(1);
    expect(shield.getAttribute("aria-describedby")).toBe("gh-prism-reviewer-files");
  });

  it("describes the shield again when the pointer reopens it after a scroll", async () => {
    show();
    await hoverOpen("frontend");
    document.dispatchEvent(new Event("scroll"));

    pointerOut(shieldOf("frontend"));
    await hoverOpen("frontend");

    expect(popups()).toHaveLength(1);
    expect(shieldOf("frontend").getAttribute("aria-describedby")).toBe("gh-prism-reviewer-files");
  });

  it("closes and removes its stylesheet once the signal aborts", async () => {
    show();
    await hoverOpen("frontend");
    const stylesBeforeAbort = document.head.querySelectorAll("style").length;

    controller.abort();

    expect(stylesBeforeAbort).toBe(1);
    expect(popups()).toHaveLength(0);
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
  });

  it("renders a path as text, never as markup", async () => {
    const path = "<img src=x onerror=alert(1)>.ts";
    show(async () => ({
      codeOwners: sandboxOwners((byPath) => {
        byPath[path] = {
          owners: ["@excessive-dev/frontend"],
          isOwnedByViewer: false,
        };
      }),
      prReviewers: SANDBOX_REVIEWERS,
    }));

    await hoverOpen("frontend");

    expect(listed()).toContain(path);
    expect(popup()?.querySelector("img")).toBeNull();
  });

  it("reads the code owners and PR reviewers once, as a Reviewers list first shows", async () => {
    document.body.innerHTML = "";
    const read = vi.fn(async () => ({
      codeOwners: sandboxOwners(),
      prReviewers: SANDBOX_REVIEWERS,
    }));
    show(read);
    await vi.advanceTimersByTimeAsync(0);
    const beforeList = read.mock.calls.length;

    document.body.innerHTML = conversationFixture;
    await vi.advanceTimersByTimeAsync(0);
    await hoverOpen("frontend");
    document.body.innerHTML = conversationFixture;
    await hoverOpen("platform");

    expect(beforeList).toBe(0);
    expect(read).toHaveBeenCalledOnce();
  });

  it("opens nothing when the pointer leaves while the code owners are still being read", async () => {
    const read = Promise.withResolvers<Ownership>();
    show(() => read.promise);

    await hoverOpen("frontend");
    pointerOut(shieldOf("frontend"));
    read.resolve({
      codeOwners: sandboxOwners(),
      prReviewers: SANDBOX_REVIEWERS,
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing after Escape while the code owners are still being read", async () => {
    const read = Promise.withResolvers<Ownership>();
    show(() => read.promise);

    await hoverOpen("frontend");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    read.resolve({
      codeOwners: sandboxOwners(),
      prReviewers: SANDBOX_REVIEWERS,
    });
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("keeps the open popup when its shield takes focus", async () => {
    show();
    await hoverOpen("frontend");
    const open = popup();

    shieldOf("frontend").dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(popups()).toHaveLength(1);
    expect(popup()).toBe(open);
  });

  it("times the hover from entering the shield, not from crossing its inner parts", async () => {
    show();
    const shield = shieldOf("frontend");
    const icon = shield.querySelector("span") as Element;

    pointerOver(shield);
    await vi.advanceTimersByTimeAsync(150);
    pointerOver(icon, shield);
    await vi.advanceTimersByTimeAsync(50);

    expect(popups()).toHaveLength(1);
  });
  it("draws no second shield beside a reviewer GitHub shields", async () => {
    show();
    await vi.advanceTimersByTimeAsync(0);

    expect(ownShields()).toEqual([]);
  });

  describe("the owner filter's action", () => {
    const FILES = "https://github.com/o/r/pull/1/files";
    const filter: OwnerFilter = {
      linkOf: (token) => ({ href: `${FILES}?gh-prism-owner=${token}`, shown: false }),
      navigate: () => {},
    };
    const action = () => popup()?.querySelector<HTMLAnchorElement>("a.gh-prism-owner-filter");

    it("ends a team's popup, beside the hint", async () => {
      show(undefined, undefined, filter);

      await hoverOpen("frontend");

      expect(action()?.href).toBe(`${FILES}?gh-prism-owner=@excessive-dev/frontend`);
      expect(action()?.parentElement).toBe(popup()?.querySelector(".gh-prism-owners-hint"));
    });

    it("ends a user's popup", async () => {
      await showNode({ reviewRequests: assignedFromCrypto }, undefined, filter);

      await hoverOn(addAssignedShield("jasnell"));

      expect(action()?.href).toBe(`${FILES}?gh-prism-owner=@jasnell`);
    });

    it("shows only a team's files from its filter icon on the Through line", async () => {
      await showNode({ reviewRequests: assignedFromCrypto }, undefined, filter);

      await hoverOn(addAssignedShield("jasnell"));

      expect(
        popup()
          ?.querySelector<HTMLAnchorElement>("p a.gh-prism-owner-filter-icon")
          ?.getAttribute("href"),
      ).toBe(`${FILES}?gh-prism-owner=@nodejs/crypto`);
    });

    it("follows gh-prism's mark in the popup's footer", async () => {
      show(undefined, undefined, filter);

      await hoverOpen("frontend");

      const marks = popup()?.querySelectorAll(".gh-prism-mark") ?? [];
      expect(marks).toHaveLength(1);
      expect(marks[0]?.nextElementSibling).toBe(action());
    });

    it("is left out of a popup that lists no files", async () => {
      await showNode({ reviewRequests: markedCodeOwner }, undefined, filter);

      await hoverJasnellsShield();

      expect(popup()?.querySelector(".gh-prism-owners-hint")).not.toBeNull();
      expect(action()).toBeNull();
    });

    it("sits in the footer of the dialog a shield's click opens", async () => {
      show(undefined, undefined, filter);
      await vi.advanceTimersByTimeAsync(0);

      shieldOf("frontend").click();
      await vi.advanceTimersByTimeAsync(0);

      const footerAction = document.querySelector<HTMLAnchorElement>(
        "dialog .gh-prism-owners-dialog-footer a.gh-prism-owner-filter",
      );
      expect(footerAction?.href).toBe(`${FILES}?gh-prism-owner=@excessive-dev/frontend`);
    });

    it("is left out of the dialog of a team marked a code owner that owns no changed file", async () => {
      const codeOwners = sandboxOwners((byPath) => {
        for (const [path, ownership] of Object.entries(byPath))
          byPath[path] = {
            ...ownership,
            owners: ownership.owners.filter((owner) => owner !== "@excessive-dev/frontend"),
          };
      });
      show(async () => ({ codeOwners, prReviewers: SANDBOX_REVIEWERS }), undefined, filter);
      await vi.advanceTimersByTimeAsync(0);

      shieldOf("frontend").click();
      await vi.advanceTimersByTimeAsync(0);

      const dialog = document.querySelector("dialog.gh-prism-owners-dialog");
      expect(dialog).not.toBeNull();
      expect(dialog?.querySelector("a.gh-prism-owner-filter")).toBeNull();
    });
  });

  describe("a user's code-owner shield", () => {
    it("lists the files CODEOWNERS names the user for", async () => {
      await showNode({
        ownership: (byPath) => {
          byPath["test/cctest/test_node_crypto.cc"] = {
            owners: ["@jasnell"],
            isOwnedByViewer: false,
          };
        },
        reviewRequests: markedCodeOwner,
      });

      await hoverJasnellsShield();

      expect(listed()).toEqual(["test/cctest/", "  test_node_crypto.cc"]);
      expect(popup()?.querySelector("a")).toBeNull();
    });

    it("lists the team's files, naming and linking the team, when assigned on its behalf", async () => {
      await showNode({ reviewRequests: assignedFromCrypto });

      await hoverOn(addAssignedShield("jasnell"));

      expect(ownShieldOf("@jasnell")).toBeNull();
      expect(sortedAfterFolder(listed())).toEqual(cryptoListing);
      expect(
        [...(popup()?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href")),
      ).toEqual(["https://github.com/orgs/nodejs/teams/crypto"]);
      expect(popup()?.textContent).toContain("Through nodejs/crypto");
    });

    it("says why it lists nothing when GitHub names no team", async () => {
      await showNode({ reviewRequests: markedCodeOwner });

      await hoverJasnellsShield();

      expect(listed()).toEqual([]);
      expect(popup()?.textContent).toContain(
        "GitHub doesn't show you which team makes them a code owner, so their files aren't listed.",
      );
      expect(popup()?.querySelector(".gh-prism-owners-hint")).not.toBeNull();
    });
  });

  describe("a click on a shield", () => {
    const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
    const dialogName = () =>
      document.getElementById(dialog()?.getAttribute("aria-labelledby") ?? "")?.textContent;
    const dialogItems = () =>
      [...(dialog()?.querySelectorAll("li") ?? [])].map((li) => li.textContent);
    const closeDialog = () =>
      dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
    async function clickOn(shield: HTMLElement) {
      shield.click();
      await vi.advanceTimersByTimeAsync(0);
    }

    it("shows gh-prism's mark in the hover card's footer and the dialog, not on the shields", async () => {
      show();
      await hoverOpen("frontend");
      const cardMarks = [...document.querySelectorAll(".gh-prism-mark")];

      await clickOn(shieldOf("frontend"));

      expect(cardMarks).toHaveLength(1);
      expect(cardMarks[0]?.parentElement?.lastElementChild).toBe(cardMarks[0]);
      expect(cardMarks[0]?.closest(".gh-prism-owners-hint")).not.toBeNull();
      expect(dialog()?.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
      expect(
        [...document.querySelectorAll(".gh-prism-mark")].filter(
          (mark) => !dialog()?.contains(mark),
        ),
      ).toEqual([]);
    });

    it("opens the dialog of a team reviewer, its files and its members", async () => {
      show();
      await hoverOpen("frontend");
      const cardListing = listed();

      await clickOn(shieldOf("frontend"));

      expect(dialogName()).toBe("excessive-dev/frontend");
      expect(dialog()?.textContent).toMatch(/Code owner of \d+ files? in this pull request/);
      expect(cardListing.length).toBeGreaterThan(0);
      expect(outline(dialog()?.querySelector("ul"))).toEqual(cardListing);
      expect(dialogItems()).toContain("sandbox-user");
      expect(dialog()?.textContent).not.toContain("See all");
    });

    it("reads a team's members once however often its dialog opens", async () => {
      show();

      await clickOn(shieldOf("frontend"));
      closeDialog();
      await clickOn(shieldOf("frontend"));

      expect(dialog()).not.toBeNull();
      expect(membersFetch.mock.calls.filter(([url]) => url === FRONTEND_MEMBERS)).toHaveLength(1);
    });

    it("opens one dialog, the last-clicked shield's, for clicks before the read settles", async () => {
      let settle = (_: Ownership) => {};
      show(() => new Promise((resolve) => (settle = resolve)));

      await clickOn(shieldOf("frontend"));
      await clickOn(shieldOf("platform"));
      settle({ codeOwners: sandboxOwners(), prReviewers: SANDBOX_REVIEWERS });
      await vi.advanceTimersByTimeAsync(0);

      expect(document.querySelectorAll("dialog.gh-prism-owners-dialog")).toHaveLength(1);
      expect(dialogName()).toBe("excessive-dev/platform");
    });

    it("names the team a reviewer owns files through, and says when its members are hidden", async () => {
      await showNode({ reviewRequests: assignedFromCrypto });
      await clickOn(addAssignedShield("jasnell"));

      expect(dialogName()).toBe("jasnell");
      expect(dialog()?.textContent).toContain("Through nodejs/crypto");
      const block = dialog()?.querySelector("section");
      expect(block?.querySelector("h3")?.textContent).toBe("nodejs/crypto");
      expect(block?.textContent).toContain("GitHub doesn't show you this team's members.");
    });

    it("opens from gh-prism's own shield", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      await clickOn(ownShieldOf("@pimterry"));

      expect(dialogName()).toBe("pimterry");
    });

    it("opens from the PR overview's shield", async () => {
      await showOverview(overviewConversation);

      await clickOn(overviewShieldOf("frontend"));

      expect(dialogName()).toBe("excessive-dev/frontend");
    });

    it("opens nothing for a shield whose reviewer owns no changed file", async () => {
      show(async () => ({
        codeOwners: sandboxOwners((byPath) => {
          for (const [path, entry] of Object.entries(byPath))
            byPath[path] = { ...entry, owners: [] };
        }),
        prReviewers: [],
      }));

      await clickOn(shieldOf("frontend"));

      expect(dialog()).toBeNull();
    });

    it("closes the open popup, and hands focus back to the shield once closed", async () => {
      show();
      await hoverOpen("frontend");
      expect(popup()?.querySelector(".gh-prism-owners-hint")).not.toBeNull();

      await clickOn(shieldOf("frontend"));
      expect(popups()).toHaveLength(0);
      closeDialog();

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(shieldOf("frontend"));
    });
  });

  describe("gh-prism's shield", () => {
    it("marks a reviewer who reviewed for an owning team, beside GitHub's status icon", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      const shield = ownShieldOf("@pimterry");
      expect(ownShields()).toEqual(["@pimterry"]);
      expect(shield.parentElement).toBe(rowOf("pimterry"));
      // Its status link's flex order draws it after the shield, as with GitHub's own.
      expect(shield.previousElementSibling?.id).toBe("review-status-pimterry");
      expect(shield.getAttribute("type")).toBe("button");
      expect(shield.getAttribute("aria-label")).toBe(
        "pimterry is a code owner through nodejs/crypto",
      );
      expect(shield.querySelector("svg")).not.toBeNull();
    });

    it("marks a reviewer who owns files only through a team when GitHub shows no team among the reviewers", async () => {
      await showNode({ cryptoMembers: ["jasnell"] });

      expect(ownShields()).toEqual(["@jasnell"]);
      expect(ownShieldOf("@jasnell").getAttribute("aria-label")).toBe(
        "jasnell is a code owner through nodejs/crypto",
      );
    });

    it("opens the reviewer's files, naming the team, on hover", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      await hoverOn(ownShieldOf("@pimterry"));

      expect(sortedAfterFolder(listed())).toEqual(cryptoListing);
      expect(popup()?.textContent).toContain("Through nodejs/crypto");
      expect(ownShieldOf("@pimterry").getAttribute("aria-describedby")).toBe(
        "gh-prism-reviewer-files",
      );
    });

    it("marks an Enterprise Managed User, whose login has an underscore", async () => {
      await showNode(
        {
          reviewRequests: (body) => {
            reviewedForCrypto(body);
            Object.assign(body.completedReviews[0] ?? {}, {
              reviewer: { displayLogin: "mona-cat_octo", reviewerType: "User" },
            });
          },
        },
        nodeConversation.replaceAll("pimterry", "mona-cat_octo"),
      );

      expect(ownShields()).toEqual(["@mona-cat_octo"]);
    });

    it("marks only reviewers who own a changed file", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      expect(ownShields()).not.toContain("@richardlau");
      expect(ownShields()).not.toContain("@jasnell");
    });

    it("comes back once GitHub replaces the Reviewers list", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      const form = document.querySelector("form") as HTMLFormElement;
      form.replaceWith(form.cloneNode(true));
      for (const shield of document.querySelectorAll("button[data-gh-prism-owner]"))
        shield.remove();
      await vi.advanceTimersByTimeAsync(0);

      expect(ownShields()).toEqual(["@pimterry"]);
    });

    it("goes once the signal aborts", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      controller.abort();

      expect(ownShields()).toEqual([]);
    });
  });

  describe("in the PR overview's reviewer list", () => {
    /**
     * PR #5's reviewers: excessive-dev/frontend, and sandbox-user, a direct code owner too, whom its
     * review assignment picked.
     */
    const assignedReviewers = async () => ({
      codeOwners: sandboxOwners(),
      prReviewers: [
        { token: "@excessive-dev/frontend", teams: [], codeOwner: true },
        { token: "@sandbox-user", teams: ["@excessive-dev/frontend"], codeOwner: true },
      ],
    });
    const iconLabels = (login: string) =>
      [...(rowOf(login).querySelector('[class*="indicators__"]')?.children ?? [])].map((child) =>
        child.getAttribute("aria-label"),
      );

    it("opens a team's files from GitHub's shield", async () => {
      await showOverview(overviewConversation);

      await hoverOn(overviewShieldOf("frontend"));

      expect(listed()).toEqual(["api/generated/", "  client.ts", "web/", "  app.ts"]);
    });

    it("hides the tooltip GitHub opens on its shield, and no other", async () => {
      await showOverview(overviewConversation);

      const [shieldTip, statusTip] = [
        ...(overviewShieldOf("frontend").parentElement?.querySelectorAll("[popover]") ?? []),
      ];

      expect(shieldTip?.textContent).toBe("excessive-dev/frontend is a code owner");
      expect(shieldTip && getComputedStyle(shieldTip).display).toBe("none");
      expect(statusTip && getComputedStyle(statusTip).display).not.toBe("none");
    });

    it("marks the member a team's review assignment picked, before their status icon", async () => {
      await showOverview(overviewAssigned, assignedReviewers);

      expect(ownShields()).toEqual(["@sandbox-user"]);
      expect(iconLabels("sandbox-user")).toEqual([
        "sandbox-user is a code owner",
        "Awaiting requested review from sandbox-user",
      ]);
    });

    it("keeps gh-prism's shield, named as GitHub names its own, as React re-renders the row", async () => {
      await showOverview(overviewAssigned, assignedReviewers);

      rowOf("sandbox-user").append(document.createComment("re-render"));
      await vi.advanceTimersByTimeAsync(0);

      expect(ownShields()).toEqual(["@sandbox-user"]);
    });

    it("removes gh-prism's shield once GitHub draws its own", async () => {
      await showOverview(overviewAssigned, assignedReviewers);

      // GitHub's shield as it draws a team's, with its tooltip.
      rowOf("sandbox-user")
        .querySelector('[role="img"]')
        ?.insertAdjacentHTML(
          "beforebegin",
          '<button data-component="IconButton" type="button" class="prc-Button-ButtonBase-9n-Xk statusIcon__gxAEMz color-fg-muted prc-Button-IconButton-fyge7" data-size="small" data-variant="invisible" aria-labelledby="_r_9_"><svg class="octicon octicon-shield"></svg></button><span class="prc-TooltipV2-Tooltip-tLeuB" data-component="Tooltip" aria-hidden="true" id="_r_9_" popover="auto">sandbox-user is a code owner</span>',
        );
      await vi.advanceTimersByTimeAsync(0);

      expect(ownShields()).toEqual([]);
      expect(rowOf("sandbox-user").querySelectorAll("button")).toHaveLength(1);
    });
  });

  describe("the whole pull request's code owners button", () => {
    const ownersButton = () => document.querySelector<HTMLButtonElement>(".gh-prism-pr-owners");
    const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
    const dialogName = () =>
      document.getElementById(dialog()?.getAttribute("aria-labelledby") ?? "")?.textContent;

    it.each([
      ["the classic sidebar's menu trigger", () => showNode({}, conversationFixture), "DETAILS"],
      ["the classic sidebar's plain heading", () => showNode({}, nodeConversation), "H3"],
      ["the PR overview's heading", () => showOverview(overviewConversation), "H4"],
      [
        "the PR overview's heading over no reviewers",
        () => showOverview(emptyOverviewConversation),
        "H4",
      ],
    ])("sits right before %s, outside it", async (_, showPage, tag) => {
      await showPage();

      expect(document.querySelectorAll(".gh-prism-pr-owners")).toHaveLength(1);
      expect(ownersButton()?.nextElementSibling?.tagName).toBe(tag);
    });

    it("opens the whole pull request's dialog, and its Close button hands focus back", async () => {
      show();
      await vi.advanceTimersByTimeAsync(0);

      ownersButton()?.click();
      expect(dialogName()).toBe("Code owners of this pull request");
      dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

      expect(dialog()).toBeNull();
      expect(document.activeElement).toBe(ownersButton());
    });

    it.each([
      ["the code owners can't be read", undefined],
      [
        "no changed file has a code owner",
        sandboxOwners((byPath) => {
          for (const [path, entry] of Object.entries(byPath))
            byPath[path] = { ...entry, owners: [] };
        }),
      ],
    ])("is absent when %s", async (_, codeOwners) => {
      show(async () => ({ codeOwners, prReviewers: SANDBOX_REVIEWERS }));
      await vi.advanceTimersByTimeAsync(0);

      expect(ownersButton()).toBeNull();
    });

    it("comes back once GitHub replaces the Reviewers form", async () => {
      show();
      await vi.advanceTimersByTimeAsync(0);

      const form = document.querySelector("form") as HTMLFormElement;
      const fresh = form.cloneNode(true) as HTMLFormElement;
      for (const stale of fresh.querySelectorAll(".gh-prism-pr-owners")) stale.remove();
      form.replaceWith(fresh);
      await vi.advanceTimersByTimeAsync(0);

      expect(document.querySelectorAll(".gh-prism-pr-owners")).toHaveLength(1);
      expect(fresh.contains(ownersButton())).toBe(true);
    });

    it("hands focus on close to the button GitHub's replaced form now holds", async () => {
      show();
      await vi.advanceTimersByTimeAsync(0);
      ownersButton()?.click();

      const form = document.querySelector("form") as HTMLFormElement;
      const fresh = form.cloneNode(true) as HTMLFormElement;
      for (const stale of fresh.querySelectorAll(".gh-prism-pr-owners")) stale.remove();
      form.replaceWith(fresh);
      await vi.advanceTimersByTimeAsync(0);
      dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

      expect(document.activeElement).toBe(fresh.querySelector(".gh-prism-pr-owners"));
    });

    it("reads the code owners once the heading shows, before any reviewer is requested", async () => {
      for (const row of document.querySelectorAll(".css-truncate")) row.remove();
      const read = vi.fn(async () => ({
        codeOwners: sandboxOwners(),
        prReviewers: [],
      }));

      show(read);
      await vi.advanceTimersByTimeAsync(0);

      expect(read).toHaveBeenCalledOnce();
      expect(ownersButton()).not.toBeNull();
    });

    it("goes once the signal aborts", async () => {
      show();
      await vi.advanceTimersByTimeAsync(0);

      controller.abort();

      expect(ownersButton()).toBeNull();
    });

    it("opens from the ownership it already read, sending GitHub no new request", async () => {
      document.body.innerHTML = nodeConversation;
      const fetchFn = nodeFetch({ cryptoMembers: ["jasnell"] });
      const { signal } = controller;
      const teamMembers = teamMembersReader(fetchFn, signal);
      const read = vi.fn(() => readOwnership(node, { fetchFn, teamMembers, signal }));
      showReviewerFiles(document, signal, {
        read,
        teamMembers,
        teamAvatar: async () => undefined,
        teamRoster: async () => undefined,
        findAuthors: findCommentAuthors,
      });
      await vi.advanceTimersByTimeAsync(0);
      const requests = fetchFn.mock.calls.length;

      ownersButton()?.click();
      await vi.advanceTimersByTimeAsync(0);

      expect(dialog()).not.toBeNull();
      expect(fetchFn.mock.calls.length).toBe(requests);
      expect(read).toHaveBeenCalledOnce();
    });

    it("reads each owning team's members at most once per visit on a PR with no reviewer", async () => {
      document.body.innerHTML = nodeConversation;
      const fetchFn = nodeFetch({
        cryptoMembers: ["jasnell"],
        reviewRequests: (body) => {
          body.pendingReviewRequests = [];
          body.completedReviews = [];
        },
      });
      const { signal } = controller;
      const teamMembers = teamMembersReader(fetchFn, signal);
      showReviewerFiles(document, signal, {
        read: () => readOwnership(node, { fetchFn, teamMembers, signal }),
        teamMembers,
        teamAvatar: async () => undefined,
        teamRoster: async () => undefined,
        findAuthors: findCommentAuthors,
      });
      await vi.advanceTimersByTimeAsync(0);

      ownersButton()?.click();
      await vi.advanceTimersByTimeAsync(0);
      dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();
      ownersButton()?.click();
      await vi.advanceTimersByTimeAsync(0);

      const members = fetchFn.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.endsWith("/members"));
      expect(members).not.toEqual([]);
      expect(new Set(members).size).toBe(members.length);
    });
  });
});

/** Appends a fresh copy of `markup`'s first timeline item after the page's timeline items. */
function mountTimelineItem(markup: string) {
  const item = '.js-discussion .js-timeline-item, [data-testid="comment-header"]';
  const template = document.createElement("template");
  template.innerHTML = markup;
  const fresh = template.content.querySelector(item)?.closest(".js-timeline-item, article");
  const live = document.querySelector(item)?.closest(".js-timeline-item, article");
  if (!fresh || !live) throw new Error("fixture has no timeline item");
  live.parentElement?.append(fresh);
}

describe.each([
  {
    layout: "the classic timeline",
    load: () => {
      document.body.innerHTML = conversationFixture + commentsFixture;
    },
    findAuthors: findCommentAuthors,
    mountThread: () => mountTimelineItem(commentsFixture),
    reviewers: true,
    resolvedKeepsAuthor: true,
  },
  {
    layout: "the PR overview",
    load: () => {
      document.body.innerHTML = conversationFixture + overviewCommentsFixture;
    },
    findAuthors: findCommentAuthors,
    mountThread: () => mountTimelineItem(overviewCommentsFixture),
    reviewers: true,
    resolvedKeepsAuthor: true,
  },
  {
    layout: "the new Files changed page",
    load: loadCommentsFixture,
    findAuthors: findFilesCommentAuthors,
    mountThread: () => diffList().insertAdjacentHTML("beforeend", COMMENT_THREADS.files),
    reviewers: false,
    resolvedKeepsAuthor: false,
  },
  {
    layout: "the classic Files changed page",
    load: () => loadClassicCommentsFixture(""),
    findAuthors: findFilesCommentAuthors,
    mountThread: () => byId("files").insertAdjacentHTML("beforeend", COMMENT_THREADS.classic),
    reviewers: false,
    resolvedKeepsAuthor: false,
  },
])(
  "a comment author's shield in $layout",
  ({ load, findAuthors, mountThread, reviewers, resolvedKeepsAuthor }) => {
    const authors = () => findAuthors(document);
    beforeEach(() => {
      load();

      expect(authors().length).toBeGreaterThan(0);
    });

    const settle = () => vi.advanceTimersByTimeAsync(0);
    const showHere = (
      read?: () => Promise<Ownership>,
      teamMembers?: TeamMembersOf,
      filter?: OwnerFilter,
    ) => show(read, teamMembers, filter, findAuthors);
    /** Makes `login` the author of `authorsToEdit`, every comment by default. */
    function authoredBy(login: string, authorsToEdit = authors()) {
      for (const { name } of authorsToEdit) {
        const link = (name.matches("a") ? name : name.querySelector("a")) as HTMLAnchorElement;
        const header = name.closest('[data-testid="comment-header"], h3') ?? name;
        const profile = link.getAttribute("href");
        for (const a of header.querySelectorAll(`a[href="${profile}"]`))
          a.setAttribute("href", `/${login}`);
        for (const img of header.querySelectorAll("img[alt]")) img.setAttribute("alt", `@${login}`);
        link.textContent = login;
      }
    }
    /** The last diff table or timeline item holding a comment author. */
    const lastThread = () =>
      authors()
        .map(({ name }) => name.closest(".js-timeline-item, article, table"))
        .findLast((thread) => thread !== null) as Element;
    /** Each comment header's shield names, in page order. */
    const headerShields = () =>
      authors().map(({ name }) =>
        [...(name.parentElement?.querySelectorAll(".gh-prism-comment-shield") ?? [])].map(
          (shield) => shield.getAttribute("aria-label"),
        ),
      );
    const commentShields = () => [
      ...document.querySelectorAll<HTMLElement>(".gh-prism-comment-shield"),
    ];
    /** A members reader listing `members` as excessive-dev/frontend's, and counting its reads. */
    function frontendListing(members: readonly string[]) {
      const fetchFn = routedFetch({
        [FRONTEND_MEMBERS]: () =>
          Promise.resolve(new Response(JSON.stringify({ total: members.length, members }))),
      });
      return { fetchFn, teamMembers: teamMembersReader(fetchFn, controller.signal) };
    }
    const reads = (fetchFn: ReturnType<typeof routedFetch>, url: string) =>
      fetchFn.mock.calls.filter(([input]) => String(input) === url).length;

    it("shields every comment header of an author who owns files directly and through a team", async () => {
      showHere();
      await settle();

      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
      expect(authors()[0]?.name.nextElementSibling).toBe(commentShields()[0]);
    });

    it("names the team for an author whom only its members list makes an owner", async () => {
      authoredBy("other-user");
      showHere(undefined, frontendListing(["other-user"]).teamMembers);
      await settle();

      expect(headerShields()).toEqual(
        authors().map(() => ["other-user is a code owner through excessive-dev/frontend"]),
      );
    });

    it.each([
      ["owns nothing", "nobody", () => ({ codeOwners: sandboxOwners(), prReviewers: [] })],
      [
        "can't be checked against CODEOWNERS",
        "sandbox-user",
        () => ({ codeOwners: undefined, prReviewers: SANDBOX_REVIEWERS }),
      ],
    ])("shields no author who %s", async (_case, login, ownership) => {
      authoredBy(login);
      showHere(async () => ownership());
      await settle();

      expect(commentShields()).toEqual([]);
    });

    it("shields no author who owns files only through a team whose members can't be read", async () => {
      authoredBy("other-user");
      showHere(undefined, teamMembersReader(routedFetch({}), controller.signal));
      await settle();

      expect(commentShields()).toEqual([]);
    });

    it("shields the viewer, who is also the pull request's author", async () => {
      document.head.append(
        Object.assign(document.createElement("meta"), {
          name: "user-login",
          content: "sandbox-user",
        }),
      );
      showHere();
      await settle();

      expect(commentShields()).toHaveLength(authors().length);
    });

    it("shields no bot or deleted account, and still shields an owner elsewhere on the page", async () => {
      const [first, ...rest] = authors();
      authoredBy("ghost", first ? [first] : []);
      showHere();
      await settle();

      expect(headerShields()).toEqual([[], ...rest.map(() => ["sandbox-user is a code owner"])]);
      expect(commentShields()).toHaveLength(rest.length);
    });

    // A resolved classic Files changed thread holds only an `include-fragment`, with no author.
    it.runIf(resolvedKeepsAuthor)("keeps the shield on a resolved, collapsed thread", async () => {
      const thread = document.querySelector("review-thread-collapsible");
      thread?.setAttribute("data-resolved", "true");
      thread?.classList.remove("open");
      showHere();
      await settle();

      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
    });

    it("shields a comment appended after the page loaded", async () => {
      showHere();
      await settle();
      const before = authors().length;

      mountThread();
      await settle();

      expect(authors().length).toBeGreaterThan(before);
      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
    });

    it("draws a shield on a thread that mounts after the shields settle", async () => {
      showHere();
      await settle();

      mountThread();
      await settle();

      const added = authors().at(-1)?.name;
      expect(added?.parentElement?.querySelectorAll(".gh-prism-comment-shield")).toHaveLength(1);
    });

    it("draws one shield on a thread whose diff unmounts and remounts", async () => {
      showHere();
      await settle();

      lastThread().remove();
      mountThread();
      await settle();

      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
      for (const { name } of authors())
        expect(name.nextElementSibling?.matches(".gh-prism-comment-shield")).toBe(true);
    });

    it("draws one fresh shield in a header whose nodes the page replaced", async () => {
      showHere();
      await settle();

      const row = authors()[0]?.name.parentElement as Element;
      const fresh = row.cloneNode(true) as Element;
      for (const shield of fresh.querySelectorAll(".gh-prism-comment-shield")) shield.remove();
      row.replaceWith(fresh);
      await settle();

      expect(fresh.querySelectorAll(".gh-prism-comment-shield")).toHaveLength(1);
      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
    });

    it("draws one shield per header across mutation batches with a lookup settling between them", async () => {
      const members = Promise.withResolvers<{ total: number; members: string[] } | undefined>();
      showHere(undefined, () => members.promise);
      await settle();

      document.body.append(document.createElement("div"));
      await settle();
      members.resolve({ total: 1, members: ["sandbox-user"] });
      document.body.append(document.createElement("div"));
      await settle();
      document.body.append(document.createElement("div"));
      await settle();

      expect(headerShields()).toEqual(authors().map(() => ["sandbox-user is a code owner"]));
    });

    it("opens the popup with the filter action on hover", async () => {
      const FILES = "https://github.com/o/r/pull/1/files";
      showHere(undefined, undefined, {
        linkOf: (token) => ({ href: `${FILES}?gh-prism-owner=${token}`, shown: false }),
        navigate: () => {},
      });
      await settle();

      await hoverOn(commentShields()[0] as Element);

      expect(listed()).toEqual([
        "api/",
        "  generated/",
        "    client.ts",
        "  routes.ts",
        "docs/",
        "  guide.md",
        "web/",
        "  app.ts",
      ]);
      expect(popup()?.querySelector<HTMLAnchorElement>("a.gh-prism-owner-filter")?.href).toBe(
        `${FILES}?gh-prism-owner=@sandbox-user`,
      );
    });

    it("opens the code owner details dialog on click, listing the author's files", async () => {
      showHere();
      await settle();

      commentShields()[0]?.click();
      await settle();

      const dialog = document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
      expect(dialog?.textContent).toContain("sandbox-user");
      expect(outline(dialog?.querySelector("ul"))).toEqual([
        "api/",
        "  generated/",
        "    client.ts",
        "  routes.ts",
        "docs/",
        "  guide.md",
        "web/",
        "  app.ts",
      ]);
    });

    it("opens the dialog on click when an ancestor stops the click's propagation", async () => {
      showHere();
      await settle();
      const shield = commentShields()[0] as HTMLElement;
      shield.parentElement?.addEventListener("click", (event) => event.stopPropagation());

      shield.click();
      await settle();

      expect(document.querySelector("dialog.gh-prism-owners-dialog")?.textContent).toContain(
        "sandbox-user",
      );
    });

    it("removes every comment shield once the signal aborts", async () => {
      showHere();
      await settle();

      controller.abort();

      expect(commentShields()).toEqual([]);
    });

    describe("for an author who is also a PR reviewer", () => {
      const ownership = async (): Promise<Ownership> => ({
        codeOwners: sandboxOwners(),
        prReviewers: [
          ...SANDBOX_REVIEWERS,
          { token: "@sandbox-user", teams: ["@excessive-dev/frontend"], codeOwner: false },
        ],
      });
      const dialog = () =>
        document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
      const closeDialog = () =>
        dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

      beforeEach(() => {
        if (!reviewers) return;
        const teamRow = shieldOf("frontend").parentElement as Element;
        const row = teamRow.cloneNode(true) as Element;
        row.querySelector('[id^="codeowner-"]')?.remove();
        for (const link of row.querySelectorAll("a")) link.setAttribute("href", "/sandbox-user");
        teamRow.after(row);
      });
      const rowShield = () =>
        document.querySelector<HTMLElement>(
          '.gh-prism-reviewer-shield[data-gh-prism-owner="@sandbox-user"]',
        ) as HTMLElement;

      it.runIf(reviewers)(
        "lists the same files from the comment's shield as from the Reviewers row's",
        async () => {
          showHere(ownership);
          await settle();

          await hoverOn(rowShield());
          const fromRow = listed();
          pointerOut(rowShield());
          await vi.advanceTimersByTimeAsync(500);
          await hoverOn(commentShields()[0] as Element);

          expect(fromRow.length).toBeGreaterThan(0);
          expect(listed()).toEqual(fromRow);
        },
      );

      it.runIf(reviewers)(
        "opens the same dialog from the comment's shield as from the Reviewers row's",
        async () => {
          showHere(ownership);
          await settle();

          rowShield().click();
          await settle();
          const fromRow = dialog()?.textContent;
          closeDialog();
          commentShields()[0]?.click();
          await settle();

          expect(fromRow).toContain("frontend");
          expect(dialog()?.textContent).toBe(fromRow);
        },
      );
    });

    describe("reads", () => {
      beforeEach(() => {
        const all = authors();
        authoredBy("other-user", all.slice(1, 2));
        authoredBy("third-user", all.slice(2, 3));
      });

      it.each([
        ["with PR reviewers", SANDBOX_REVIEWERS],
        ["without PR reviewers", undefined],
      ])(
        "reads the code owners once and each owning team's members once, %s",
        async (_case, prReviewers) => {
          const read = vi.fn(async () => ({ codeOwners: sandboxOwners(), prReviewers }));
          const { fetchFn, teamMembers } = frontendListing(["sandbox-user"]);
          showHere(read, teamMembers);
          await settle();

          mountThread();
          await settle();

          expect(read).toHaveBeenCalledOnce();
          expect(reads(fetchFn, FRONTEND_MEMBERS)).toBe(1);
          const urls = fetchFn.mock.calls.map(([input]) => String(input));
          expect(urls).toEqual([...new Set(urls)]);
        },
      );

      it.runIf(reviewers)(
        "reads the code owners on a page with comments and no Reviewers list",
        async () => {
          document.getElementById("partial-discussion-sidebar")?.remove();
          expect(findReviewerRows(document)).toEqual([]);
          const read = vi.fn(async () => ({ codeOwners: sandboxOwners(), prReviewers: [] }));
          showHere(read);
          await settle();

          expect(read).toHaveBeenCalledOnce();
          expect(commentShields().length).toBeGreaterThan(0);
        },
      );
    });

    it.runIf(reviewers).each([
      ["isn't among the PR reviewers", []],
      ["sits beside PR reviewers that couldn't be read", undefined],
    ])(
      "lists the direct files of a GitHub-shielded commenter who %s",
      async (_case, prReviewers) => {
        const teamRow = shieldOf("frontend").parentElement as Element;
        const row = teamRow.cloneNode(true) as Element;
        const githubShield = row.querySelector('[id^="codeowner-"]') as HTMLElement;
        githubShield.id = "assigned-codeowner-sandbox-user";
        for (const link of row.querySelectorAll("a")) link.setAttribute("href", "/sandbox-user");
        teamRow.after(row);
        const members = Promise.withResolvers<{ total: number; members: string[] } | undefined>();
        showHere(
          async () => ({ codeOwners: sandboxOwners(), prReviewers }),
          () => members.promise,
        );
        await settle();
        const direct = ["api/", "  routes.ts", "docs/", "  guide.md"];

        await hoverOn(githubShield);
        const whilePending = listed();
        pointerOut(githubShield);
        await vi.advanceTimersByTimeAsync(500);
        members.resolve({ total: 1, members: ["sandbox-user"] });
        await settle();
        await hoverOn(githubShield);

        expect(commentShields().length).toBeGreaterThan(0);
        expect(whilePending).toEqual(direct);
        expect(listed()).toEqual(direct);
      },
    );
  },
);

it.each([
  [
    "the classic timeline",
    () => {
      document.body.innerHTML = conversationFixture + commentsFixture;
    },
    findCommentAuthors,
  ],
  ["the classic Files changed page", () => loadClassicCommentsFixture(""), findFilesCommentAuthors],
])(
  "paints a comment author's shield muted in %s, as GitHub paints its own",
  async (_page, load, findAuthors) => {
    load();
    // GitHub's .btn-link paints link blue; its .muted-icon rule applies only in the sidebar.
    document.head.innerHTML =
      "<style>:root{--fgColor-muted:rgb(89, 99, 110);--fgColor-accent:rgb(9, 105, 218)}.btn-link{color:var(--fgColor-accent)}</style>";
    show(undefined, undefined, undefined, findAuthors);
    await vi.advanceTimersByTimeAsync(0);

    const shield = document.querySelector(".gh-prism-comment-shield") as HTMLElement;
    expect(getComputedStyle(shield).color).toBe("rgb(89, 99, 110)");
  },
);
