// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerIdentities } from "../../../entrypoints/content/ui/owner-identity";
import { ownerTeams } from "../../../entrypoints/content/ui/owner-teams";
import type { OwnerFilter } from "../../../entrypoints/content/ui/owners-dialog";

// happy-dom has no Popover API.
const shown = new Set<HTMLElement>();
HTMLElement.prototype.showPopover = function (this: HTMLElement) {
  shown.add(this);
};
HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
  shown.delete(this);
};

const noAvatar: OwnerIdentities["teamAvatar"] = async () => undefined;
const filter: OwnerFilter = { linkOf: () => ({ href: "#", shown: false }), navigate: () => {} };

beforeEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("ownerTeams", () => {
  const TEAMS = ["@o/alpha", "@o/beta"];

  /** The control for `TEAMS` in a popup-like host, and that host. */
  function mount(ids: Partial<OwnerIdentities> = {}) {
    const host = document.createElement("div");
    host.popover = "manual";
    const button = ownerTeams(document, TEAMS, { teamAvatar: noAvatar, ...ids });
    host.append(button);
    document.body.replaceChildren(host);
    return { host, button };
  }
  const listOf = (button: HTMLElement) =>
    document.getElementById(button.getAttribute("aria-controls") ?? "");
  const isOpen = (button: HTMLElement) => {
    const list = listOf(button);
    return !!list && shown.has(list) && button.getAttribute("aria-expanded") === "true";
  };

  beforeEach(() => shown.clear());

  it("counts the teams in a button that controls their list, closed", () => {
    const { button } = mount();

    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("2 teams");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(isOpen(button)).toBe(false);
  });

  it("opens its list inside its host on keyboard focus", () => {
    const { host, button } = mount();

    button.focus();

    expect(isOpen(button)).toBe(true);
    expect(host.contains(listOf(button))).toBe(true);
  });

  it("opens on a click and closes on the next", () => {
    const { button } = mount();

    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.focus();
    button.click();
    expect(isOpen(button)).toBe(true);

    button.click();
    expect(isOpen(button)).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens 200 ms after the pointer rests on it, and closes 150 ms after it leaves", () => {
    vi.useFakeTimers();
    try {
      const { button } = mount();
      button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(199);
      expect(isOpen(button)).toBe(false);
      vi.advanceTimersByTime(1);
      expect(isOpen(button)).toBe(true);

      button.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: listOf(button) }),
      );
      vi.advanceTimersByTime(150);
      expect(isOpen(button)).toBe(true);

      listOf(button)?.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
      vi.advanceTimersByTime(149);
      expect(isOpen(button)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(isOpen(button)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists each team's identity, with filter icons only where the host filters", () => {
    const plain = mount().button;
    plain.focus();
    const names = [...(listOf(plain)?.querySelectorAll(".gh-prism-owner-name") ?? [])];
    expect(names.map((name) => name.textContent)).toEqual(["o/alpha", "o/beta"]);
    expect(listOf(plain)?.querySelector(".gh-prism-owner-filter-icon")).toBeNull();

    const filtered = mount({ filter: filter }).button;
    filtered.focus();
    expect(listOf(filtered)?.querySelectorAll(".gh-prism-owner-filter-icon")).toHaveLength(2);
  });

  it("closes only its list on Escape inside it, focusing the button", () => {
    const { host, button } = mount();
    const outer = vi.fn();
    host.addEventListener("keydown", outer);
    button.focus();
    const link = listOf(button)?.querySelector("a") as HTMLElement;
    link.focus();

    const press = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    link.dispatchEvent(press);

    expect(isOpen(button)).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(outer).not.toHaveBeenCalled();
    expect(press.defaultPrevented).toBe(true);
  });

  it("closes once focus leaves the button and its list", () => {
    const { button } = mount();
    const elsewhere = document.body.appendChild(document.createElement("button"));
    button.focus();

    elsewhere.focus();

    expect(isOpen(button)).toBe(false);
  });

  it("goes with its host", () => {
    const { host, button } = mount();
    button.focus();
    const list = listOf(button);

    host.remove();

    expect(list?.isConnected).toBe(false);
  });
  const hover = (button: HTMLElement) =>
    button.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  const press = (button: HTMLElement) => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.focus();
    button.click();
  };

  it("stays open on a click after the pointer opened it", () => {
    vi.useFakeTimers();
    const { button } = mount();
    hover(button);
    vi.advanceTimersByTime(200);

    press(button);

    expect(isOpen(button)).toBe(true);
  });

  it("stays open on a click after focus opened it", () => {
    const { button } = mount();
    button.focus();

    button.click();

    expect(isOpen(button)).toBe(true);
  });

  it("hands focus inside the list back to the button as the pointer timer closes it", () => {
    vi.useFakeTimers();
    const { button } = mount();
    button.focus();
    const link = listOf(button)?.querySelector("a") as HTMLElement;
    link.focus();

    listOf(button)?.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
    );
    vi.advanceTimersByTime(150);

    expect(document.activeElement).toBe(button);
    expect(isOpen(button)).toBe(false);
  });

  it("opens nothing once its host is gone before the pointer timer fires", () => {
    vi.useFakeTimers();
    const { host, button } = mount();
    hover(button);
    host.remove();

    expect(() => vi.advanceTimersByTime(200)).not.toThrow();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a scroll outside its list, not inside it", () => {
    const { button } = mount();
    button.focus();
    listOf(button)?.dispatchEvent(new Event("scroll"));
    expect(isOpen(button)).toBe(true);

    document.dispatchEvent(new Event("scroll"));

    expect(isOpen(button)).toBe(false);
  });
});
