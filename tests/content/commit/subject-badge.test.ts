// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { badgeSubject } from "../../../entrypoints/content/commit/subject-badge";
import { findCommitMessage } from "../../../entrypoints/content/files-page";
import { foundPage, loadCommitFixture } from "../../fixtures/files-page";

const message = () => {
  const found = findCommitMessage(foundPage());
  if (!found) throw new Error("no commit message");
  return found;
};
const badged = () => document.querySelector(".gh-prism-commit-title");
const sheets = () =>
  [...document.head.querySelectorAll("style")].filter((style) =>
    style.textContent?.includes("gh-prism-commit-title"),
  );
// A MutationObserver's callback runs in a microtask.
const afterMutations = () => Promise.resolve();

/** Loads the subject-only card with `children` as its title, and badges it. */
function badge(...children: (Node | string)[]): void {
  loadCommitFixture("subject");
  message().title.replaceChildren(...children);
  badgeSubject(foundPage(), controller.signal);
}

/** A link as GitHub writes an issue reference. */
function linkTo(text: string): HTMLAnchorElement {
  const link = Object.assign(document.createElement("a"), { href: "/o/r/pull/7" });
  link.textContent = text;
  return link;
}

let controller: AbortController;

beforeEach(() => {
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
});

describe("badgeSubject", () => {
  it("shows a conventional subject as its type's label, its scope, and its description, in front of GitHub's title", () => {
    badge("fix(cli): skip the cleanup");

    const shown = message().title.previousElementSibling;
    expect(shown).toBe(badged());
    expect(shown?.querySelector(".gh-prism-commit-type")?.textContent).toBe("Fix");
    expect(shown?.querySelector(".gh-prism-commit-scope")?.textContent).toBe("cli: ");
    expect(shown?.textContent).toBe("Fix cli: skip the cleanup");
  });

  it("hides GitHub's title behind the badged one, leaving it as GitHub wrote it", () => {
    badge("fix(cli): skip the cleanup");

    expect(getComputedStyle(message().title).display).toBe("none");
    expect(message().title.outerHTML).toBe("<div>fix(cli): skip the cleanup</div>");
  });

  it("copies GitHub's links after the prefix", () => {
    badge("feat: order the diffs (", linkTo("#7"), ")");

    expect(badged()?.querySelector("a")?.getAttribute("href")).toBe("/o/r/pull/7");
    expect(badged()?.textContent).toBe("Feature order the diffs (#7)");
  });

  it.each([
    ["isn't conventional", ["Replace msgpack with an encoder"]],
    ["has a link inside its prefix", ["fix(", linkTo("#7"), "): skip the cleanup"]],
  ])("leaves a subject that %s as GitHub shows it", (_, children) => {
    badge(...children);

    expect(badged()).toBeNull();
    expect(getComputedStyle(message().title).display).not.toBe("none");
  });

  it("follows GitHub rewriting the title's text", async () => {
    badge("fix: skip the cleanup");

    message().title.textContent = "docs(readme): name the stores";
    await afterMutations();

    expect(document.querySelectorAll(".gh-prism-commit-title")).toHaveLength(1);
    expect(badged()?.textContent).toBe("Docs readme: name the stores");
  });

  it("titles the badged copy with GitHub's title as written, following its rewrites", async () => {
    badge("fix(cli): skip the cleanup");
    expect(badged()?.getAttribute("title")).toBe("fix(cli): skip the cleanup");

    message().title.textContent = "docs(readme): name the stores";
    await afterMutations();

    expect(badged()?.getAttribute("title")).toBe("docs(readme): name the stores");
  });

  it("follows GitHub replacing the title", async () => {
    badge("fix: skip the cleanup");

    const next = document.createElement("div");
    next.textContent = "test: cover the encoder";
    message().title.replaceWith(next);
    await afterMutations();

    expect(document.querySelectorAll(".gh-prism-commit-title")).toHaveLength(1);
    expect(next.previousElementSibling).toBe(badged());
    expect(badged()?.textContent).toBe("Test cover the encoder");
  });

  it("drops the badged title once GitHub's stops being conventional", async () => {
    badge("fix: skip the cleanup");

    message().title.textContent = "Skip the cleanup";
    await afterMutations();

    expect(badged()).toBeNull();
  });

  it("hands GitHub's box back on abort", () => {
    loadCommitFixture("subject");
    message().title.textContent = "fix: skip the cleanup";
    const before = message().box.outerHTML;
    badgeSubject(foundPage(), controller.signal);

    controller.abort();

    expect(message().box.outerHTML).toBe(before);
    expect(sheets()).toHaveLength(0);
  });
});
