// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { showCommitMessage } from "../../../entrypoints/content/commit/message-view";
import { findFilesPage } from "../../../entrypoints/content/files-page";
import { loadCommitFixture } from "../../fixtures/files-page";

vi.mock(import("../../../entrypoints/content/commit/message"), () => ({
  renderCommitMessage: vi.fn(() => {
    throw new Error("parser broke");
  }),
}));

it("keeps GitHub's box and warns when the message fails to render", () => {
  history.replaceState(null, "", "/o/r/commit/dd95cdc");
  loadCommitFixture("lists");
  const page = findFilesPage(document);
  if (!page) throw new Error("no Files page");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  showCommitMessage(page, new AbortController().signal, { afterSections: (task) => task() });

  const box = document.querySelector('[class*="commitMessageContainer__"]');
  if (!box) throw new Error("no message box");
  expect(getComputedStyle(box).display).not.toBe("none");
  expect(document.querySelector(".gh-prism-commit-message")).toBeNull();
  expect(warn).toHaveBeenCalledOnce();
  expect(warn.mock.calls[0]?.[0]).toMatch(/^gh-prism: couldn't render the commit message/);
});
