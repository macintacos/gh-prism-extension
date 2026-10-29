// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { visitViewed } from "../../../entrypoints/content/diffs/viewed";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import { showSections } from "../../../entrypoints/content/sidebar/sections-view";
import { showVisit } from "../../../entrypoints/content/visit/land";
import { byId, closeOverlay, loadViewedFixture, openOverlay } from "../../fixtures/files-page";
import { landedWith } from "../../fixtures/intent";
import {
  COMMENT_LINES,
  clickAt,
  commentLinesRoot,
  countIn,
  hostOf,
  nativeLink,
  patchShadowActiveElement,
  rowIn,
  sectionToggle,
  viewed,
  withCommentLines,
} from "../../fixtures/sections-view";
import { afterDebounce, mountsVisit, view } from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null. Hoisted above
// the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

// Spied so tests can reach the hooks of the sidebar showVisit mounted.
vi.mock(import("../../../entrypoints/content/sidebar/sections-view"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, showSections: vi.fn(original.showSections) };
});

patchShadowActiveElement();

const { landed, abort } = mountsVisit();

const sidebar = () => {
  const mounted = vi.mocked(showSections).mock.results.at(-1)?.value;
  if (!mounted) throw new Error("no sidebar mounted");
  return mounted;
};
const treeOf = (container: Element) => container.querySelector('ul[role="tree"]');
const expanded = (section: string) => sectionToggle(section).getAttribute("aria-expanded");

let overlay: HTMLElement;
/** `path`'s link in the overlay's copy of the tree, which shares the docked rows' ids. */
const overlayLink = (path: string) => {
  const link = overlay.querySelector(`[id="${path}"] a[href^="#diff-"]`);
  if (!(link instanceof HTMLAnchorElement)) throw new Error(`no overlay link for ${path}`);
  return link;
};
const open = async () => {
  overlay = openOverlay();
  await afterDebounce();
};

describe("showSections in the narrow layout's overlay", () => {
  beforeEach(async () => {
    await landed(landedWith());
  });

  it("moves the one sections view before the overlay's tree", async () => {
    await open();

    expect(document.querySelectorAll(".gh-prism-sections")).toHaveLength(1);
    expect(view()?.nextElementSibling).toBe(treeOf(overlay));
  });

  it("keeps the what's-new block first in the overlay", async () => {
    abort();
    const page = findFilesPage(document);
    if (!page) throw new Error("fixture lacks the Files changed markup");
    const visit = new AbortController();
    onTestFinished(() => visit.abort());
    showVisit(page, visit.signal, {
      intent: () => landedWith(),
      diffstat: { choice: { view: "breakout" }, save: () => {} },
      viewed: visitViewed(undefined),
      teamMembers: async () => undefined,
      whatsNew: { version: "1.2.3", notes: "", dismiss: () => {} },
    });
    await open();

    const block = overlay.parentElement?.querySelector(".gh-prism-whats-new");
    expect(block).toBeInstanceOf(HTMLElement);
    expect(block?.parentElement?.firstElementChild).toBe(block);
    expect(view()?.nextElementSibling).toBe(treeOf(overlay));
  });

  it("doesn't replay the landing reveal in the overlay", async () => {
    expect(view()?.hasAttribute("data-reveal")).toBe(true);

    await open();

    expect(view()?.hasAttribute("data-reveal")).toBe(false);
  });

  it("moves back before the docked tree once the overlay closes", async () => {
    await open();
    closeOverlay();
    await afterDebounce();

    expect(document.querySelectorAll(".gh-prism-sections")).toHaveLength(1);
    expect(view()?.nextElementSibling).toBe(treeOf(byId("pr-file-tree")));
  });

  it("keeps a section collapsed in either tree collapsed in the other", async () => {
    sectionToggle("implementation").click();
    await open();
    expect(expanded("implementation")).toBe("false");

    sectionToggle("implementation").click();
    sectionToggle("docs").click();
    closeOverlay();
    await afterDebounce();
    expect(expanded("implementation")).toBe("true");
    expect(expanded("docs")).toBe("false");
  });

  it("renders Viewed boxes and header counts", async () => {
    viewed("src/engine.rs");
    await open();

    const box = hostOf("implementation").shadowRoot?.querySelector<HTMLInputElement>(
      'input[data-item-checkbox="src/engine.rs"]',
    );
    expect(box?.checked).toBe(true);
    expect(countIn(sectionToggle("implementation"))).toMatch(/^1\//);
  });

  it("renders the comment-lines sub-section", async () => {
    await landed(withCommentLines());
    await open();

    expect(commentLinesRoot()).not.toBeNull();
    expect(rowIn(COMMENT_LINES, "src/engine.rs")).toBeTruthy();
  });

  it("keeps a header's on-screen mark", async () => {
    sidebar().onScreen(new Set(["src/engine.rs"]));
    await open();

    expect(
      document
        .querySelector('.gh-prism-section[data-section="implementation"]')
        ?.hasAttribute("data-on-screen"),
    ).toBe(true);
  });

  it("scrolls the overlay's sections to the current file", async () => {
    const scrollIntoView = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});

    await open();

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    scrollIntoView.mockRestore();
  });

  it("clicks the overlay's link for a row click", async () => {
    await open();
    const link = vi.spyOn(overlayLink("src/engine.rs"), "click");

    clickAt(rowIn("implementation", "src/engine.rs"));

    expect(link).toHaveBeenCalledOnce();
  });
});

describe("a Viewed box ticked in the overlay for a file whose diff isn't mounted", () => {
  const LIB = "src/lib.rs";

  it("marks the file once the reveal closes the overlay", async () => {
    loadViewedFixture();
    await landed(landedWith());
    const region = byId(nativeLink(LIB).hash.slice(1));
    const entry = region.parentElement ?? region;
    const toggle = entry.querySelector<HTMLButtonElement>('button[aria-label$="Viewed"]');
    if (!toggle) throw new Error("no Viewed toggle");
    const flip = vi.spyOn(toggle, "click");
    entry.remove();
    await open();

    // GitHub closes the overlay on a file click, then mounts its diff.
    overlayLink(LIB).addEventListener("click", () => {
      closeOverlay();
      document.querySelector('[data-testid="progressive-diffs-list"]')?.append(entry);
    });
    const box = hostOf("implementation").shadowRoot?.querySelector<HTMLInputElement>(
      `input[data-item-checkbox="${LIB}"]`,
    );
    if (!box) throw new Error(`no box for ${LIB}`);
    clickAt(box);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(flip).toHaveBeenCalledOnce();
  });
});
