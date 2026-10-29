// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showOwnerSection } from "../../../entrypoints/content/sidebar/owner-section";
import type { FileOwners, PrCodeOwners } from "../../../utils/github/code-owners";
import {
  addOwnedByGroup,
  closeFilterMenu,
  foundPage,
  loadFixture,
  openFilterMenu,
} from "../../fixtures/files-page";

const PR = "/excessive-dev/gh-prism-codeowners-sandbox/pull/1/changes";
const FRONTEND = "@excessive-dev/frontend";
const PLATFORM = "@excessive-dev/platform";

const owned = (...tokens: string[]): FileOwners => ({
  owners: tokens.map((token) => ({ token })),
  ownedByViewer: false,
});
const codeOwnersOf = (reviewers: string[]): PrCodeOwners => ({
  byPath: new Map([
    ["web/app.ts", owned(FRONTEND)],
    ["infra/main.tf", owned(PLATFORM)],
    ["docs/readme.md", owned("@sandbox-user")],
  ]),
  reviewers,
});
const SANDBOX = codeOwnersOf([FRONTEND, PLATFORM, "@nobody"]);

let controller: AbortController;
const navigate = vi.fn<(href: string) => void>();

/** Shows the section with `codeOwners`, then lets the read settle. */
async function show(...codeOwners: [PrCodeOwners | undefined] | []) {
  showOwnerSection(foundPage(), controller.signal, {
    codeOwners: Promise.resolve(codeOwners.length ? codeOwners[0] : SANDBOX),
    navigate,
  });
  await flush();
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const section = () => document.querySelector<HTMLElement>(".gh-prism-owner-section");
const entries = () => [
  ...(section()?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
];
const entry = (text: string) => {
  const found = entries().find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`no entry ${text}`);
  return found;
};
const githubItem = () => {
  const item = document.querySelector<HTMLElement>('[role="menuitemradio"][aria-keyshortcuts="o"]');
  if (!item) throw new Error("no owned-by item");
  return item;
};
const githubGroup = () => githubItem().closest<HTMLElement>('[data-component="ActionList.Group"]');

beforeEach(() => {
  loadFixture();
  document.head.innerHTML = '<meta name="user-login" content="sandbox-user">';
  history.replaceState(null, "", PR);
  controller = new AbortController();
  navigate.mockReset();
});

afterEach(() => {
  controller.abort();
  closeFilterMenu();
});

describe("showOwnerSection", () => {
  it("stands in for GitHub's owned-by group with Me and each owning reviewer", async () => {
    openFilterMenu("owner");

    await show();

    expect(section()?.nextElementSibling).toBe(githubGroup());
    expect(section()?.querySelector('[data-component="GroupHeadingWrap"]')?.textContent).toBe(
      "Only files owned by…",
    );
    expect(entries().map((item) => item.textContent?.trim())).toEqual(["Me", FRONTEND, PLATFORM]);
    expect(entries().map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(getComputedStyle(githubGroup() as HTMLElement).display).toBe("none");
    expect(githubItem().hasAttribute("disabled")).toBe(true);
  });

  it("labels each entry by its own label", async () => {
    openFilterMenu("owner");

    await show();

    for (const item of entries()) {
      const label = document.getElementById(item.getAttribute("aria-labelledby") ?? "");
      expect(label?.textContent).toBe(item.textContent?.trim());
      expect(item.tabIndex).toBe(-1);
    }
  });

  it("follows the first divider with a divider of its own when you own no file", async () => {
    const list = openFilterMenu("notOwner");
    const divider = list.querySelector('[data-component="ActionList.Divider"]');

    await show();

    expect(divider?.nextElementSibling).toBe(section());
    expect(section()?.nextElementSibling?.getAttribute("data-component")).toBe(
      "ActionList.Divider",
    );
    expect(entries().map((item) => item.textContent?.trim())).toEqual([FRONTEND, PLATFORM]);
  });

  it("stands in for GitHub's owned-by group once it appears in the open menu", async () => {
    const list = openFilterMenu("notOwner");
    await show();

    addOwnedByGroup(list);
    await flush();

    expect(section()?.nextElementSibling).toBe(githubGroup());
    expect(entries().map((item) => item.textContent?.trim())).toEqual(["Me", FRONTEND, PLATFORM]);
    expect(getComputedStyle(githubGroup() as HTMLElement).display).toBe("none");
    expect(githubItem().hasAttribute("disabled")).toBe(true);
    expect(list.querySelectorAll('[data-component="ActionList.Divider"]')).toHaveLength(2);
  });

  it("adds no style when the pull request has no CODEOWNERS", async () => {
    openFilterMenu("notOwner");

    await show({ byPath: new Map(), reviewers: [] });

    expect(document.head.querySelector("style")).toBeNull();
  });

  it("adds the section again, once, each time the menu reopens", async () => {
    openFilterMenu("owner");
    await show();

    closeFilterMenu();
    await flush();
    openFilterMenu("owner");
    await flush();

    expect(document.querySelectorAll(".gh-prism-owner-section")).toHaveLength(1);
  });

  describe("a reviewer pick", () => {
    beforeEach(() => {
      history.replaceState(null, "", `${PR}?owned-by%5B%5D=sandbox-user&file-filters%5B%5D=.ts`);
    });

    it.each([
      { how: "click", pick: (item: HTMLElement) => item.click() },
      {
        how: "Enter",
        pick: (item: HTMLElement) =>
          item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
      },
      {
        how: "Space",
        pick: (item: HTMLElement) =>
          item.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })),
      },
    ])("loads the page narrowed to that reviewer on $how", async ({ pick }) => {
      openFilterMenu("owner");
      await show();

      pick(entry(FRONTEND));

      expect(navigate).toHaveBeenCalledOnce();
      const url = new URL(navigate.mock.calls[0]?.[0] ?? "");
      expect(url.searchParams.get("gh-prism-owner")).toBe("excessive-dev/frontend");
      expect(url.searchParams.has("owned-by[]")).toBe(false);
      expect(url.searchParams.get("file-filters[]")).toBe(".ts");
    });

    it("clears the owner when picking the reviewer already on", async () => {
      history.replaceState(null, "", `${PR}?gh-prism-owner=excessive-dev/frontend`);
      openFilterMenu("owner");
      await show();

      expect(entry(FRONTEND).getAttribute("aria-checked")).toBe("true");
      entry(FRONTEND).click();

      expect(new URL(navigate.mock.calls[0]?.[0] ?? "").searchParams.has("gh-prism-owner")).toBe(
        false,
      );
    });
  });

  it("forwards a Me pick to GitHub's item when no owner is on", async () => {
    openFilterMenu("owner");
    await show();
    const click = vi.spyOn(githubItem(), "click");

    entry("Me").click();

    expect(click).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("loads GitHub's own owned-by filter for Me while a reviewer is on", async () => {
    history.replaceState(null, "", `${PR}?gh-prism-owner=excessive-dev/frontend`);
    openFilterMenu("owner");
    await show();

    entry("Me").click();

    const url = new URL(navigate.mock.calls[0]?.[0] ?? "");
    expect(url.searchParams.get("owned-by[]")).toBe("sandbox-user");
    expect(url.searchParams.has("gh-prism-owner")).toBe(false);
  });

  it("checks Me when GitHub's item is checked", async () => {
    openFilterMenu("owner");
    githubItem().setAttribute("aria-checked", "true");

    await show();

    expect(entry("Me").getAttribute("aria-checked")).toBe("true");
  });

  it("closes the menu with Escape after a pick", async () => {
    openFilterMenu("owner");
    await show();
    const item = entry(FRONTEND);
    const keys: string[] = [];
    item.addEventListener("keydown", (event) => keys.push(event.key));

    item.click();

    expect(keys).toEqual(["Escape"]);
  });

  it.each([
    { case: "the code owners don't arrive", kind: "owner" as const, codeOwners: undefined },
    {
      case: "no CODEOWNERS",
      kind: "notOwner" as const,
      codeOwners: { byPath: new Map(), reviewers: [FRONTEND] },
    },
    {
      case: "no owning reviewer",
      kind: "notOwner" as const,
      codeOwners: codeOwnersOf(["@nobody"]),
    },
  ])("adds nothing when $case", async ({ kind, codeOwners }) => {
    openFilterMenu(kind);

    await show(codeOwners);

    expect(section()).toBeNull();
  });

  it("leaves GitHub's item in place when the menu is unrecognized", async () => {
    openFilterMenu("owner");
    githubItem().after(githubItem().cloneNode(true));

    await show();

    expect(section()).toBeNull();
    expect(getComputedStyle(githubGroup() as HTMLElement).display).not.toBe("none");
    expect(githubItem().hasAttribute("disabled")).toBe(false);
  });

  it("gives you no entry of your own among the reviewers", async () => {
    openFilterMenu("owner");

    await show(codeOwnersOf(["@sandbox-user", FRONTEND]));

    expect(entries().map((item) => item.textContent?.trim())).toEqual(["Me", FRONTEND]);
  });

  it("leaves GitHub's other groups untouched", async () => {
    const list = openFilterMenu("owner");
    const others = () =>
      [...list.querySelectorAll('ul[role="group"][aria-label]')]
        .filter((group) => !group.closest(".gh-prism-owner-section"))
        .map((group) => group.outerHTML);
    const before = others();

    await show();

    expect(others()).toEqual(before);
  });

  it("removes everything it added when the page's signal aborts", async () => {
    openFilterMenu("owner");
    await show();

    controller.abort();

    expect(section()).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
    expect(githubItem().hasAttribute("disabled")).toBe(false);
  });
});
