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
import type { PressGuard } from "../ui/press-guard";
import type { StructuralChoice } from "./structural-mode";
// ?inline, not a plain import: a plain import ships the sheet in the manifest, styling every
// github.com page; this mounts only while the control lives.
import css from "./view-control.css?inline";

/** A segment of the control: GitHub's two layouts, or Structural mode over Split. */
export type DiffView = "unified" | "split" | "structural";

const VIEWS: readonly DiffView[] = ["unified", "split", "structural"];

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
async function waitFor(
  win: Window,
  ready: () => boolean,
  ms: number,
  signal: AbortSignal,
): Promise<boolean> {
  for (let waited = 0; !ready(); waited += POLL_MS) {
    if (waited >= ms || signal.aborted) return false;
    await new Promise((resolve) => win.setTimeout(resolve, POLL_MS));
  }
  return true;
}

/**
 * Chooses `layout` in GitHub's diff settings menu, resolving once the menu has closed, or a second
 * after the choice. Having chosen nothing, it resolves `"unopened"` when no menu opens within a
 * second (a gear GitHub has not hydrated yet) or `signal` aborts, and `"missing"` when a menu opens
 * without both Layout items. The item already checked is never clicked: the menu just closes.
 */
export async function chooseLayout(
  gear: HTMLButtonElement,
  layout: DiffLayout,
  { signal }: { signal: AbortSignal },
): Promise<"chosen" | "unopened" | "missing"> {
  const doc = gear.ownerDocument;
  const win = doc.defaultView;
  if (!win) return "unopened";

  gear.click();
  // The menu's items exist one microtask after the gear's click.
  await Promise.resolve();
  const menuOpened = await waitFor(win, () => !!findLayoutMenu(doc), MENU_WAIT_MS, signal);
  const menu = findLayoutMenu(doc);
  const close = () => {
    // A second click closes the menu without choosing.
    if (gear.getAttribute("aria-expanded") === "true") gear.click();
  };
  if (!menuOpened || !menu || signal.aborted) {
    const gearExpanded = gear.getAttribute("aria-expanded") === "true";
    close();
    return gearExpanded && !signal.aborted ? "missing" : "unopened";
  }
  // Choosing the shown layout again would post it again.
  if (menu[layout].getAttribute("aria-checked") === "true") {
    close();
    return "chosen";
  }

  menu[layout].click();
  await waitFor(win, () => !findLayoutMenu(doc), MENU_WAIT_MS, signal);
  return "chosen";
}

export interface DiffViewOptions {
  readonly choice: StructuralChoice;
  /** Whether the page is a commit's, where three columns always mean Unified. */
  readonly commit: boolean;
  /** Whether this page can show Structural mode; a commit-filtered pull request page can't. */
  readonly offersStructural: boolean;
  /** The page's current `location.search`. */
  readonly search: () => string;
  /** The visit's, so a press outlives the page that started it. */
  readonly guard: PressGuard;
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

interface DiffViewControl {
  readonly list: HTMLUListElement;
  readonly segments: Readonly<Record<DiffView, HTMLButtonElement>>;
}

/** The control's list of three segments, Structural disabled unless `offersStructural`. */
function controlOf(doc: Document, offersStructural: boolean): DiffViewControl {
  const segments = {
    unified: segmentOf(doc, "unified", "Unified"),
    split: segmentOf(doc, "split", "Split"),
    structural: segmentOf(doc, "structural", "Structural"),
  };
  segments.structural.setAttribute(
    "aria-description",
    offersStructural ? STRUCTURAL_TIP : UNOFFERED_TIP,
  );
  if (!offersStructural) segments.structural.setAttribute("aria-disabled", "true");

  const list = el(
    doc,
    "ul",
    "gh-prism-diff-view tw:items-stretch tw:shrink-0 tw:h-[var(--control-small-size)] tw:m-0 tw:p-0 tw:list-none tw:border tw:border-[var(--controlTrack-borderColor-rest)] tw:rounded-medium tw:bg-[var(--controlTrack-bgColor-rest)]",
    ...VIEWS.map((view) => el(doc, "li", "gh-prism-diff-view-item tw:flex", segments[view])),
  );
  list.setAttribute("aria-label", "Diff view");
  return { list, segments };
}

/**
 * The Unified, Split, and Structural control before `page`'s layout gear, re-mounted when GitHub
 * re-renders the toolbar, until `signal` aborts. Shows nothing while the gear is missing, hides
 * while the toolbar has no room for it, and is removed for the rest of the page once GitHub's menu
 * opens without the wanted Layout item. A press whose gear opens no menu chooses nothing.
 */
export function showDiffViewControl(
  page: FilesPage,
  signal: AbortSignal,
  { choice, commit, offersStructural, search, guard }: DiffViewOptions,
): void {
  const doc = page.sidebar.ownerDocument;
  let control: DiffViewControl | undefined;
  // The view last drawn pressed; `null` until the mounted control draws one.
  let pressedView: DiffView | undefined | null = null;
  let pressing = false;
  let gaveUp = false;
  let watchedWhileOn: AbortSignal | undefined;

  const shown = () => ({
    layout: certainLayout(page.diffs, { commit }),
    on: choice.on && offersStructural,
  });

  const render = () => {
    const { layout, on } = shown();
    const view = shownView(layout, on);
    if (control && view !== pressedView) {
      pressedView = view;
      for (const [segment, button] of Object.entries(control.segments))
        button.setAttribute("aria-pressed", String(segment === view));
    }
    if (watchedWhileOn !== choice.whileOn) {
      watchedWhileOn = choice.whileOn;
      // A microtask on: `on` still reads true while `whileOn` aborts.
      watchedWhileOn.addEventListener("abort", () => queueMicrotask(render), {
        once: true,
        signal,
      });
    }
  };

  const leftUnified = async () => {
    const win = doc.defaultView;
    return (
      !!win &&
      waitFor(
        win,
        () => !showsUnified(page.diffs, { commit, search: search() }),
        LAYOUT_WAIT_MS,
        signal,
      )
    );
  };

  const giveUp = () => {
    gaveUp = true;
    control?.list.remove();
    control = undefined;
  };

  const press = async (view: DiffView) => {
    if (pressing || (view === "structural" && !offersStructural)) return;
    const { layout, on } = shown();
    if (shownView(layout, on) === view) return;
    const steps = stepsFor(view, { layout, on });
    pressing = true;
    try {
      // A page torn down mid-press leaves the rest to the page that replaced it.
      if (steps.choose) {
        const gear = findLayoutGear(page);
        const outcome = gear ? await chooseLayout(gear, steps.choose, { signal }) : "unopened";
        if (signal.aborted || outcome === "unopened") return;
        if (outcome === "missing") return giveUp();
        // Primer returns focus to the gear as its menu closes.
        if (doc.activeElement === gear) control?.segments[view].focus();
      }
      // The mode turned on while the page still reads Unified turns straight off again.
      if (view === "structural" && !(await leftUnified())) return;
      if (signal.aborted) return;
      if (steps.set !== undefined) choice.set(steps.set);
    } finally {
      pressing = false;
      if (!signal.aborted) render();
    }
  };

  // GitHub's toolbar never wraps, so a control it has no room for would scroll the page sideways.
  const fitToToolbar = () => {
    const toolbar = findFilesToolbar(page);
    if (!control || !toolbar) return;
    // Hidden only if it adds overflow: the toolbar's room is measured without it, then with it.
    control.list.hidden = true;
    const room = Math.max(toolbar.clientWidth, toolbar.scrollWidth);
    control.list.hidden = false;
    control.list.hidden = toolbar.scrollWidth > room;
  };

  const mount = (gear: Element) => {
    // A DOM clone of the toolbar, such as a restored snapshot, can carry an earlier control.
    for (const stale of doc.querySelectorAll(".gh-prism-diff-view")) stale.remove();
    control = controlOf(doc, offersStructural);
    pressedView = null;
    for (const view of VIEWS) {
      const segment = control.segments[view];
      segment.addEventListener("click", () => void press(view));
      guard(segment, view, () => void press(view));
    }
    gear.before(control.list);
    fitToToolbar();
  };

  const follow = () => {
    watchToolbar();
    const gear = findLayoutGear(page);
    if (gaveUp) return;
    if (!gear) {
      control?.list.remove();
      control = undefined;
      return;
    }
    if (control?.list.nextElementSibling !== gear) mount(gear);
    render();
  };

  // The toolbar's room changes only as it resizes or its children change; GitHub can replace a
  // pull request's toolbar, a page-wide header outside its diffs, without a new page.
  const resizes = new ResizeObserver(fitToToolbar);
  let watchedToolbar: Element | undefined;
  let unwatch: AbortController | undefined;
  const watchToolbar = () => {
    const toolbar = findFilesToolbar(page);
    if (toolbar === watchedToolbar) return;
    watchedToolbar = toolbar;
    unwatch?.abort();
    resizes.disconnect();
    if (!toolbar) return;
    resizes.observe(toolbar);
    if (page.diffs.contains(toolbar)) return;
    unwatch = new AbortController();
    const onToolbar = () => {
      follow();
      fitToToolbar();
    };
    observeDiffs(toolbar, onToolbar, { signal: AbortSignal.any([signal, unwatch.signal]) });
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    style.remove();
    control?.list.remove();
    resizes.disconnect();
  });

  observeDiffs(page.diffs, follow, { signal });
  follow();
}
