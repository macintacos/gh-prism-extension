// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type NoticeChoice, showClassicNotice } from "../../../entrypoints/content/classic/notice";
import { findClassicPage } from "../../../entrypoints/content/files-page";
import { loadClassicFixture } from "../../fixtures/files-page";

const DOCS =
  "https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview";

let controller: AbortController;

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-classic-notice");
const opener = () =>
  document.querySelector<HTMLButtonElement>("button.gh-prism-classic-notice-button");
const closeButton = () => dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
const buttonNamed = (name: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find((button) => button.textContent === name);
const links = () => [...(dialog()?.querySelectorAll("a") ?? [])];
const steps = () => [...(dialog()?.querySelectorAll("ol > li") ?? [])].map((li) => li.textContent);

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
  it("opens a dialog its heading names while the choice isn't dismissed", () => {
    show();

    expect(dialog()?.open).toBe(true);
    expect(dialog()?.parentElement).toBe(document.body);
    const title = dialog()?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(title)?.closest("dialog")).toBe(dialog());
  });

  it("stays closed while the choice is dismissed", () => {
    const { save } = show(true);

    expect(dialog()?.open).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([false, true])("puts its button before the review tools, dismissed: %s", (dismissed) => {
    const { page } = show(dismissed);

    expect(opener()?.nextElementSibling).toBe(page.reviewTools);
    expect(opener()?.textContent).toMatch(/gh-prism/);
    expect(opener()?.type).toBe("button");
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

  it.each([
    ["its close button", "", () => closeButton()?.click()],
    ["Not now", "", () => buttonNamed("Not now")?.click()],
    ["Got it", "octocat", () => buttonNamed("Got it")?.click()],
    // happy-dom implements neither; both close the dialog as close() does.
    ["Esc or a backdrop click", "", () => dialog()?.close()],
  ])("saves the dismissal on closing by %s, moving focus to the button", (_, login, close) => {
    loadClassicFixture(login);
    const { choice, save } = show();

    close();

    expect(dialog()?.open).toBe(false);
    expect(choice.dismissed).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener());
  });

  it("opens the dialog from its button without saving", () => {
    const { choice, save } = show(true);

    opener()?.click();

    expect(dialog()?.open).toBe(true);
    expect(choice.dismissed).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("opens without motion when the viewer prefers reduced motion", () => {
    preferReducedMotion("reduce");

    show();

    expect(dialog() && getComputedStyle(dialog() as HTMLDialogElement).animation).toBe("none");
  });

  it("replaces a dialog and button a restored snapshot carries", () => {
    show();
    const snapshot = document.body.innerHTML;
    controller.abort();
    document.body.innerHTML = snapshot;
    controller = new AbortController();

    show();

    expect(document.querySelectorAll(".gh-prism-classic-notice")).toHaveLength(1);
    expect(document.querySelectorAll(".gh-prism-classic-notice-button")).toHaveLength(1);
    expect(document.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
  });

  it("carries one gh-prism mark in the dialog and none on its button", () => {
    show();

    expect(dialog()?.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
    expect(opener()?.querySelector(".gh-prism-mark")).toBeNull();
  });

  it("sweeps its mark without motion when the viewer prefers reduced motion", () => {
    preferReducedMotion("reduce");

    show();

    const sweep = dialog()?.querySelector<HTMLElement>(".gh-prism-mark-sweep");
    expect(sweep && getComputedStyle(sweep).transition).toBe("none");
  });

  it("removes the dialog and button when aborted", () => {
    show();

    controller.abort();

    expect(dialog()).toBeNull();
    expect(opener()).toBeNull();
  });
});
