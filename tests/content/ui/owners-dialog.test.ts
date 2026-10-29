// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OwnerFilter, openOwnersDialog } from "../../../entrypoints/content/ui/owners-dialog";
import type { TeamMembers, TeamMembersOf } from "../../../utils/github/code-owners";
import large from "../../fixtures/team-members-large.json?raw";

let controller: AbortController;

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
const links = () => [...(dialog()?.querySelectorAll("a") ?? [])];
const memberLinks = () => links().filter((link) => link.textContent?.startsWith("@member-"));

/** Opens the dialog excerpting `teams`, each team's members read through `teamMembers`. */
function open(
  teamMembers: TeamMembersOf = async () => undefined,
  {
    teams = ["@o/team"],
    summary = [document.createTextNode("summary")],
    filter,
    owner,
  }: { teams?: string[]; summary?: Node[]; filter?: OwnerFilter; owner?: string } = {},
) {
  const returnFocus = vi.fn();
  openOwnersDialog(document, {
    title: "Code owners of engine.rs",
    summary,
    teams,
    teamMembers,
    returnFocus,
    signal: controller.signal,
    filter,
    owner,
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
    open(answering({ total: 1, members: ["<b>x</b>"] }), {
      teams: ["@o/<b>t</b>"],
    });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("@<b>x</b>"));

    expect(dialog()?.textContent).toContain("@o/<b>t</b>");
    expect(dialog()?.querySelector("b")).toBeNull();
  });

  it("reads each team's members once, in order", () => {
    const teamMembers = vi.fn(async () => undefined);

    open(teamMembers, { teams: ["@o/a", "@o/b"] });

    expect(teamMembers.mock.calls).toEqual([["@o/a"], ["@o/b"]]);
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

describe("the owner filter's actions", () => {
  const FILES = "https://github.com/o/r/pull/1/files";
  /** Links to `FILES` filtered to each token, the page's filter already naming `current`. */
  const filtering = (current?: string) => {
    const navigate = vi.fn();
    const filter: OwnerFilter = {
      linkOf: (token) =>
        token === current
          ? { href: FILES, shown: true }
          : { href: `${FILES}?gh-prism-owner=${token.replace(/^@/, "")}`, shown: false },
      navigate,
    };
    return { filter, navigate };
  };
  const actions = () => [
    ...(dialog()?.querySelectorAll<HTMLAnchorElement>("a.gh-prism-owner-filter") ?? []),
  ];
  const footer = () => dialog()?.querySelector(".gh-prism-owners-dialog-footer");

  it("offers each team block's files", () => {
    open(undefined, { teams: ["@o/a", "@o/b"], filter: filtering().filter });

    expect(
      actions().map((a) => [a.closest("section")?.querySelector("h3")?.textContent, a.href]),
    ).toEqual([
      ["@o/a", `${FILES}?gh-prism-owner=o/a`],
      ["@o/b", `${FILES}?gh-prism-owner=o/b`],
    ]);
    expect(actions()[0]?.textContent).toBe("Show only their files");
  });

  it("offers its own code owner's files once, in its footer", () => {
    open(undefined, { teams: ["@o/a", "@o/b"], filter: filtering().filter, owner: "@O/A" });

    expect(
      actions().map((a) => [a.closest("section, .gh-prism-owners-dialog-footer"), a.href]),
    ).toEqual([
      [dialog()?.querySelectorAll("section")[1], `${FILES}?gh-prism-owner=o/b`],
      [footer(), `${FILES}?gh-prism-owner=O/A`],
    ]);
  });

  it("switches to showing all files for the code owner the page already filters by", () => {
    open(undefined, { teams: ["@o/a"], filter: filtering("@o/a").filter });

    expect(actions().map((a) => [a.textContent, a.href])).toEqual([["Show all files", FILES]]);
  });

  it("loads its link as a new page on a plain click", () => {
    const { filter, navigate } = filtering();
    open(undefined, { filter });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    actions()[0]?.dispatchEvent(click);

    expect(navigate).toHaveBeenCalledWith(`${FILES}?gh-prism-owner=o/team`);
    expect(click.defaultPrevented).toBe(true);
  });

  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "leaves a click with %s to the browser",
    (modifier) => {
      const { filter, navigate } = filtering();
      open(undefined, { filter });

      const click = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
      actions()[0]?.dispatchEvent(click);

      expect(navigate).not.toHaveBeenCalled();
      expect(click.defaultPrevented).toBe(false);
    },
  );

  it("offers nothing, its footer holding only the mark, where the page has no owner filter", () => {
    open(undefined, { owner: "@o/team" });

    expect(actions()).toEqual([]);
    expect([...(footer()?.children ?? [])].map((child) => child.className)).toEqual([
      "gh-prism-mark",
    ]);
  });

  it.each([
    ["with", true],
    ["without", false],
  ])("carries one gh-prism mark %s an owner filter", (_, filtered) => {
    open(undefined, { owner: "@o/team", filter: filtered ? filtering().filter : undefined });

    expect(dialog()?.querySelectorAll(".gh-prism-mark")).toHaveLength(1);
  });
});
