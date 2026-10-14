// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitPage, type PageKind, prPage } from "../../../entrypoints/content/files-page";
import { dockSidebar, type SideChoice } from "../../../entrypoints/content/sidebar/side";

// Trimmed from sandbox PR #3's Files changed toolbar.
const TOOLBAR = `
<section class="toolbar__ztHN6">
  <div data-component="Stack">
    <div id="tree-toggle">
      <button class="DiffComparisonViewer-module__MobileTreeToggle__wwbbS"></button>
      <button class="DiffComparisonViewer-module__RegularTreeToggle__fSFG6"></button>
    </div>
    <div id="commits"></div>
  </div>
  <div data-component="Stack"></div>
</section>`;

let controller: AbortController;

const switcher = () => document.querySelector<HTMLButtonElement>(".gh-prism-side-switch");
const treeToggle = () => document.querySelector<HTMLButtonElement>('[class*="RegularTreeToggle"]');
const docked = () => document.documentElement.dataset.ghPrismSide;
const gliding = () => document.documentElement.dataset.ghPrismGlide;

/** Chrome's view transitions, which happy-dom lacks, reduced to running the update at once. */
function stubViewTransitions() {
  const start = vi.fn((update: () => void | Promise<void>) => {
    const finished = Promise.resolve(update()).then(() => undefined);
    return { finished } as ViewTransition;
  });
  Object.assign(document, { startViewTransition: start });
  return start;
}

function dock(side: SideChoice["side"], kind: PageKind = prPage) {
  const choice: SideChoice = { side };
  const save = vi.fn();
  const page = { kind, sidebar: document.body, tree: document.body, diffs: document.body };
  dockSidebar(page, controller.signal, { choice, save });
  return { choice, save };
}

beforeEach(() => {
  document.body.innerHTML = TOOLBAR;
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  Reflect.deleteProperty(document, "startViewTransition");
});

it("docks on the chosen side, with a switch to the other just after GitHub's tree toggle", () => {
  dock("right");
  expect(docked()).toBe("right");
  expect(switcher()?.previousElementSibling?.id).toBe("tree-toggle");
  expect(switcher()?.getAttribute("aria-label")).toBe("Move file tree to the left");
});

it("switches sides on click, keeping the tab's choice and saving it", () => {
  const { choice, save } = dock("right");

  switcher()?.click();
  expect(docked()).toBe("left");
  expect(choice.side).toBe("left");
  expect(save).toHaveBeenLastCalledWith("left");
  expect(switcher()?.getAttribute("aria-label")).toBe("Move file tree to the right");

  switcher()?.click();
  expect(docked()).toBe("right");
  expect(save).toHaveBeenLastCalledWith("right");
});

it("replaces a switch a restored snapshot carries", () => {
  document.querySelector("#tree-toggle")?.after(
    Object.assign(document.createElement("button"), {
      className: "gh-prism-side-switch",
    }),
  );
  dock("left");
  expect(document.querySelectorAll(".gh-prism-side-switch")).toHaveLength(1);
});

it("hands the layout back to GitHub once the signal aborts", () => {
  dock("right");
  controller.abort();
  expect(docked()).toBeUndefined();
  expect(switcher()).toBeNull();
  expect(document.head.querySelector("style")).toBeNull();
});

it("leaves GitHub's layout alone when its tree toggle is missing", () => {
  document.body.innerHTML = "";
  dock("right");
  expect(docked()).toBeUndefined();
  expect(document.head.querySelector("style")).toBeNull();
});

it("lets GitHub's tree toggle through as is without view transitions", () => {
  dock("right");
  const github = vi.fn();
  treeToggle()?.addEventListener("click", github);
  treeToggle()?.click();
  expect(github).toHaveBeenCalledOnce();
});

it("replays a tree toggle click inside a glide, so GitHub collapses the tree mid-transition", async () => {
  const start = stubViewTransitions();
  dock("right");
  const glideAtClick: (string | undefined)[] = [];
  treeToggle()?.addEventListener("click", () => glideAtClick.push(gliding()));

  treeToggle()?.click();
  expect(glideAtClick).toEqual(["toggle"]);

  await start.mock.results[0]?.value.finished;
  expect(gliding()).toBeUndefined();
});

// Trimmed from a commit page's diff toolbar; the first toggle is the narrow layout's.
const COMMIT_TOOLBAR = `
<div id="diff-content-parent">
  <div class="position-sticky">
    <div id="commit-tree-toggle">
      <button aria-controls="diff_file_tree" class="d-md-none"></button>
      <button aria-controls="diff_file_tree" class="d-none d-md-flex"></button>
    </div>
    <div class="width-full"></div>
  </div>
</div>`;

it("docks a commit page's sidebar, with the switch just after its tree toggle", () => {
  document.body.innerHTML = COMMIT_TOOLBAR;
  dock("right", commitPage);
  expect(docked()).toBe("right");
  expect(switcher()?.previousElementSibling?.id).toBe("commit-tree-toggle");
});

// Trimmed from a commit page: the tree is Primer's start pane, sized by its divider's handle.
const PANE = `
<div class="prc-PageLayout-PaneWrapper-pHPop" data-position="start">
  <div class="prc-PageLayout-Pane-AyzHK"><div id="diff_file_tree"></div></div>
  <div data-component="PageLayout.VerticalDivider" data-position="start">
    <div data-component="PageLayout.DragHandle" role="slider"></div>
  </div>
</div>`;

/** Drags the pane's handle 30px right, returning the pointer x Primer reads on the move. */
function dragHandle(handleLeft: number) {
  document.body.innerHTML = COMMIT_TOOLBAR + PANE;
  dock("right", commitPage);

  const wrapper = document.querySelector<HTMLElement>('[class*="PageLayout-PaneWrapper"]');
  const handle = document.querySelector<HTMLElement>('[data-component="PageLayout.DragHandle"]');
  if (!wrapper || !handle) throw new Error("no pane");
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 600));
  vi.spyOn(handle, "getBoundingClientRect").mockReturnValue(new DOMRect(handleLeft, 0, 4, 600));

  const primer: number[] = [];
  document.body.addEventListener("pointermove", (event) => primer.push(event.clientX));

  const pointer = { bubbles: true, cancelable: true, buttons: 1 };
  handle.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: 100 }));
  handle.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: 130 }));

  return primer;
}

it("mirrors a drag on the divider at the tree's left, so the tree narrows as it's dragged right", () => {
  expect(dragHandle(0)).toEqual([70]);
});

it("passes a drag through where the divider stays at the tree's right", () => {
  expect(dragHandle(296)).toEqual([130]);
});

it("replays a commit page's tree toggle click inside a glide, but not its narrow toggle's", async () => {
  document.body.innerHTML = COMMIT_TOOLBAR;
  const start = stubViewTransitions();
  dock("right", commitPage);
  const [narrow, regular] = document.querySelectorAll("button[aria-controls]");

  regular?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  narrow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(start).toHaveBeenCalledOnce();
  await start.mock.results[0]?.value.finished;
});
