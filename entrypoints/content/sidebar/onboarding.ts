/**
 * The first-run onboarding: a veil over the sidebar's sections, until the reader reveals them.
 *
 * No sheet of its own: `sidebar/sections-view.css` `@source`s this file and blurs the nav's other
 * children while it carries `data-gh-prism-onboarding`.
 */

import { el } from "../ui/dom";
import { prismMark } from "../ui/mark";
import { SECTION_SPECTRUM } from "../ui/section-catalog";

/** A tab's onboarding; `whileVeiled` aborts once `lift` runs, after a dismissal in any tab. */
export interface OnboardingChoice {
  readonly whileVeiled: AbortSignal;
  readonly lift: () => void;
}

export interface OnboardingOptions {
  readonly choice: OnboardingChoice;
  readonly save: () => void;
}

const ATTRIBUTE = "data-gh-prism-onboarding";

/** Keep at the stylesheet's `.gh-prism-onboarding` lift transition duration. */
const LIFT_MS = 280;

/** Builds the veil, and returns its button for the caller to wire. */
function veil(doc: Document): { cover: HTMLElement; button: HTMLButtonElement } {
  const spectrum = el(doc, "div", "tw:h-[3px] tw:rounded-full");
  spectrum.style.background = SECTION_SPECTRUM;

  const heading = el(
    doc,
    "h3",
    "tw:flex tw:items-center tw:gap-2 tw:m-0 tw:text-body-medium tw:font-semibold tw:text-fg-default",
    prismMark(doc),
    "Review in sections",
  );
  heading.id = "gh-prism-heading-onboarding";

  // Primer's medium primary Button, full width.
  const button = el(
    doc,
    "button",
    "tw:w-full tw:h-[var(--control-medium-size,32px)] tw:px-3 tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-primary-borderColor-rest)] tw:bg-[var(--button-primary-bgColor-rest)] tw:text-[color:var(--button-primary-fgColor-rest)] tw:text-body-medium tw:font-medium tw:cursor-pointer tw:hover:bg-[var(--button-primary-bgColor-hover)] tw:active:bg-[var(--button-primary-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2",
    "Start reviewing",
  );
  button.type = "button";

  const cover = el(
    doc,
    "section",
    "gh-prism-onboarding tw:absolute tw:inset-0 tw:z-10 tw:flex tw:flex-col tw:gap-[10px] tw:p-3 tw:bg-[color-mix(in_srgb,var(--bgColor-default)_55%,transparent)]",
    spectrum,
    heading,
    el(
      doc,
      "p",
      "tw:m-0 tw:text-body-small tw:leading-body-small tw:text-fg-default",
      "gh-prism rearranges these files into sections to walk through one by one.",
    ),
    el(
      doc,
      "p",
      "tw:m-0 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
      "Also new to you: Wrap lines in the diff settings menu, and Structural diffs.",
    ),
    button,
  );
  cover.setAttribute("aria-labelledby", heading.id);
  return { cover, button };
}

/**
 * Veils `nav`'s sections until `choice.whileVeiled` or `signal` aborts. Its button saves through
 * `save` and lifts every veil in the tab through `choice.lift`. Everything else in `nav`, now or
 * added later, is inert while the veil shows.
 */
export function showOnboarding(
  nav: HTMLElement,
  signal: AbortSignal,
  { choice, save }: OnboardingOptions,
): void {
  const { cover, button } = veil(nav.ownerDocument);
  const inerted = new Set<HTMLElement>();
  const inert = (node: Node) => {
    if (node === cover || !(node instanceof HTMLElement) || node.inert) return;
    node.inert = true;
    inerted.add(node);
  };

  for (const child of nav.children) inert(child);
  nav.setAttribute(ATTRIBUTE, "");
  nav.prepend(cover);

  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach(inert);
  });
  observer.observe(nav, { childList: true });
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });

  choice.whileVeiled.addEventListener(
    "abort",
    () => {
      const coverHadFocus = cover.contains(nav.ownerDocument.activeElement);
      observer.disconnect();
      for (const node of inerted) node.inert = false;
      nav.removeAttribute(ATTRIBUTE);
      cover.inert = true;
      if (coverHadFocus) focusAfterLift(nav);
      // A timer, not transitionend: it also fires in a hidden tab and under reduced motion.
      setTimeout(() => cover.remove(), LIFT_MS);
    },
    { once: true, signal },
  );

  button.addEventListener("click", () => {
    save();
    choice.lift();
  });
}

/** Focuses the first section's toggle, or the nav itself while no section has landed. */
function focusAfterLift(nav: HTMLElement): void {
  const toggle = nav.querySelector<HTMLElement>(".gh-prism-section-toggle");
  if (!toggle) nav.tabIndex = -1;
  (toggle ?? nav).focus();
}
