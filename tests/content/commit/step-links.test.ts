// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showStepLinks } from "../../../entrypoints/content/commit/step-links";
import type { NextCommit } from "../../../utils/github/next-commit";
import type { CommitHead } from "../../../utils/github/pr-ref";
import { foundPage, loadCommitFixture, loadFixture } from "../../fixtures/files-page";

const commit: CommitHead = { kind: "commit", owner: "cli", repo: "cli", headSha: "189706b" };
const PARENT = "9eb4db2ba89017ea9dbcaed4f712dc4881f7f37b";

const previous = () => document.querySelector<HTMLAnchorElement>(".gh-prism-commit-previous");
const next = () => document.querySelector<HTMLAnchorElement>(".gh-prism-commit-next");
const parentsRow = () => document.querySelector('[class*="commitBranchContainer__"] > pre');
// Runs the microtasks a settled read's handlers wait on.
const settled = () => new Promise((resolve) => setTimeout(resolve));

/** Whether `link` reads as a disabled link that keyboard focus still reaches, with no target. */
const heldOff = (link: HTMLAnchorElement | null) =>
  link?.getAttribute("aria-disabled") === "true" &&
  link.getAttribute("role") === "link" &&
  link.tabIndex === 0 &&
  !link.hasAttribute("href");

let controller: AbortController;
let sawParent: (parent: string) => void;
const show = (read: Promise<NextCommit | undefined>) =>
  showStepLinks(foundPage(), controller.signal, { commit, next: read, sawParent });

beforeEach(() => {
  controller = new AbortController();
  sawParent = vi.fn();
  loadCommitFixture("sha");
});

describe("showStepLinks", () => {
  it("adds Older and Newer after GitHub's copy button, in the row naming the parent", () => {
    show(new Promise(() => {}));

    const steps = parentsRow()?.lastElementChild;
    expect(steps?.contains(previous())).toBe(true);
    expect(steps?.contains(next())).toBe(true);
    expect(previous()?.compareDocumentPosition(next() as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("links Older to the commit's first parent, named by its short SHA", () => {
    show(new Promise(() => {}));

    expect(previous()?.getAttribute("href")).toBe(`/cli/cli/commit/${PARENT}`);
    expect(previous()?.getAttribute("aria-label")).toMatch(/^Older commit\b.*\b9eb4db2$/);
    expect(sawParent).toHaveBeenCalledWith(PARENT);
  });

  it("holds Older off on a root commit, saying it is the first", () => {
    const row = parentsRow();
    if (!row) throw new Error("fixture has no parents row");
    row.innerHTML = '0 parents <!-- --> commit <span class="fgColor-default">553c207</span>';

    show(new Promise(() => {}));

    expect(heldOff(previous())).toBe(true);
    expect(previous()?.getAttribute("aria-label")).toMatch(/^Older commit\b.*\bfirst\b/);
    expect(sawParent).not.toHaveBeenCalled();
  });

  it("holds Newer off while its read is out, then links it to the commit that follows", async () => {
    let land: (next: NextCommit) => void = () => {};
    show(new Promise((resolve) => (land = resolve)));

    expect(heldOff(next())).toBe(true);

    land({ kind: "commit", sha: "0cf1092493af067646fc5f3db9421c6a6ec9c938" });
    await settled();

    expect(heldOff(next())).toBe(false);
    expect(next()?.getAttribute("href")).toBe(
      "/cli/cli/commit/0cf1092493af067646fc5f3db9421c6a6ec9c938",
    );
    expect(next()?.getAttribute("aria-label")).toMatch(/^Newer commit\b.*\b0cf1092$/);
  });

  it("holds Newer off at a branch's newest commit, naming the branch", async () => {
    show(Promise.resolve({ kind: "newest", branch: "attester/multi-tenant" }));
    await settled();

    expect(heldOff(next())).toBe(true);
    expect(next()?.getAttribute("aria-label")).toMatch(/^Newer commit\b.*attester\/multi-tenant/);
  });

  it.each([
    ["nothing is found", { kind: "unknown" } as const],
    ["the read fails", undefined],
  ])("holds Newer off when %s", async (_, read) => {
    show(Promise.resolve(read));
    await settled();

    expect(heldOff(next())).toBe(true);
    expect(next()?.getAttribute("aria-label")).toMatch(/^Newer commit\b/);
  });

  it("takes the links away once the visit aborts, before a late read lands", async () => {
    let land: (next: NextCommit) => void = () => {};
    show(new Promise((resolve) => (land = resolve)));

    controller.abort();
    land({ kind: "commit", sha: "0cf1092" });
    await settled();

    expect(previous()).toBeNull();
    expect(next()).toBeNull();
  });

  it("adds nothing on a pull request's page", () => {
    loadFixture();

    show(Promise.resolve({ kind: "commit", sha: "0cf1092" }));

    expect(previous()).toBeNull();
    expect(next()).toBeNull();
  });
});
