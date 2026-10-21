// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkTo } from "../../fixtures/files-page";
import { mountsVisit } from "../../fixtures/visit";

// Chrome content scripts run in an isolated world whose `customElements` is null, so every test
// here mounts the view that way. Hoisted above the imports, which load @pierre/trees.
vi.hoisted(() => {
  Object.defineProperty(window, "customElements", { configurable: true, value: null });
});

const { remountWith } = mountsVisit();

/** Presses `key` on `target`, as a reviewer does. */
function press(key: string, target: Element = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Names `path`'s file in the URL's hash, as GitHub does once it reveals the file. */
function current(path: string): void {
  history.replaceState(null, "", linkTo(path).getAttribute("href"));
}

describe("j and k", () => {
  let clicked: () => (string | undefined)[];

  beforeEach(() => {
    history.replaceState(null, "", location.pathname);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    clicked = () =>
      click.mock.contexts.map((link) =>
        link instanceof Element ? link.closest('[role="treeitem"]')?.id : undefined,
      );

    return () => click.mockRestore();
  });

  it("reveal the file the sidebar lists after the one the URL names, not GitHub's next", () => {
    current("tests/integration.rs");

    press("j");

    expect(clicked()).toEqual(["docs/guide.md"]);
  });

  it("reveal the file the sidebar lists before the one the URL names, not GitHub's previous", () => {
    current("docs/guide.md");

    press("k");

    expect(clicked()).toEqual(["tests/integration.rs"]);
  });

  it("step from the file whose line the URL names", () => {
    history.replaceState(null, "", `${linkTo("tests/integration.rs").getAttribute("href")}R12`);

    press("j");

    expect(clicked()).toEqual(["docs/guide.md"]);
  });

  it("reveal the sidebar's first file when the URL names none", () => {
    press("j");

    expect(clicked()).toEqual(["src/generated/schema.rs"]);
  });

  it("keep the key from the page's other listeners, so they don't move too", () => {
    const later = vi.fn();
    document.body.addEventListener("keydown", later);

    const event = press("j");

    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", later);
  });

  it("leave the key alone while the reviewer types", () => {
    const field = document.body.appendChild(document.createElement("textarea"));

    const event = press("j", field);

    expect(event.defaultPrevented).toBe(false);
    expect(clicked()).toEqual([]);
  });

  it("leave the key alone while GitHub virtualizes the diffs, which keep GitHub's order", () => {
    const diffs = document.querySelector('[data-testid="diff-content"]');
    if (!diffs) throw new Error("fixture has no diff content");
    diffs.innerHTML =
      '<div style="position: relative"><div data-index="0" style="position: absolute; top: 0px">' +
      '<div role="region" id="diff-0a01"></div></div></div>';
    remountWith();

    const event = press("j");

    expect(event.defaultPrevented).toBe(false);
    expect(clicked()).toEqual([]);
  });
});
