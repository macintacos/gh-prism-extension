import { el, icon } from "./dom";
import { keycap } from "./keycap";

/**
 * A toolbar button that Shift+\ presses: Primer's small default Button holding the icon `path`
 * draws, then the key's keycap, with `className` among its classes and `label` as its name.
 * Each sheet that styles one `@source`s this module and `keycap.ts`, and imports `keycap.css`.
 */
export function shiftBackslashButton(
  doc: Document,
  { className, label, path }: { className: string; label: string; path: string },
): HTMLButtonElement {
  const button = el(
    doc,
    "button",
    "tw:relative tw:shrink-0 tw:inline-flex tw:items-center tw:gap-1 tw:h-[var(--control-small-size,28px)] tw:px-2 tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:rounded-medium tw:bg-[var(--button-default-bgColor-rest)] tw:[box-shadow:var(--button-default-shadow-resting)] tw:text-[color:var(--button-default-fgColor-rest)] tw:[font-family:var(--fontStack-sansSerif)] tw:text-body-small tw:font-medium tw:cursor-pointer tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:-outline-offset-2",
    icon(doc, path, { class: "tw:text-fg-muted" }),
    keycap(doc, "\\", { shift: true }),
  );

  button.classList.add(className);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-keyshortcuts", "Shift+\\");
  return button;
}
