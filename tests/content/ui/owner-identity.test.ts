// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  followOwnerTooltips,
  memberIdentity,
  type OwnerIdentities,
  ownerIdentity,
} from "../../../entrypoints/content/ui/owner-identity";
import type { OwnerFilter } from "../../../entrypoints/content/ui/owners-dialog";
import { codeOwnerOf } from "../../../utils/github/code-owners";

// happy-dom has no Popover API.
const shown = new Set<HTMLElement>();
HTMLElement.prototype.showPopover = function (this: HTMLElement) {
  shown.add(this);
};
HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
  shown.delete(this);
};

const FILES = "https://github.com/o/r/pull/1/files";
const noAvatar: OwnerIdentities["teamAvatar"] = async () => undefined;

/** A filter whose links narrow `FILES` to each token, the page already narrowed to `current`. */
function filtering(current?: string): { filter: OwnerFilter; navigate: ReturnType<typeof vi.fn> } {
  const navigate = vi.fn();
  return {
    filter: {
      linkOf: (token) =>
        token === current
          ? { href: FILES, shown: true }
          : { href: `${FILES}?gh-prism-owner=${token.slice(1)}`, shown: false },
      navigate,
    },
    navigate,
  };
}

const identityOf = (token: string, ids: Partial<OwnerIdentities> = {}) =>
  ownerIdentity(document, codeOwnerOf(token), { teamAvatar: noAvatar, ...ids }) as HTMLElement;
const linkOf = (identity: Element) => identity.querySelector<HTMLAnchorElement>("a.gh-prism-owner");
const filterOf = (identity: Element) =>
  identity.querySelector<HTMLAnchorElement>("a.gh-prism-owner-filter-icon");

beforeEach(() => {
  document.body.replaceChildren();
  shown.clear();
});

describe("ownerIdentity", () => {
  it("links a team's avatar and name, as one link named by the name, to its team page in a new tab", () => {
    const identity = identityOf("@o/team");

    const link = linkOf(identity);
    expect([link?.href, link?.target, link?.rel, link?.textContent]).toEqual([
      "https://github.com/orgs/o/teams/team",
      "_blank",
      "noopener noreferrer",
      "o/team",
    ]);
    expect(link?.querySelector(".gh-prism-avatar")).not.toBeNull();
    expect(identity.querySelectorAll("a")).toHaveLength(1);
    expect(identity.querySelector("[data-tooltip], [aria-label]")).toBeNull();
  });

  it("draws a user's avatar from their login at once, inside the link to their profile", () => {
    const link = linkOf(identityOf("@someone"));

    expect([link?.href, link?.querySelector("img")?.src, link?.querySelector("img")?.alt]).toEqual([
      "https://github.com/someone",
      "https://avatars.githubusercontent.com/someone?s=32",
      "",
    ]);
  });

  it("draws a team's avatar once its read lands", async () => {
    const teamAvatar = vi.fn(async () => "https://avatars.githubusercontent.com/t/7?s=32&v=4");

    const identity = identityOf("@o/team", { teamAvatar });

    expect(teamAvatar).toHaveBeenCalledExactlyOnceWith("@o/team");
    await vi.waitFor(() =>
      expect(linkOf(identity)?.querySelector("img")?.src).toBe(
        "https://avatars.githubusercontent.com/t/7?s=32&v=4",
      ),
    );
    expect(linkOf(identity)?.querySelector(".gh-prism-avatar-none")).toBeNull();
  });

  it("draws a placeholder inside the link for a team whose avatar can't be read", async () => {
    const identity = identityOf("@o/team");

    await vi.waitFor(() =>
      expect(linkOf(identity)?.querySelector(".gh-prism-avatar-none svg")).not.toBeNull(),
    );
    expect(linkOf(identity)?.querySelector("img")).toBeNull();
  });

  it("swaps a team's avatar that fails to load for the placeholder", async () => {
    const identity = identityOf("@o/team", { teamAvatar: async () => "https://x.test/t.png" });
    await vi.waitFor(() => expect(linkOf(identity)?.querySelector("img")).not.toBeNull());

    linkOf(identity)?.querySelector("img")?.dispatchEvent(new Event("error"));

    expect(linkOf(identity)?.querySelector("img")).toBeNull();
    expect(linkOf(identity)?.querySelector(".gh-prism-avatar-none")).not.toBeNull();
  });

  it("shows a token with no page as plain text, with no avatar", () => {
    const identity = identityOf("dev@example.com", { filter: filtering().filter });

    expect(identity.textContent).toBe("dev@example.com");
    expect(identity.querySelector("a, img")).toBeNull();
  });
});

describe("an owner's filter icon, given a filter", () => {
  it("follows the name, linking to that owner's files and naming whose they are", () => {
    const identity = identityOf("@o/team", { filter: filtering().filter });

    const filter = filterOf(identity);
    expect([
      filter?.href,
      filter?.getAttribute("aria-label"),
      filter?.dataset.tooltip,
      filter?.previousElementSibling === linkOf(identity),
      filter?.textContent,
    ]).toEqual([
      `${FILES}?gh-prism-owner=o/team`,
      "Show only files owned by o/team",
      "Show only files owned by o/team",
      true,
      "",
    ]);
  });

  it("shows all files again, selected, on a page filtered to that owner", () => {
    const filter = filterOf(identityOf("@o/team", { filter: filtering("@o/team").filter }));

    expect([
      filter?.href,
      filter?.getAttribute("aria-label"),
      filter?.dataset.tooltip,
      filter?.classList.contains("gh-prism-selected"),
    ]).toEqual([FILES, "Show all files", "Show all files", true]);
  });

  it("loads its link as a new page on a plain click", () => {
    const { filter, navigate } = filtering();
    const icon = filterOf(identityOf("@o/team", { filter })) as HTMLElement;

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    icon.dispatchEvent(click);

    expect(navigate).toHaveBeenCalledWith(`${FILES}?gh-prism-owner=o/team`);
    expect(click.defaultPrevented).toBe(true);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "leaves a click with %s to the browser",
    (modifier) => {
      const { filter, navigate } = filtering();
      const icon = filterOf(identityOf("@o/team", { filter })) as HTMLElement;

      const click = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      icon.dispatchEvent(click);

      expect(navigate).not.toHaveBeenCalled();
      expect(click.defaultPrevented).toBe(false);
    },
  );
});

describe("memberIdentity", () => {
  it("follows a member's login with their display name, in the same link", () => {
    const member = memberIdentity(document, "octocat", "Mona Lisa");

    expect(member.querySelector("a")?.textContent).toBe("octocat Mona Lisa");
    expect(member.querySelector("a .gh-prism-member-name")?.textContent).toBe("Mona Lisa");
  });

  it("loads a member's avatar only as it nears the view", () => {
    expect(memberIdentity(document, "octocat").querySelector("img")?.loading).toBe("lazy");
  });

  it("links a member's avatar and login, as one link, to their profile", () => {
    const member = memberIdentity(document, "octocat");

    expect(member.tagName).toBe("LI");
    expect([...member.querySelectorAll("a")].map((link) => [link.href, link.textContent])).toEqual([
      ["https://github.com/octocat", "octocat"],
    ]);
    expect(member.querySelector<HTMLImageElement>("a img")?.src).toBe(
      "https://avatars.githubusercontent.com/octocat?s=32",
    );
  });
});

describe("followOwnerTooltips", () => {
  /** A surface holding `@o/team`'s identity, its tooltips followed. */
  function surface() {
    const root = document.createElement("div");
    root.append(identityOf("@o/team", { filter: filtering().filter }));
    document.body.append(root);
    followOwnerTooltips(root);
    const tooltip = () => [...shown].find((element) => root.contains(element));
    return { root, tooltip };
  }

  it("shows a control's tooltip while the pointer rests on it, hidden from assistive technology", () => {
    const { root, tooltip } = surface();
    const icon = filterOf(root) as HTMLElement;

    icon.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    expect(tooltip()?.textContent).toBe("Show only files owned by o/team");
    expect(tooltip()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides it once the pointer leaves the control", () => {
    const { root, tooltip } = surface();
    const icon = filterOf(root) as HTMLElement;
    icon.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    icon.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: root }));

    expect(tooltip()).toBeUndefined();
  });

  it("keeps it while the pointer crosses the control's own parts", () => {
    const { root, tooltip } = surface();
    const icon = filterOf(root) as HTMLElement;
    icon.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    const glyph = icon.firstElementChild as Element;

    icon.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: glyph }));

    expect(tooltip()?.textContent).toBe("Show only files owned by o/team");
  });

  it("shows the same tooltip on keyboard focus, until focus leaves", () => {
    const { root, tooltip } = surface();
    const icon = filterOf(root) as HTMLElement;

    icon.focus();
    expect(tooltip()?.textContent).toBe("Show only files owned by o/team");

    icon.blur();
    expect(tooltip()).toBeUndefined();
  });

  it("returns to the focused control's tooltip once the pointer leaves another control", () => {
    const { root, tooltip } = surface();
    root.append(identityOf("@o/other", { filter: filtering().filter }));
    const [icon, other] = root.querySelectorAll<HTMLElement>("a.gh-prism-owner-filter-icon");
    icon?.focus();
    other?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    other?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: root }));

    expect(tooltip()?.textContent).toBe("Show only files owned by o/team");
  });

  /** `root`'s owner name, measured as `scrollWidth` wide in a `clientWidth` box. */
  function measure(root: Element, scrollWidth: number, clientWidth: number) {
    const name = root.querySelector(".gh-prism-owner-name") as HTMLElement;
    Object.defineProperties(name, {
      scrollWidth: { value: scrollWidth },
      clientWidth: { value: clientWidth },
    });
  }

  it("shows a cut-off owner name whole while the pointer rests on its link", () => {
    const { root, tooltip } = surface();
    measure(root, 300, 120);

    linkOf(root)?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    expect(tooltip()?.textContent).toBe("o/team");
  });

  it("shows nothing for an owner name that fits", () => {
    const { root, tooltip } = surface();
    measure(root, 120, 120);

    linkOf(root)?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    expect(tooltip()).toBeUndefined();
  });

  it("shows a member's cut-off display name whole while the pointer rests on its link", () => {
    const root = document.createElement("ul");
    root.append(memberIdentity(document, "octocat", "Mona Lisa the Octocat"));
    document.body.append(root);
    followOwnerTooltips(root);
    const name = root.querySelector(".gh-prism-member-name") as HTMLElement;
    Object.defineProperties(name, { scrollWidth: { value: 300 }, clientWidth: { value: 120 } });

    root.querySelector("a")?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));

    expect([...shown].find((element) => root.contains(element))?.textContent).toBe(
      "Mona Lisa the Octocat",
    );
  });

  it("shows a cut-off owner name whole on keyboard focus", () => {
    const { root, tooltip } = surface();
    measure(root, 300, 120);

    linkOf(root)?.focus();

    expect(tooltip()?.textContent).toBe("o/team");
  });
});
