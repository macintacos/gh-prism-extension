// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followReveals, fullName, revealFrames } from "../../../entrypoints/content/ui/reveal";

describe("revealFrames", () => {
  it("holds, scrolls out, holds, and scrolls back at 60 px/s on average", () => {
    const { keyframes, duration } = revealFrames(120);

    expect(duration).toBe(6000);
    expect(keyframes.map(({ offset }) => offset)).toEqual([0, 1 / 6, 1 / 2, 2 / 3, 1]);
    expect(keyframes.map(({ transform }) => transform)).toEqual([
      "translateX(0px)",
      "translateX(0px)",
      "translateX(-120px)",
      "translateX(-120px)",
      "translateX(0px)",
    ]);
  });
});

const prefersReducedMotion = (preference: string) => {
  const { happyDOM } = window as unknown as {
    happyDOM: { settings: { device: { prefersReducedMotion: string } } };
  };
  happyDOM.settings.device.prefersReducedMotion = preference;
};

describe("followReveals", () => {
  let button: HTMLButtonElement;
  let copy: HTMLElement;
  let inner: HTMLElement;
  let hovered: boolean;
  const animation = { cancel: vi.fn() };

  beforeEach(() => {
    hovered = true;
    button = document.createElement("button");
    copy = fullName(document, "managed / dot_config / opencode / skills / sentry-cli");
    button.append(copy);
    document.body.replaceChildren(button);
    inner = copy.firstElementChild as HTMLElement;
    Object.defineProperty(copy, "clientWidth", { value: 100, configurable: true });
    inner.animate = vi.fn(() => animation as unknown as Animation);
    const matches = button.matches.bind(button);
    vi.spyOn(button, "matches").mockImplementation((selector: string) =>
      selector === ":hover" ? hovered : selector === ":focus-visible" ? false : matches(selector),
    );
    followReveals(document.body, matchMedia("(prefers-reduced-motion: reduce)"));
  });

  afterEach(() => {
    prefersReducedMotion("no-preference");
    animation.cancel.mockClear();
  });

  const widen = (width: number) =>
    Object.defineProperty(inner, "scrollWidth", { value: width, configurable: true });
  const fire = (type: string) => button.dispatchEvent(new Event(type, { bubbles: true }));
  // happy-dom's TransitionEvent drops `propertyName` from its init.
  const fadedIn = () =>
    Object.defineProperty(new Event("transitionend", { bubbles: true }), "propertyName", {
      value: "opacity",
    });

  it("marks a name too wide for its copy, and clears the mark once it fits", () => {
    widen(160);
    fire("pointerover");
    expect(copy.hasAttribute("data-overflows")).toBe(true);

    widen(80);
    fire("focusin");
    expect(copy.hasAttribute("data-overflows")).toBe(false);
  });

  it("scrolls the overflow and its end padding once the copy has faded in", () => {
    widen(160);
    fire("pointerover");

    copy.dispatchEvent(fadedIn());

    expect(inner.animate).toHaveBeenCalledWith(revealFrames(72).keyframes, {
      duration: revealFrames(72).duration,
      iterations: Infinity,
    });
  });

  it("leaves the copy still under reduced motion", () => {
    prefersReducedMotion("reduce");
    widen(160);
    fire("pointerover");

    copy.dispatchEvent(fadedIn());

    expect(inner.animate).not.toHaveBeenCalled();
  });

  it("cancels the scroll once the pointer leaves the button", () => {
    widen(160);
    fire("pointerover");
    copy.dispatchEvent(fadedIn());

    hovered = false;
    fire("pointerout");

    expect(animation.cancel).toHaveBeenCalled();
  });
});
