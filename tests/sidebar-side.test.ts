// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { dockSidebar, type SideChoice } from "../entrypoints/content/sidebar-side";

// Trimmed from sandbox PR #3's Files changed toolbar.
const TOOLBAR = `
<section class="PullRequestFilesToolbar-module__toolbar__ztHN6">
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

function dock(side: SideChoice["side"]) {
  const choice: SideChoice = { side };
  const save = vi.fn();
  dockSidebar(document, controller.signal, { choice, save });
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
