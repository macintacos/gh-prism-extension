// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openOwnersDialog } from "../../../entrypoints/content/ui/owners-dialog";
import type { TeamMembers, TeamMembersOf } from "../../../utils/github/code-owners";
import large from "../../fixtures/team-members-large.json?raw";

let controller: AbortController;

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
const links = () => [...(dialog()?.querySelectorAll("a") ?? [])];
const memberLinks = () => links().filter((link) => link.textContent?.startsWith("@member-"));

/** Opens the dialog excerpting `teams`, each team's members read through `members`. */
function open(
  members: TeamMembersOf = async () => undefined,
  {
    teams = ["@o/team"],
    summary = [document.createTextNode("summary")],
  }: { teams?: string[]; summary?: Node[] } = {},
) {
  const returnFocus = vi.fn();
  openOwnersDialog(document, {
    title: "Code owners of engine.rs",
    summary,
    teams,
    members,
    returnFocus,
    signal: controller.signal,
  });
  return { returnFocus };
}

const answering =
  (answer: TeamMembers | undefined): TeamMembersOf =>
  async () =>
    answer;

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  controller = new AbortController();
});

afterEach(() => controller.abort());

describe("openOwnersDialog", () => {
  it("opens one dialog its heading names, with the summary after the heading", () => {
    const summary = document.createElement("ul");

    open(undefined, { summary: [summary] });

    expect(document.querySelectorAll("dialog.gh-prism-owners-dialog")).toHaveLength(1);
    expect(dialog()?.parentElement).toBe(document.body);
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    expect(dialog()?.open).toBe(true);
    const title = document.getElementById(dialog()?.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("Code owners of engine.rs");
    expect(dialog()?.contains(title)).toBe(true);
    expect(dialog()?.contains(summary)).toBe(true);
    expect(
      (title?.compareDocumentPosition(summary) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("links the first 15 of a large team's members, then the team page for the rest", async () => {
    open(answering(JSON.parse(large)));
    await vi.waitFor(() => expect(memberLinks().length).toBeGreaterThan(0));

    expect(
      memberLinks().map((link) => [link.textContent, link.href, link.target, link.rel]),
    ).toEqual(
      Array.from({ length: 15 }, (_, i) => {
        const login = `member-${String(i + 1).padStart(2, "0")}`;
        return [`@${login}`, `https://github.com/${login}`, "_blank", "noopener noreferrer"];
      }),
    );
    const all = links().filter((link) => link.textContent === "See all 214 members");
    expect(all.map((link) => link.href)).toEqual(["https://github.com/orgs/o/teams/team"]);
  });

  it("links every member of a team within the cap, and no team page for more", async () => {
    open(answering({ total: 3, members: ["a", "b", "c"] }));
    await vi.waitFor(() => expect(links().some((link) => link.textContent === "@a")).toBe(true));

    expect(links().map((link) => link.textContent)).toEqual(["@o/team", "@a", "@b", "@c"]);
  });

  it.each([
    [{ total: 0, members: [] }, "This team has no members."],
    [undefined, "GitHub doesn't show you this team's members."],
  ])("says so in a sentence when a team's members read %j", async (answer, sentence) => {
    open(answering(answer));

    await vi.waitFor(() => expect(dialog()?.textContent).toContain(sentence));
  });

  it("shows team tokens and logins as text, never markup", async () => {
    open(answering({ total: 1, members: ["<b>x</b>"] }), { teams: ["@o/<b>t</b>"] });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("@<b>x</b>"));

    expect(dialog()?.textContent).toContain("@o/<b>t</b>");
    expect(dialog()?.querySelector("b")).toBeNull();
  });

  it("reads each team's members once, in order", () => {
    const members = vi.fn(async () => undefined);

    open(members, { teams: ["@o/a", "@o/b"] });

    expect(members.mock.calls).toEqual([["@o/a"], ["@o/b"]]);
  });

  it("goes, handing focus back, on its close button", () => {
    const { returnFocus } = open();

    dialog()?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click();

    expect(dialog()).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
    expect(returnFocus).toHaveBeenCalledOnce();
  });

  it("goes when its page does", () => {
    open();

    controller.abort();

    expect(dialog()).toBeNull();
    expect(document.head.querySelector("style")).toBeNull();
  });
});
