/**
 * Scrolls a truncated name's full-name copy and marks whether it overflows; reveal.css decides when
 * the copy shows. The @pierre/trees patch emits the same copy in tree rows.
 */

import { el } from "./dom";

/** Average scroll speed, px/s, and the pause at each end, ms. The wait and fade-in live only in
 * reveal.css: the scroll starts when the fade-in ends. */
const SPEED = 60;
const HOLD = 1000;
// Keep in sync with reveal.css's end padding, so the last letter scrolls clear of the fade.
const END_PADDING = 12; // px

/** `<span data-full-name aria-hidden="true"><span>{text}</span></span>`: the copy reveal.css
 * shows over a truncated label. Append it inside the element that truncates. The @pierre/trees
 * patch emits the same shape in tree rows. */
export function fullName(doc: Document, text: string): HTMLElement {
  const copy = el(doc, "span", "", el(doc, "span", "", text));
  copy.setAttribute("data-full-name", "");
  copy.setAttribute("aria-hidden", "true");
  return copy;
}

/** The back-and-forth scroll over `distance` px: a hold, a leg out, a hold, a leg back, each leg
 * on ease-in-out at SPEED on average. */
export function revealFrames(distance: number): { keyframes: Keyframe[]; duration: number } {
  const leg = (distance / SPEED) * 1000;
  const duration = 2 * (HOLD + leg);
  const at = (time: number) => time / duration;
  const home = "translateX(0px)";
  const away = `translateX(-${distance}px)`;
  return {
    duration,
    keyframes: [
      { offset: 0, transform: home },
      { offset: at(HOLD), transform: home, easing: "ease-in-out" },
      { offset: at(HOLD + leg), transform: away },
      { offset: at(2 * HOLD + leg), transform: away, easing: "ease-in-out" },
      { offset: 1, transform: home },
    ],
  };
}

/**
 * Under `root`, marks a hovered or focused button's `[data-full-name]` as `data-overflows` when
 * its name doesn't fit, scrolls it once reveal.css has faded it in unless `reducedMotion`
 * matches, and cancels the scroll once the button is neither hovered nor focus-visible.
 */
export function followReveals(root: ShadowRoot | HTMLElement, reducedMotion: MediaQueryList): void {
  const mark = (event: Event) => {
    const copy = copyIn(event.target);
    const inner = copy?.firstElementChild;
    if (!copy || !inner) return;
    copy.toggleAttribute("data-overflows", inner.scrollWidth > copy.clientWidth);
  };
  root.addEventListener("pointerover", mark);
  root.addEventListener("focusin", mark);

  // A copy is keyed by its row's path, so a recycled row element brings a fresh one.
  const scrolls = new WeakMap<Element, Animation>();
  root.addEventListener("transitionend", (event) => {
    const copy = event.target;
    if (!(copy instanceof HTMLElement) || !copy.matches("[data-full-name]")) return;
    const inner = copy.firstElementChild;
    if (!inner || reducedMotion.matches || scrolls.has(copy)) return;
    if ((event as TransitionEvent).propertyName !== "opacity") return;

    const { keyframes, duration } = revealFrames(
      inner.scrollWidth - copy.clientWidth + END_PADDING,
    );
    scrolls.set(copy, inner.animate(keyframes, { duration, iterations: Infinity }));
  });

  const cancel = (event: Event) => {
    const button = buttonOf(event.target);
    const copy = copyIn(event.target);
    if (!button || !copy || button.matches(":hover") || button.matches(":focus-visible")) return;
    scrolls.get(copy)?.cancel();
    scrolls.delete(copy);
  };
  root.addEventListener("pointerout", cancel);
  root.addEventListener("focusout", cancel);
}

const buttonOf = (target: EventTarget | null) =>
  target instanceof Element ? target.closest("button") : null;

const copyIn = (target: EventTarget | null) =>
  buttonOf(target)?.querySelector<HTMLElement>("[data-full-name]") ?? null;
