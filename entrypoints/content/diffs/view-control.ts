/**
 * The Unified, Split, and Structural control beside GitHub's diff settings gear. Unified and Split
 * drive GitHub's own Layout menu, so GitHub keeps remembering the layout; Structural puts GitHub
 * on Split and turns the saved Structural mode on.
 */

import {
  certainLayout,
  type DiffLayout,
  type FilesPage,
  findFilesToolbar,
  findLayoutGear,
  findLayoutMenu,
  observeDiffs,
  showsUnified,
} from "../files-page";
import { el } from "../ui/dom";
import type { StructuralChoice } from "./structural-mode";
// ?inline, not a plain import: a plain import ships the sheet in the manifest, styling every
// github.com page; this mounts only while the control lives.
import css from "./view-control.css?inline";

export type DiffView = "unified" | "split" | "structural";

/** The segment to show pressed: Structural while the mode is on and Unified is not certain, else the certain layout, else none. */
export function shownView(layout: DiffLayout | undefined, on: boolean): DiffView | undefined {
  if (on && layout !== "unified") return "structural";
  return layout;
}

/** What a press on `target` must do: the Layout item to choose in GitHub's menu, if any, and the mode to set, if it changes. */
export function stepsFor(
  target: DiffView,
  { layout, on }: { layout: DiffLayout | undefined; on: boolean },
): { choose?: DiffLayout; set?: boolean } {
  const wanted: DiffLayout = target === "unified" ? "unified" : "split";
  return {
    ...(layout === wanted ? {} : { choose: wanted }),
    ...(on === (target === "structural") ? {} : { set: target === "structural" }),
  };
}

const MENU_WAIT_MS = 1000;
const LAYOUT_WAIT_MS = 2000;
const POLL_MS = 25;

/** Resolves `true` once `ready()` holds, or `false` after `ms` or on abort. */
async function until(
  win: Window,
  ready: () => boolean,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  // The menu's items exist one microtask after the gear's click.
  await Promise.resolve();
  for (let waited = 0; !ready(); waited += POLL_MS) {
    if (waited >= ms || signal.aborted) return false;
    await new Promise((resolve) => win.setTimeout(resolve, POLL_MS));
  }
  return true;
}

/** Chooses `layout` in GitHub's diff settings menu, resolving once the menu has closed: `false`, having chosen nothing, when the menu or the item isn't found within a second. */
export async function chooseLayout(
  gear: HTMLButtonElement,
  layout: DiffLayout,
  { signal }: { signal: AbortSignal },
): Promise<boolean> {
  const doc = gear.ownerDocument;
  const win = doc.defaultView;
  if (!win) return false;

  gear.click();
  const found = await until(win, () => !!findLayoutMenu(doc), MENU_WAIT_MS, signal);
  const menu = findLayoutMenu(doc);
  if (!found || !menu) {
    // A second click closes the menu without choosing.
    if (gear.getAttribute("aria-expanded") === "true") gear.click();
    return false;
  }

  menu[layout].click();
  await until(win, () => !findLayoutMenu(doc), MENU_WAIT_MS, signal);
  return true;
}

export interface DiffViewOptions {
  readonly choice: StructuralChoice;
  /** Whether the page is a commit's, where three columns always mean Unified. */
  readonly commit: boolean;
  /** Whether this page can show Structural mode; a commit-filtered pull request page can't. */
  readonly offersStructural: boolean;
  /** The page's current `location.search`. */
  readonly search: () => string;
}

const STRUCTURAL_TIP =
  "Highlights what changed in the code and quiets formatting-only changes. Beta: it may have bugs.";
const UNOFFERED_TIP = "Structural isn't available while viewing one commit of a pull request.";

const SEGMENT =
  "gh-prism-diff-view-segment tw:relative tw:inline-flex tw:items-center tw:gap-1 tw:h-full tw:px-2 tw:border tw:border-transparent tw:rounded-medium tw:bg-transparent tw:text-body-small tw:text-fg-default tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:-outline-offset-2 tw:focus-visible:outline-focus-outline";

/** One segment: its label, reserving its semibold width, and Structural's Beta tag. */
function segmentOf(doc: Document, view: DiffView, label: string): HTMLButtonElement {
  const text = el(doc, "span", "gh-prism-diff-view-label", label);
  text.dataset.text = label;
  const button = el(doc, "button", SEGMENT, text);
  button.type = "button";
  button.dataset.view = view;
  if (view === "structural")
    button.append(
      el(
        doc,
        "span",
        "gh-prism-diff-view-tag tw:px-1.5 tw:rounded-[2em] tw:text-body-small tw:font-medium tw:leading-body-small tw:text-fg-muted tw:border tw:border-border-default",
        // Leading space: the button's name is built from its text.
        " Beta",
      ),
    );
  return button;
}

/** The control's list of three segments, Structural disabled unless `offersStructural`. */
function controlOf(doc: Document, offersStructural: boolean): HTMLUListElement {
  const segments = [
    segmentOf(doc, "unified", "Unified"),
    segmentOf(doc, "split", "Split"),
    segmentOf(doc, "structural", "Structural"),
  ];
  const structural = segments[2];
  structural?.setAttribute("aria-description", offersStructural ? STRUCTURAL_TIP : UNOFFERED_TIP);
  if (!offersStructural) structural?.setAttribute("aria-disabled", "true");

  const list = el(
    doc,
    "ul",
    "gh-prism-diff-view tw:inline-flex tw:items-stretch tw:shrink-0 tw:h-[var(--control-small-size)] tw:m-0 tw:p-0 tw:list-none tw:border tw:border-[var(--controlTrack-borderColor-rest)] tw:rounded-medium tw:bg-[var(--controlTrack-bgColor-rest)]",
    ...segments.map((segment) => el(doc, "li", "gh-prism-diff-view-item tw:flex", segment)),
  );
  list.setAttribute("aria-label", "Diff view");
  return list;
}

/** The Unified, Split, and Structural control before `page`'s layout gear, re-mounted when GitHub re-renders the toolbar, until `signal` aborts. Shows nothing while the gear is missing. */
export function showDiffViewControl(
  page: FilesPage,
  signal: AbortSignal,
  { choice, commit, offersStructural, search }: DiffViewOptions,
): void {
  const doc = page.sidebar.ownerDocument;
  let control: HTMLUListElement | undefined;
  let busy = false;
  let gaveUp = false;
  let heard: AbortSignal | undefined;
  // Hydration can replace the page mid-press, re-mounting the control, and then no click fires.
  // The press is kept on <html>, where the control the re-mount draws can find it.
  const root = doc.documentElement;

  const shown = () => ({
    layout: certainLayout(page.diffs, { commit }),
    on: choice.on && offersStructural,
  });
  const segment = (view: DiffView) =>
    control?.querySelector<HTMLButtonElement>(`[data-view="${view}"]`) ?? undefined;

  const render = () => {
    const { layout, on } = shown();
    const view = shownView(layout, on);
    for (const button of control?.querySelectorAll<HTMLElement>("[data-view]") ?? [])
      button.setAttribute("aria-pressed", String(button.dataset.view === view));
    if (heard !== choice.whileOn) {
      heard = choice.whileOn;
      // A microtask on: `on` still reads true while `whileOn` aborts.
      heard.addEventListener("abort", () => queueMicrotask(render), { once: true, signal });
    }
  };

  const leftUnified = async () => {
    const win = doc.defaultView;
    return (
      !!win &&
      until(
        win,
        () => !showsUnified(page.diffs, { commit, search: search() }),
        LAYOUT_WAIT_MS,
        signal,
      )
    );
  };

  const giveUp = () => {
    gaveUp = true;
    control?.remove();
    control = undefined;
  };

  const press = async (view: DiffView) => {
    if (busy || (view === "structural" && !offersStructural)) return;
    const { layout, on } = shown();
    if (shownView(layout, on) === view) return;
    const steps = stepsFor(view, { layout, on });
    busy = true;
    try {
      if (steps.choose) {
        const gear = findLayoutGear(page);
        if (!gear || !(await chooseLayout(gear, steps.choose, { signal }))) return giveUp();
        // Primer returns focus to the gear as its menu closes.
        if (doc.activeElement === gear) segment(view)?.focus();
      }
      // The mode turned on while the page still reads Unified turns straight off again.
      if (view === "structural" && !(await leftUnified())) return;
      if (steps.set !== undefined) choice.set(steps.set);
    } finally {
      busy = false;
      if (!signal.aborted) render();
    }
  };

  const mount = (gear: Element) => {
    // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier control.
    for (const stale of doc.querySelectorAll(".gh-prism-diff-view")) stale.remove();
    control = controlOf(doc, offersStructural);
    for (const button of control.querySelectorAll<HTMLElement>("[data-view]")) {
      const view = button.dataset.view as DiffView;
      button.addEventListener("click", () => void press(view));
      button.addEventListener("pointerdown", () => {
        root.dataset.ghPrismDiffViewDown = view;
        button.dataset.down = "";
      });
      button.addEventListener("pointerup", () => {
        // A segment that never saw this press's pointerdown replaced the one that did.
        if (root.dataset.ghPrismDiffViewDown === view && button.dataset.down === undefined)
          void press(view);
      });
    }
    gear.before(control);
  };

  // GitHub's toolbar never wraps, so a control it has no room for would scroll the page sideways.
  const fitToToolbar = () => {
    const toolbar = findFilesToolbar(page);
    if (!control || !toolbar) return;
    control.hidden = true;
    const room = Math.max(toolbar.clientWidth, toolbar.scrollWidth);
    control.hidden = false;
    control.hidden = toolbar.scrollWidth > room;
  };

  const follow = () => {
    const gear = findLayoutGear(page);
    if (gaveUp) return;
    if (!gear) {
      control?.remove();
      control = undefined;
      return;
    }
    if (control?.nextElementSibling !== gear) mount(gear);
    render();
    fitToToolbar();
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  // After each segment's own pointerup, so a press released elsewhere is forgotten.
  const forgetPress = () => {
    delete root.dataset.ghPrismDiffViewDown;
    for (const button of doc.querySelectorAll<HTMLElement>(".gh-prism-diff-view [data-down]"))
      delete button.dataset.down;
  };
  doc.addEventListener("pointerup", forgetPress, { signal });
  doc.addEventListener("pointercancel", forgetPress, { signal });
  signal.addEventListener("abort", () => {
    style.remove();
    control?.remove();
  });

  observeDiffs(page.diffs, follow, { signal });
  // A pull request's toolbar is a page-wide header outside its diffs.
  const toolbar = findFilesToolbar(page);
  if (toolbar && !page.diffs.contains(toolbar)) observeDiffs(toolbar, follow, { signal });
  if (toolbar) {
    const resizes = new ResizeObserver(fitToToolbar);
    resizes.observe(toolbar);
    signal.addEventListener("abort", () => resizes.disconnect());
  }
  follow();
}
