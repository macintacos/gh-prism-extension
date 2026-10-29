// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  type CommitMessageChoice,
  type CommitMessageVisit,
  showCommitMessage,
} from "../../../entrypoints/content/commit/message-view";
import {
  type FilesPage,
  findCommitColumnRow,
  findCommitMessage,
  findFilesPage,
} from "../../../entrypoints/content/files-page";
import { watchFilesPages } from "../../../entrypoints/content/visit/watch";
import type { CommitMessageView } from "../../../utils/prefs";
import { loadCommitFixture, loadFixture } from "../../fixtures/files-page";

const container = () => document.querySelector<HTMLElement>(".gh-prism-commit-message");
const viewButton = () => document.querySelector<HTMLButtonElement>(".gh-prism-commit-view-switch");
const sheets = () =>
  [...document.head.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes("gh-prism-commit-message"),
  );
const messageOf = () => {
  const found = findCommitMessage(pageOf());
  if (!found) throw new Error("no commit message");
  return found;
};
const box = () => messageOf().box;
const shows = (element: Element) => getComputedStyle(element).display !== "none";
// Runs the MutationObserver's pending microtask, and no timer.
const afterMutations = () => vi.advanceTimersByTimeAsync(0);

function pageOf(): FilesPage {
  const page = findFilesPage(document);
  if (!page) throw new Error("no Files page");
  return page;
}

let controller: AbortController;
let tasks: (() => void)[];
const afterSections = (task: () => void) => void tasks.push(task);
const runIdle = () => {
  for (const task of tasks.splice(0)) task();
};
let choice: CommitMessageChoice;
let save: (view: CommitMessageView) => void;
let saveWidth: (width: number) => void;
let saveHidden: (hidden: boolean) => void;
let visit: CommitMessageVisit;
const show = () =>
  showCommitMessage(pageOf(), controller.signal, {
    afterSections,
    choice,
    save,
    saveWidth,
    saveHidden,
    visit,
  });

beforeEach(() => {
  choice = { view: "rendered", width: 320 };
  visit = { since: performance.now(), hidden: false };
  save = vi.fn();
  saveWidth = vi.fn();
  saveHidden = vi.fn();
  vi.useFakeTimers();
  history.replaceState(null, "", "/o/r/commit/dd95cdc");
  loadCommitFixture("lists");
  controller = new AbortController();
  tasks = [];
});

afterEach(() => {
  controller.abort();
  vi.useRealTimers();
});

describe("showCommitMessage", () => {
  it("holds GitHub's box's place in a loading state until the browser is idle", () => {
    const before = box().outerHTML;

    show();

    const shown = box().previousElementSibling;
    expect(shown).toBe(container());
    expect(shown?.getAttribute("aria-busy")).toBe("true");
    expect(shown?.querySelector(".gh-prism-commit-skeleton")).not.toBeNull();
    expect(shown?.querySelector("h1")).toBeNull();
    expect(viewButton()?.parentElement).toBe(shown);
    expect(shows(box())).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("stands in for GitHub's box, unchanged, once idle", () => {
    const before = box().outerHTML;
    show();
    runIdle();

    const shown = box().previousElementSibling as HTMLElement | null;
    expect(shown?.matches(".gh-prism-commit-message")).toBe(true);
    expect(shown?.querySelector(".gh-prism-commit-message-body.markdown-body")).not.toBeNull();
    expect(shown?.dataset.view).toBe("rendered");
    expect(shows(box())).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("sets the title a step above the body's text, and every body heading below the title", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = "# One\n\n## Two\n\n### Three\n\nText";
    show();
    runIdle();

    const sizeOf = (selector: string) => {
      const element = container()?.querySelector(selector);
      if (!element) throw new Error(`no ${selector}`);
      return Number.parseFloat(getComputedStyle(element).fontSize);
    };
    const title = sizeOf("h1:first-child");
    const text = sizeOf("p");
    expect(title).toBeGreaterThan(text);
    expect(title).toBeLessThanOrEqual(text * 1.25);
    for (const heading of ["h1 ~ h1", "h2", "h3"]) expect(sizeOf(heading)).toBeLessThan(title);
  });

  it("opens on GitHub's box, unchanged, when the tab last picked plain text", () => {
    choice.view = "plaintext";
    const before = box().outerHTML;

    show();
    runIdle();

    const shown = box().previousElementSibling;
    expect(shown?.matches(".gh-prism-commit-message")).toBe(true);
    expect(shows(box())).toBe(true);
    const body = shown?.querySelector(".gh-prism-commit-message-body");
    if (!body) throw new Error("no body");
    expect(shows(body)).toBe(false);
    expect(box().outerHTML).toBe(before);
  });

  it("flips to GitHub's box, unchanged, and back, saving each pick", () => {
    show();
    runIdle();
    const before = box().outerHTML;
    const button = viewButton();
    if (!button) throw new Error("no switch");
    const body = container()?.querySelector(".gh-prism-commit-message-body");
    if (!body) throw new Error("no body");
    expect(button.parentElement).toBe(container());
    expect(button.type).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Show plain text");

    button.click();

    expect(shows(box())).toBe(true);
    expect(shows(body)).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Show rendered Markdown");
    expect(choice.view).toBe("plaintext");
    expect(save).toHaveBeenLastCalledWith("plaintext");
    expect(box().outerHTML).toBe(before);
    expect(viewButton()).toBe(button);

    button.click();

    // happy-dom keeps the box hidden once the `+` rule stops matching; e2e proves it shows.
    expect(container()?.dataset.view).toBe("rendered");
    expect(shows(body)).toBe(true);
    expect(save).toHaveBeenLastCalledWith("rendered");
  });

  it("removes itself and its sheet on abort, showing GitHub's box again", () => {
    show();
    runIdle();
    controller.abort();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
  });

  it("keeps GitHub's box for a message too large to render, with no loading state", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = "a".repeat(50_001);
    show();

    expect(container()).toBeNull();
    expect(shows(box())).toBe(true);

    runIdle();

    expect(container()).toBeNull();
    expect(viewButton()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
  });

  it("leaves a subject-only message as GitHub shows it", () => {
    loadCommitFixture("subject");
    const before = box().outerHTML;

    show();
    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
    expect(box().outerHTML).toBe(before);
  });

  it("mounts nothing on a pull request's page", () => {
    history.replaceState(null, "", "/o/r/pull/1/changes");
    loadFixture();
    show();
    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it("drops its loading state on abort, and mounts nothing when the idle task runs after", () => {
    show();
    controller.abort();

    expect(container()).toBeNull();
    expect(shows(box())).toBe(true);

    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it.each(["rendered", "plaintext"] as const)(
    "returns before the box, switch and all, when GitHub re-renders the card in the %s view",
    async (view) => {
      choice.view = view;
      show();
      runIdle();
      container()?.remove();
      await afterMutations();

      expect(box().previousElementSibling).toBe(container());

      const clone = box().cloneNode(true) as Element;
      box().replaceWith(clone);
      await afterMutations();

      expect(clone.previousElementSibling).toBe(container());
      expect(viewButton()?.parentElement).toBe(container());
      expect(shows(clone)).toBe(view === "plaintext");

      clone.remove();
      await afterMutations();

      expect(container()).toBeNull();
    },
  );
});

describe("showCommitMessage's loading state", () => {
  const setReducedMotion = (reduce: boolean) => {
    (
      window as unknown as { happyDOM: { settings: { device: { prefersReducedMotion: string } } } }
    ).happyDOM.settings.device.prefersReducedMotion = reduce ? "reduce" : "no-preference";
  };
  const messageBody = () => container()?.querySelector(".gh-prism-commit-message-body");
  const nestTooDeep = () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = `${">".repeat(40)} deep`;
  };

  afterEach(() => setReducedMotion(false));

  it("swaps the skeleton for the rendering once idle, fading it in", () => {
    show();
    runIdle();

    expect(container()?.hasAttribute("aria-busy")).toBe(false);
    expect(container()?.querySelector(".gh-prism-commit-skeleton")).toBeNull();
    expect(messageBody()?.firstElementChild?.localName).toBe("h1");
    expect(messageBody()?.getAnimations()).toHaveLength(1);
  });

  it("swaps the skeleton for the rendering without motion under reduced motion", () => {
    setReducedMotion(true);

    show();
    runIdle();

    expect(messageBody()?.firstElementChild?.localName).toBe("h1");
    expect(messageBody()?.getAnimations()).toHaveLength(0);
    expect(container()?.getAnimations()).toHaveLength(0);
  });

  it("gives the plaintext view GitHub's box from the start, with the rendering filled in behind it", () => {
    choice.view = "plaintext";

    show();

    expect(container()?.dataset.view).toBe("plaintext");
    expect(shows(box())).toBe(true);

    runIdle();

    expect(messageBody()?.querySelector("h1")).not.toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("shows the visit's rendering at once, with no second entrance, when GitHub re-renders the page", () => {
    show();
    runIdle();
    const rendering = messageBody()?.firstElementChild;
    controller.abort();
    controller = new AbortController();

    show();

    expect(container()?.hasAttribute("aria-busy")).toBe(false);
    expect(messageBody()?.firstElementChild).toBe(rendering);
    expect(messageBody()?.getAnimations()).toHaveLength(0);
    expect(tasks).toHaveLength(0);
  });

  it("keeps GitHub's box when GitHub re-renders the page after the rendering failed", () => {
    nestTooDeep();
    show();
    runIdle();
    controller.abort();
    controller = new AbortController();

    show();

    expect(container()).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("goes back to GitHub's box, and stays there, when the message nests too deep to render", async () => {
    nestTooDeep();
    show();
    expect(shows(box())).toBe(false);

    runIdle();

    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);

    box().replaceWith(box().cloneNode(true));
    await afterMutations();

    expect(container()).toBeNull();
  });
});

const WIDE = { width: 1400, height: 768 };
const NARROW = { width: 1200, height: 768 };
const DEFAULT = { width: 1024, height: 768 };
type Size = { width: number; height: number };
const setViewport = (size: Size) =>
  (window as unknown as { happyDOM: { setViewport: (size: Size) => void } }).happyDOM.setViewport(
    size,
  );
const column = () => document.querySelector(".gh-prism-commit-column");
const row = () => findCommitColumnRow(pageOf());

describe("showCommitMessage's column", () => {
  beforeEach(() => setViewport(WIDE));
  afterEach(() => setViewport(DEFAULT));

  const expectInColumn = () => {
    expect(column()?.children).toHaveLength(2);
    expect(column()?.firstElementChild).toBe(container());
    expect(column()?.lastElementChild?.getAttribute("role")).toBe("separator");
    expect(row()?.firstElementChild).toBe(column());
    expect(box().previousElementSibling?.matches(".gh-prism-commit-slot")).toBe(true);
    expect(shows(box())).toBe(false);
  };

  it("moves the message into a column beside the sidebar on a wide window", () => {
    show();
    runIdle();

    expectInColumn();
  });

  it("moves the message back above the diffs when the window narrows", () => {
    show();
    runIdle();
    setViewport(NARROW);

    expect(column()).toBeNull();
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
    expect(box().previousElementSibling).toBe(container());
    expect(shows(box())).toBe(false);

    setViewport(WIDE);

    expectInColumn();
  });

  it("moves the view switch into the column with the message", () => {
    show();
    runIdle();

    expect(column()?.querySelector(".gh-prism-commit-view-switch")).toBe(viewButton());
  });

  it("shows a copy of GitHub's box in the column's plaintext view", () => {
    choice.view = "plaintext";
    const real = box();

    show();
    runIdle();

    const copy = column()?.querySelector(".gh-prism-commit-message-plain");
    const body = column()?.querySelector(".gh-prism-commit-message-body");
    if (!copy || !body) throw new Error("no copy or body");
    expect(shows(copy)).toBe(true);
    expect(getComputedStyle(copy).flexDirection).toBe("column");
    expect(copy.textContent).toBe(real.textContent);
    expect(shows(body)).toBe(false);
    expect(shows(real)).toBe(false);
    expect(findCommitMessage(pageOf())?.box).toBe(real);
  });

  it("hides the copy and shows GitHub's box above the diffs in the plaintext view", () => {
    setViewport(NARROW);
    choice.view = "plaintext";

    show();
    runIdle();

    const copy = container()?.querySelector(".gh-prism-commit-message-plain");
    if (!copy) throw new Error("no copy");
    expect(shows(copy)).toBe(false);
    expect(shows(box())).toBe(true);
  });

  it("builds no column for a subject-only message", () => {
    loadCommitFixture("subject");

    show();
    runIdle();

    expect(column()).toBeNull();
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("keeps the message above the diffs when the layout row is missing", () => {
    const layoutRow = row();
    if (!layoutRow) throw new Error("no row");
    layoutRow.replaceWith(...layoutRow.childNodes);
    show();
    runIdle();

    expect(column()).toBeNull();
    expect(box().previousElementSibling).toBe(container());
  });

  it("keeps GitHub's box and builds no column when the message is over the cap", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = "a".repeat(50_001);
    show();

    expect(column()).toBeNull();

    runIdle();

    expect(column()).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("holds the column in a loading state from the start", () => {
    show();

    expectInColumn();
    expect(container()?.getAttribute("aria-busy")).toBe("true");
  });

  it("drops the column for GitHub's box when the message nests too deep to render", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = `${">".repeat(40)} deep`;
    show();
    runIdle();

    expect(column()).toBeNull();
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("follows GitHub's re-render of the card while the message is in the column", async () => {
    show();
    runIdle();
    const clone = box().cloneNode(true) as Element;
    box().replaceWith(clone);
    await afterMutations();

    expect(clone.previousElementSibling?.matches(".gh-prism-commit-slot")).toBe(true);
    expect(column()?.firstElementChild).toBe(container());
    expect(document.querySelectorAll(".gh-prism-commit-column")).toHaveLength(1);
  });

  it("moves the message above the diffs when GitHub detaches the layout row", async () => {
    show();
    runIdle();
    const layoutRow = row();
    if (!layoutRow) throw new Error("no row");
    layoutRow.replaceWith(...layoutRow.childNodes);
    box().after(document.createElement("div"));
    await afterMutations();

    expect(box().previousElementSibling).toBe(container());
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
  });

  it("re-adds the column when GitHub drops it from the layout row", async () => {
    show();
    runIdle();
    column()?.remove();
    await afterMutations();

    expect(row()?.firstElementChild).toBe(column());
    expect(column()?.firstElementChild).toBe(container());
  });

  it("leaves no column, slot, or sheet after abort", () => {
    show();
    runIdle();
    controller.abort();
    setViewport(NARROW);
    setViewport(WIDE);

    expect(column()).toBeNull();
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
    expect(sheets()).toHaveLength(0);
    expect(shows(box())).toBe(true);
  });
});

describe("showCommitMessage's column width", () => {
  const handle = () =>
    document.querySelector<HTMLElement>('.gh-prism-commit-column > [role="separator"]');
  const widthOf = () => document.querySelector<HTMLElement>(".gh-prism-commit-column")?.style.width;
  const press = (key: string) =>
    handle()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  const pointer = (type: string, clientX: number) =>
    handle()?.dispatchEvent(
      new PointerEvent(type, { clientX, pointerId: 1, button: 0, bubbles: true }),
    );
  const resizeTo = (width: number) => setViewport({ width, height: 768 });

  beforeEach(() => setViewport(WIDE));
  afterEach(() => setViewport(DEFAULT));

  it("opens the column at the tab's width, with a separator on its edge saying so", () => {
    choice.width = 360;

    show();

    expect(widthOf()).toBe("360px");
    const separator = handle();
    if (!separator) throw new Error("no separator");
    expect(shows(separator)).toBe(true);
    expect(separator.tabIndex).toBe(0);
    expect(handle()?.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle()?.getAttribute("aria-valuenow")).toBe("360");
    expect(handle()?.getAttribute("aria-valuemin")).toBe("256");
    expect(handle()?.getAttribute("aria-valuemax")).toBe("388");
  });

  it("holds the column to no more than the window leaves past GitHub's 1012px docked layout", () => {
    choice.width = 600;
    show();

    expect(widthOf()).toBe("388px");

    resizeTo(1300);

    expect(widthOf()).toBe("288px");
    expect(handle()?.getAttribute("aria-valuenow")).toBe("288");
    expect(choice.width).toBe(600);
  });

  it("holds the column to no less than 256px", () => {
    choice.width = 100;

    show();

    expect(widthOf()).toBe("256px");
  });

  it("keeps the column while the window spares 256px past GitHub's docked layout, and moves above the diffs below that", () => {
    show();
    resizeTo(1268);

    expect(column()).not.toBeNull();
    expect(widthOf()).toBe("256px");

    resizeTo(1267);

    expect(column()).toBeNull();
    expect(box().previousElementSibling).toBe(container());
  });

  it("steps the width 3px an arrow key, within its bounds, saving each width", () => {
    choice.width = 384;
    show();

    press("ArrowRight");

    expect(widthOf()).toBe("387px");
    expect(handle()?.getAttribute("aria-valuenow")).toBe("387");
    expect(choice.width).toBe(387);
    expect(saveWidth).toHaveBeenLastCalledWith(387);

    press("ArrowUp");

    expect(widthOf()).toBe("388px");

    press("ArrowLeft");
    press("ArrowDown");

    expect(widthOf()).toBe("382px");
    expect(saveWidth).toHaveBeenLastCalledWith(382);
  });

  it("follows a drag of its edge within its bounds, saving the width once on release", () => {
    show();

    pointer("pointerdown", 320);
    pointer("pointermove", 350);

    expect(widthOf()).toBe("350px");
    expect(handle()?.hasAttribute("data-dragging")).toBe(true);

    pointer("pointermove", 500);

    expect(widthOf()).toBe("388px");
    expect(saveWidth).not.toHaveBeenCalled();

    pointer("pointerup", 500);
    pointer("pointermove", 300);

    expect(widthOf()).toBe("388px");
    expect(choice.width).toBe(388);
    expect(saveWidth).toHaveBeenCalledOnce();
    expect(saveWidth).toHaveBeenCalledWith(388);
    expect(handle()?.hasAttribute("data-dragging")).toBe(false);
  });

  it("ignores a key that isn't an arrow, and a drag by another button", () => {
    show();

    press("Enter");
    handle()?.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 320, pointerId: 1, button: 2, bubbles: true }),
    );
    pointer("pointermove", 350);

    expect(widthOf()).toBe("320px");
    expect(saveWidth).not.toHaveBeenCalled();
  });
});

describe("showCommitMessage's hide control", () => {
  const hideButton = () => document.querySelector<HTMLButtonElement>(".gh-prism-commit-hide");
  const restore = () => document.querySelector<HTMLElement>(".gh-prism-commit-restore");
  const restoreButton = () => restore()?.querySelector("button");

  afterEach(() => setViewport(DEFAULT));

  it("hides the message and GitHub's box, leaving a way back in the box's place, and saves the pick", () => {
    show();
    runIdle();
    expect(hideButton()?.getAttribute("aria-label")).toBe("Hide commit message");

    hideButton()?.click();

    expect(container()).toBeNull();
    expect(shows(box())).toBe(false);
    expect(restore()?.parentElement).toBe(box().parentElement);
    expect(restoreButton()?.type).toBe("button");
    expect(visit.hidden).toBe(true);
    expect(saveHidden).toHaveBeenLastCalledWith(true);
  });

  it("gives the diffs the column's room back once hidden", () => {
    setViewport(WIDE);
    show();
    runIdle();

    hideButton()?.click();

    expect(column()).toBeNull();
    expect(restore()?.parentElement).toBe(box().parentElement);
  });

  it("brings the message back where the window puts it, saving the pick", () => {
    setViewport(WIDE);
    show();
    runIdle();
    hideButton()?.click();

    restoreButton()?.click();

    expect(column()?.firstElementChild).toBe(container());
    expect(restore()).toBeNull();
    expect(visit.hidden).toBe(false);
    expect(saveHidden).toHaveBeenLastCalledWith(false);
  });

  it("opens hidden for a commit hidden before, rendering only once it's shown", () => {
    visit.hidden = true;

    show();

    expect(container()).toBeNull();
    expect(restore()).not.toBeNull();
    expect(shows(box())).toBe(false);
    expect(tasks).toHaveLength(0);

    restoreButton()?.click();

    expect(container()?.hasAttribute("aria-busy")).toBe(false);
    expect(container()?.querySelector(".gh-prism-commit-message-body > h1")).not.toBeNull();
  });

  it("hands focus to the control that brings the message back, and back again", () => {
    show();
    runIdle();
    hideButton()?.focus();

    hideButton()?.click();

    expect(document.activeElement).toBe(restoreButton());

    restoreButton()?.click();

    expect(document.activeElement).toBe(hideButton());
  });

  it("leaves the view the tab picked as it is", () => {
    choice.view = "plaintext";
    show();
    runIdle();

    hideButton()?.click();
    restoreButton()?.click();

    expect(container()?.dataset.view).toBe("plaintext");
    expect(choice.view).toBe("plaintext");
    expect(save).not.toHaveBeenCalled();
  });

  it("goes back to GitHub's box when a message shown again can't be rendered", () => {
    const body = box().querySelector(".extended-commit-description-container");
    if (!body) throw new Error("no body");
    body.textContent = `${">".repeat(40)} deep`;
    visit.hidden = true;
    show();

    restoreButton()?.click();

    expect(container()).toBeNull();
    expect(restore()).toBeNull();
    expect(shows(box())).toBe(true);
  });

  it("removes its way back on abort, showing GitHub's box", () => {
    show();
    runIdle();
    hideButton()?.click();

    controller.abort();

    expect(restore()).toBeNull();
    expect(shows(box())).toBe(true);
  });
});

describe("showCommitMessage across navigation", () => {
  const navigate = async (path: string, load: () => void) => {
    history.pushState(null, "", path);
    load();
    document.dispatchEvent(new Event("soft-nav:end"));
    await vi.advanceTimersByTimeAsync(0);
  };
  const title = () => container()?.querySelector("h1")?.textContent;
  const titleOf = (name: "sha" | "mention") => {
    loadCommitFixture(name);
    return messageOf().title.textContent;
  };
  const watchCommits = () =>
    watchFilesPages(
      window,
      {
        onVisit: () => {
          const visit = { since: performance.now(), hidden: false };
          return (page, signal) =>
            showCommitMessage(page, signal, {
              afterSections: (task) => task(),
              choice,
              save,
              saveWidth,
              saveHidden,
              visit,
            });
        },
        onMissing: () => {},
      },
      controller.signal,
    );

  it("shows each commit's message and leaves nothing behind off commit pages", async () => {
    const mentionTitle = titleOf("mention");
    const shaTitle = titleOf("sha");
    watchCommits();
    await afterMutations();
    expect(title()).toBe(shaTitle);

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));
    expect(title()).toBe(mentionTitle);
    expect(document.querySelectorAll(".gh-prism-commit-message")).toHaveLength(1);

    await navigate("/o/r/pull/1/changes", loadFixture);
    expect(container()).toBeNull();
    expect(sheets()).toHaveLength(0);
  });

  it("opens the next commit in the view the tab last picked", async () => {
    watchCommits();
    await afterMutations();
    viewButton()?.click();

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));

    expect(container()?.dataset.view).toBe("plaintext");
    expect(shows(box())).toBe(true);
    expect(viewButton()?.getAttribute("aria-label")).toBe("Show rendered Markdown");
  });

  it("shows each commit's message in the column across navigation", async () => {
    setViewport(WIDE);
    onTestFinished(() => setViewport(DEFAULT));
    const mentionTitle = titleOf("mention");
    const shaTitle = titleOf("sha");
    watchCommits();
    await afterMutations();
    expect(column()?.querySelector("h1")?.textContent).toBe(shaTitle);
    expect(document.querySelectorAll(".gh-prism-commit-column")).toHaveLength(1);

    await navigate("/o/r/commit/4f0a580", () => loadCommitFixture("mention"));
    expect(column()?.querySelector("h1")?.textContent).toBe(mentionTitle);
    expect(document.querySelectorAll(".gh-prism-commit-column")).toHaveLength(1);

    await navigate("/o/r/pull/1/changes", loadFixture);
    expect(column()).toBeNull();
    expect(document.querySelector(".gh-prism-commit-slot")).toBeNull();
    expect(sheets()).toHaveLength(0);
  });
});
