// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showReviewerFiles } from "../../../entrypoints/content/conversation/reviewer-files";
import { codeOwnerOf, type PrCodeOwners } from "../../../utils/github/code-owners";
import sandboxCodeowners from "../../fixtures/codeowners-sandbox.json?raw";
import conversationFixture from "../../fixtures/conversation-page.html?raw";

// Chrome content scripts run in an isolated world whose `customElements` is null.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

// happy-dom has no Popover API.
HTMLElement.prototype.showPopover = () => {};
HTMLElement.prototype.hidePopover = () => {};

interface Ownership {
  readonly owners: readonly string[];
  readonly isOwnedByViewer: boolean;
}

/** The sandbox pull request's code owners, with `edit` applied to the raw body first. */
function sandboxOwners(edit: (byPath: Record<string, Ownership>) => void = () => {}): PrCodeOwners {
  const byPath: Record<string, Ownership> = JSON.parse(sandboxCodeowners).ownershipByPath;
  edit(byPath);
  return new Map(
    Object.entries(byPath).map(([path, { owners, isOwnedByViewer }]) => [
      path,
      { owners: owners.map(codeOwnerOf), ownedByViewer: isOwnedByViewer },
    ]),
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

function show(codeOwners: () => Promise<PrCodeOwners | undefined> = async () => sandboxOwners()) {
  showReviewerFiles(document, controller.signal, codeOwners);
}

const shieldOf = (team: string) =>
  document.getElementById(`codeowner-excessive-dev/${team}`) as HTMLElement;
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
  pointerOver(shieldOf(team));
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
    show(async () =>
      sandboxOwners((byPath) => {
        for (const [path, entry] of Object.entries(byPath)) byPath[path] = { ...entry, owners: [] };
      }),
    );

    await hoverOpen("frontend");

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing when the code owners can't be read", async () => {
    show(async () => undefined);

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
    show(async () =>
      sandboxOwners((byPath) => {
        byPath[path] = { owners: ["@excessive-dev/frontend"], isOwnedByViewer: false };
      }),
    );

    await hoverOpen("frontend");

    expect(listed()).toContain(path);
    expect(popup()?.querySelector("img")).toBeNull();
  });

  it("reads the code owners once, as the first hover starts", async () => {
    const codeOwners = vi.fn(async () => sandboxOwners());
    show(codeOwners);

    pointerOver(shieldOf("frontend"));
    const atHover = codeOwners.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);
    pointerOut(shieldOf("frontend"));
    await vi.advanceTimersByTimeAsync(150);
    await hoverOpen("platform");

    expect(atHover).toBe(1);
    expect(codeOwners).toHaveBeenCalledOnce();
  });

  it("opens nothing when the pointer leaves while the code owners are still being read", async () => {
    const read = Promise.withResolvers<PrCodeOwners | undefined>();
    show(() => read.promise);

    await hoverOpen("frontend");
    pointerOut(shieldOf("frontend"));
    read.resolve(sandboxOwners());
    await vi.advanceTimersByTimeAsync(500);

    expect(popups()).toHaveLength(0);
  });

  it("opens nothing after Escape while the code owners are still being read", async () => {
    const read = Promise.withResolvers<PrCodeOwners | undefined>();
    show(() => read.promise);

    await hoverOpen("frontend");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    read.resolve(sandboxOwners());
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
});
