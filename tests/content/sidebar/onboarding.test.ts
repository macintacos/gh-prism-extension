// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OnboardingChoice,
  showOnboarding,
} from "../../../entrypoints/content/sidebar/onboarding";

let nav: HTMLElement;
let choice: OnboardingChoice;
let controller: AbortController;
const save = vi.fn();

const section = () => {
  const node = document.createElement("section");
  const toggle = document.createElement("button");
  toggle.className = "gh-prism-section-toggle";
  node.append(toggle);
  return node;
};
const cover = () => nav.querySelector<HTMLElement>(".gh-prism-onboarding");
const button = () => cover()?.querySelector("button") ?? null;
const others = () => [...nav.children].filter((child) => child !== cover());

beforeEach(() => {
  save.mockReset();
  nav = document.createElement("nav");
  nav.className = "gh-prism-sections";
  nav.append(section(), section());
  document.body.replaceChildren(nav);
  choice = { onboarded: false, lifts: new EventTarget() };
  controller = new AbortController();
});

const show = () => showOnboarding(nav, controller.signal, { choice, save });

describe("showOnboarding", () => {
  it("covers the nav and inerts its other children", () => {
    show();

    expect(nav.querySelectorAll(".gh-prism-onboarding")).toHaveLength(1);
    expect(nav.hasAttribute("data-gh-prism-onboarding")).toBe(true);
    expect(others().every((child) => (child as HTMLElement).inert)).toBe(true);
    expect(button()?.closest("[inert]")).toBeNull();
  });

  it("inerts a child appended while it covers", async () => {
    show();
    const late = section();
    nav.append(late);
    await Promise.resolve();

    expect(late.inert).toBe(true);
  });

  it("lifts, saves, and focuses the first section when its button is clicked", () => {
    const preInert = section();
    preInert.inert = true;
    nav.append(preInert);
    show();
    button()?.focus();
    vi.useFakeTimers();

    button()?.click();
    const focused = document.activeElement;
    vi.runAllTimers();
    vi.useRealTimers();

    expect(save).toHaveBeenCalledOnce();
    expect(choice.onboarded).toBe(true);
    expect(cover()).toBeNull();
    expect(nav.hasAttribute("data-gh-prism-onboarding")).toBe(false);
    expect((nav.children[0] as HTMLElement).inert).toBe(false);
    expect(preInert.inert).toBe(true);
    expect(focused).toBe(nav.querySelector(".gh-prism-section-toggle"));
  });

  it("lifts without saving when another tab reveals the sidebar", () => {
    show();

    choice.lifts.dispatchEvent(new Event("lift"));

    expect(save).not.toHaveBeenCalled();
    expect(nav.hasAttribute("data-gh-prism-onboarding")).toBe(false);
    expect(others().some((child) => (child as HTMLElement).inert)).toBe(false);
  });

  it("stops inerting new children once its signal aborts", async () => {
    show();
    controller.abort();
    const late = section();
    nav.append(late);
    await Promise.resolve();

    expect(late.inert).toBe(false);
  });

  it("introduces sections, word wrap, and Structural diffs", () => {
    show();

    expect(cover()?.textContent).toContain("sections to walk through");
    expect(cover()?.textContent).toContain("Wrap lines");
    expect(cover()?.textContent).toContain("Structural diffs");
    expect(button()?.textContent).toBe("Start reviewing");
  });
});
