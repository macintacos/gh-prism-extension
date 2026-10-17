// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NoticeChoice, showClassicNotice } from "../../../entrypoints/content/classic/notice";
import { findClassicPage } from "../../../entrypoints/content/files-page";
import { loadClassicFixture } from "../../fixtures/files-page";

const DOCS =
  "https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview";

let controller: AbortController;

const notice = () => document.querySelector<HTMLElement>("section.gh-prism-notice");
const reopen = () => document.querySelector<HTMLButtonElement>("button.gh-prism-notice-reopen");
const dismiss = () => notice()?.querySelector<HTMLButtonElement>("button") ?? null;
const links = () => [...(notice()?.querySelectorAll("a") ?? [])];
const steps = () => [...(notice()?.querySelectorAll("ol > li") ?? [])].map((li) => li.textContent);

function show(dismissed = false) {
  const page = findClassicPage(document);
  if (!page) throw new Error("fixture has no classic page");
  const choice: NoticeChoice = { dismissed };
  const save = vi.fn();
  showClassicNotice(page, controller.signal, { choice, save });
  return { page, choice, save };
}

beforeEach(() => {
  history.replaceState(null, "", "/o/r/pull/1/files");
  loadClassicFixture("");
  controller = new AbortController();
});

afterEach(() => {
  controller.abort();
  preferReducedMotion("no-preference");
});

/** Sets the media feature happy-dom reports for `prefers-reduced-motion`. */
function preferReducedMotion(preference: "reduce" | "no-preference"): void {
  const { happyDOM } = window as unknown as {
    happyDOM: { settings: { device: { prefersReducedMotion: string } } };
  };
  happyDOM.settings.device.prefersReducedMotion = preference;
}

describe("showClassicNotice", () => {
  it("shows the notice just above GitHub's toolbar, as a region its heading names", () => {
    const { page } = show();

    expect(notice()?.nextElementSibling).toBe(page.toolbar);
    expect(notice()?.hidden).toBe(false);
    const title = notice()?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(title)?.closest("section")).toBe(notice());
    expect(reopen()?.hidden).toBe(true);
  });

  it("asks a signed-out viewer to sign in, coming back to this page", () => {
    show();

    const signIn = links().find((link) => link.pathname === "/login");
    expect(new URL(signIn?.href ?? "", location.href).searchParams.get("return_to")).toBe(
      location.href,
    );
    expect(steps()).toEqual([]);
  });

  it("walks a signed-in viewer through turning on GitHub's preview, citing GitHub Docs", () => {
    loadClassicFixture("octocat");
    show();

    // GitHub's own labels, in the order the viewer meets them in the profile menu and its dialog.
    expect(steps()).toEqual([
      expect.stringContaining("profile picture"),
      expect.stringContaining("Feature preview"),
      expect.stringContaining("New Files Changed Experience"),
      expect.stringContaining("Enable"),
    ]);
    expect(links().map((link) => link.href)).toEqual([DOCS]);
  });

  it("dismisses into the re-open button beside the review tools, saving the dismissal", () => {
    const { page, choice, save } = show();

    dismiss()?.click();

    expect(notice()?.hidden).toBe(true);
    expect(reopen()?.hidden).toBe(false);
    expect(reopen()?.nextElementSibling).toBe(page.reviewTools);
    expect(document.activeElement).toBe(reopen());
    expect(choice.dismissed).toBe(true);
    expect(save).toHaveBeenLastCalledWith(true);
  });

  it("re-opens the notice and moves focus to it, saving the change", () => {
    const { choice, save } = show(true);

    reopen()?.click();

    expect(notice()?.hidden).toBe(false);
    expect(reopen()?.hidden).toBe(true);
    expect(document.activeElement).toBe(notice());
    expect(choice.dismissed).toBe(false);
    expect(save).toHaveBeenLastCalledWith(false);
  });

  it("re-opens without motion when the viewer prefers reduced motion", () => {
    preferReducedMotion("reduce");
    show(true);

    reopen()?.click();

    expect(notice() && getComputedStyle(notice() as HTMLElement).animation).toBe("none");
  });

  it("starts dismissed, with only the re-open button showing, when the choice says so", () => {
    const { save } = show(true);

    expect(notice()?.hidden).toBe(true);
    expect(reopen()?.hidden).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("names both buttons for what they do", () => {
    show();

    expect(dismiss()?.getAttribute("aria-label")).toMatch(/dismiss/i);
    expect(reopen()?.textContent).toMatch(/gh-prism/);
    expect([dismiss()?.type, reopen()?.type]).toEqual(["button", "button"]);
  });

  it("replaces a notice and button a restored snapshot carries", () => {
    show();
    const snapshot = document.body.innerHTML;
    controller.abort();
    document.body.innerHTML = snapshot;
    controller = new AbortController();

    show();

    expect(document.querySelectorAll(".gh-prism-notice")).toHaveLength(1);
    expect(document.querySelectorAll(".gh-prism-notice-reopen")).toHaveLength(1);
  });

  it("removes the notice and button when aborted", () => {
    show();

    controller.abort();

    expect(notice()).toBeNull();
    expect(reopen()).toBeNull();
  });
});
