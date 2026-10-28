// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Ownership,
  showReviewerFiles,
} from "../../../entrypoints/content/conversation/reviewer-files";
import {
  codeOwnerOf,
  type PrCodeOwners,
  type PrReviewer,
  readCodeOwners,
  readPrReviewers,
} from "../../../utils/github/code-owners";
import type { DiffRef } from "../../../utils/github/pr-ref";
import nodeCodeowners from "../../fixtures/codeowners-node.json?raw";
import sandboxCodeowners from "../../fixtures/codeowners-sandbox.json?raw";
import nodeConversation from "../../fixtures/conversation-node.html?raw";
import overviewConversation from "../../fixtures/conversation-overview.html?raw";
import conversationFixture from "../../fixtures/conversation-page.html?raw";
import { routedFetch } from "../../fixtures/fetch";
import nodeReviewRequests from "../../fixtures/review-requests-node.json?raw";

// Chrome content scripts run in an isolated world whose `customElements` is null.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

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
const node: DiffRef = { kind: "pr", owner: "nodejs", repo: "node", number: 67056 };
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
}

/** nodejs/node#67056's code owners and PR reviewers, read from its captures after `edits`. */
async function nodeOwnership({ ownership, reviewRequests }: NodeEdits = {}): Promise<Ownership> {
  const codeowners = JSON.parse(nodeCodeowners);
  ownership?.(codeowners.ownershipByPath);
  const requests = JSON.parse(nodeReviewRequests);
  reviewRequests?.(requests);
  const fetchFn = routedFetch({
    "https://github.com/nodejs/node/pull/67056/page_data/codeowners": () =>
      Promise.resolve(new Response(JSON.stringify(codeowners))),
    "https://github.com/nodejs/node/pull/67056/page_data/review_requests": () =>
      Promise.resolve(new Response(JSON.stringify(requests))),
  });
  const { signal } = new AbortController();
  return {
    codeOwners: await readCodeOwners(node, fetchFn, signal),
    prReviewers: await readPrReviewers(node, fetchFn, signal),
  };
}

/** A team as review_requests names one. */
const team = (displayLogin: string) => ({ displayLogin, name: "", reviewerType: "Team" });
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

function show(
  read: () => Promise<Ownership> = async () => ({
    codeOwners: sandboxOwners(),
    prReviewers: SANDBOX_REVIEWERS,
  }),
) {
  showReviewerFiles(document, controller.signal, read);
}

/** Shows the popups on nodejs/node#67056's `page`, read after `edits`, once its reads settle. */
async function showNode(edits: NodeEdits = {}, page = nodeConversation) {
  document.body.innerHTML = page;
  const ownership = await nodeOwnership(edits);
  show(async () => ownership);
  await vi.advanceTimersByTimeAsync(0);
}

const shieldOf = (team: string) =>
  document.getElementById(`codeowner-excessive-dev/${team}`) as HTMLElement;
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
const listed = () => [...(popup()?.querySelectorAll("li") ?? [])].map((li) => li.textContent);

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
    expect(listed()).toEqual(["api/generated/client.ts", "web/app.ts"]);
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
    show(async () => ({ codeOwners: undefined, prReviewers: SANDBOX_REVIEWERS }));

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
      new FocusEvent("focusout", { bubbles: true, relatedTarget: document.body }),
    );

    expect(popups()).toHaveLength(0);
    expect(shieldOf("frontend").hasAttribute("aria-describedby")).toBe(false);
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
    expect(listed()).toEqual(["infra/deploy.yml", "api/routes.ts"]);
  });

  it("closes on a scroll outside it", async () => {
    show();
    await hoverOpen("frontend");

    document.dispatchEvent(new Event("scroll"));

    expect(popups()).toHaveLength(0);
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
        byPath[path] = { owners: ["@excessive-dev/frontend"], isOwnedByViewer: false };
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
    read.resolve({ codeOwners: sandboxOwners(), prReviewers: SANDBOX_REVIEWERS });
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing after Escape while the code owners are still being read", async () => {
    const read = Promise.withResolvers<Ownership>();
    show(() => read.promise);

    await hoverOpen("frontend");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    read.resolve({ codeOwners: sandboxOwners(), prReviewers: SANDBOX_REVIEWERS });
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

      expect(listed()).toEqual(["test/cctest/test_node_crypto.cc"]);
      expect(popup()?.querySelector("a")).toBeNull();
    });

    it("lists the team's files, naming and linking the team, when assigned on its behalf", async () => {
      await showNode({ reviewRequests: assignedFromCrypto });

      await hoverJasnellsShield();

      expect(listed().sort()).toEqual(NODE_CRYPTO);
      const teamLink = popup()?.querySelector("a");
      expect(teamLink?.textContent).toBe("@nodejs/crypto");
      expect(teamLink?.href).toBe("https://github.com/orgs/nodejs/teams/crypto");
      expect(popup()?.textContent).toContain("Through @nodejs/crypto");
    });

    it("says why it lists nothing when GitHub names no team", async () => {
      await showNode({ reviewRequests: markedCodeOwner });

      await hoverJasnellsShield();

      expect(listed()).toEqual([]);
      expect(popup()?.textContent).toBe(
        "GitHub doesn't show you which team makes them a code owner, so their files aren't listed.",
      );
    });
  });

  describe("gh-prism's shield", () => {
    it("marks a reviewer who reviewed for an owning team, beside GitHub's status icon", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      const shield = ownShieldOf("@pimterry");
      expect(ownShields()).toEqual(["@pimterry"]);
      expect(shield.parentElement).toBe(rowOf("pimterry"));
      expect(shield.getAttribute("type")).toBe("button");
      expect(shield.getAttribute("aria-label")).toBe(
        "pimterry is a code owner through nodejs/crypto",
      );
      expect(shield.querySelector("svg")).not.toBeNull();
    });

    it("opens the reviewer's files, naming the team, on hover", async () => {
      await showNode({ reviewRequests: reviewedForCrypto });

      await hoverOn(ownShieldOf("@pimterry"));

      expect(listed().sort()).toEqual(NODE_CRYPTO);
      expect(popup()?.textContent).toContain("Through @nodejs/crypto");
      expect(ownShieldOf("@pimterry").getAttribute("aria-describedby")).toBe(
        "gh-prism-reviewer-files",
      );
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
    it("opens a user's files from GitHub's shield", async () => {
      await showNode(
        {
          ownership: (byPath) => {
            byPath["test/cctest/test_node_crypto.cc"] = {
              owners: ["@jasnell"],
              isOwnedByViewer: false,
            };
          },
        },
        overviewConversation,
      );

      await hoverOn(
        document.querySelector('button[aria-label="jasnell is a code owner"]') as Element,
      );

      expect(listed()).toEqual(["test/cctest/test_node_crypto.cc"]);
    });

    it("puts gh-prism's shield in the icon column, before the status icon", async () => {
      await showNode({ reviewRequests: reviewedForCrypto }, overviewConversation);

      const icons = rowOf("pimterry").querySelector('[class*="indicators__"]');
      expect(ownShields()).toEqual(["@pimterry"]);
      expect([...(icons?.children ?? [])].map((child) => child.getAttribute("aria-label"))).toEqual(
        [
          "Re-request review from pimterry",
          "pimterry is a code owner through nodejs/crypto",
          "Approved these changes",
        ],
      );
    });
  });
});
