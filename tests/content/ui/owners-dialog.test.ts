// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OwnerFilter, openOwnersDialog } from "../../../entrypoints/content/ui/owners-dialog";
import type { TeamAvatarOf, TeamMembers, TeamMembersOf } from "../../../utils/github/code-owners";
import large from "../../fixtures/team-members-large.json?raw";

// happy-dom has no Popover API.
HTMLElement.prototype.showPopover = () => {};
HTMLElement.prototype.hidePopover = () => {};

let controller: AbortController;

const dialog = () => document.querySelector<HTMLDialogElement>("dialog.gh-prism-owners-dialog");
const links = () => [...(dialog()?.querySelectorAll("a") ?? [])];
const boxes = () => [...(dialog()?.querySelectorAll("section") ?? [])];
const members = (box: Element | undefined) => [
  ...(box?.querySelectorAll<HTMLElement>("li.gh-prism-member") ?? []),
];
/** The member count in `box`'s header, beside its team's heading. */
const countOf = (box: Element | undefined) =>
  box?.querySelector("div:has(> h3) + span")?.textContent;

/** Opens the dialog excerpting `teams`, each team's members read through `teamMembers`. */
function open(
  teamMembers: TeamMembersOf = async () => undefined,
  {
    teams = ["@o/team"],
    summary = [document.createTextNode("summary")],
    teamAvatar = async () => undefined,
    filter,
    owner,
  }: {
    teams?: string[];
    summary?: Node[];
    teamAvatar?: TeamAvatarOf;
    filter?: OwnerFilter;
    owner?: string;
  } = {},
) {
  const returnFocus = vi.fn();
  openOwnersDialog(document, {
    title: "Code owners of engine.rs",
    summary,
    teams,
    teamMembers,
    teamAvatar,
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

  it("boxes each team under a header naming it, its avatar and name linking its team page", async () => {
    const teamAvatar = vi.fn(async () => "https://avatars.githubusercontent.com/t/7?s=32&v=4");

    open(answering({ total: 3, members: ["a", "b", "c"] }), {
      teams: ["@o/a", "@o/b"],
      teamAvatar,
    });
    await vi.waitFor(() => expect(countOf(boxes()[1])).toBe("3 members"));

    expect(boxes().map((box) => box.querySelector("h3")?.textContent)).toEqual(["o/a", "o/b"]);
    expect(boxes()[0]?.querySelector("h3 a.gh-prism-owner")?.getAttribute("href")).toBe(
      "https://github.com/orgs/o/teams/a",
    );
    expect(teamAvatar.mock.calls).toEqual([["@o/a"], ["@o/b"]]);
  });

  it("counts a team of one as one member", async () => {
    open(answering({ total: 1, members: ["a"] }));

    await vi.waitFor(() => expect(countOf(boxes()[0])).toBe("1 member"));
  });

  it("lists the first 15 of a large team's members by avatar and login, then links the rest", async () => {
    open(answering(JSON.parse(large)));
    await vi.waitFor(() => expect(members(boxes()[0]).length).toBeGreaterThan(0));

    expect(
      members(boxes()[0]).map((member) => [
        member.textContent,
        member.querySelector("a")?.getAttribute("href"),
      ]),
    ).toEqual(
      Array.from({ length: 15 }, (_, i) => {
        const login = `member-${String(i + 1).padStart(2, "0")}`;
        return [login, `https://github.com/${login}`];
      }),
    );
    expect(countOf(boxes()[0])).toBe("214 members");
    const all = links().filter((link) => link.textContent === "See all 214 members");
    expect(all.map((link) => [link.href, link.target])).toEqual([
      ["https://github.com/orgs/o/teams/team", "_blank"],
    ]);
  });

  it("lists every member of a team within the cap, and no team page for more", async () => {
    open(answering({ total: 3, members: ["a", "b", "c"] }));
    await vi.waitFor(() => expect(members(boxes()[0])).toHaveLength(3));

    expect(members(boxes()[0]).map((member) => member.textContent)).toEqual(["a", "b", "c"]);
    expect(dialog()?.textContent).not.toContain("See all");
  });

  it.each([
    [{ total: 0, members: [] }, "This team has no members."],
    [undefined, "GitHub doesn't show you this team's members."],
  ])(
    "says so in a sentence, counting nothing, when a team's members read %j",
    async (answer, sentence) => {
      open(answering(answer));

      await vi.waitFor(() => expect(dialog()?.textContent).toContain(sentence));
      expect(countOf(boxes()[0])).toBe("");
    },
  );

  it("shows team tokens and logins as text, never markup", async () => {
    open(answering({ total: 1, members: ["<b>x</b>"] }), {
      teams: ["@o/<b>t</b>"],
    });
    await vi.waitFor(() => expect(dialog()?.textContent).toContain("<b>x</b>"));

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

describe("the owner filter in the dialog", () => {
  const FILES = "https://github.com/o/r/pull/1/files";
  /** Links to `FILES` filtered to each token. */
  const filtering = () => {
    const navigate = vi.fn();
    const filter: OwnerFilter = {
      linkOf: (token) => ({
        href: `${FILES}?gh-prism-owner=${token.replace(/^@/, "")}`,
        shown: false,
      }),
      navigate,
    };
    return { filter, navigate };
  };
  const actions = () => [
    ...(dialog()?.querySelectorAll<HTMLAnchorElement>("a.gh-prism-owner-filter") ?? []),
  ];
  const footer = () => dialog()?.querySelector(".gh-prism-owners-dialog-footer");
  const filterIn = (box: Element | undefined) =>
    box?.querySelector<HTMLElement>("a.gh-prism-owner-filter-icon");

  it("shows only each team's files from the filter icon after its name", () => {
    open(undefined, { teams: ["@o/a", "@o/b"], filter: filtering().filter });

    expect(boxes().map((box) => filterIn(box)?.getAttribute("href"))).toEqual([
      `${FILES}?gh-prism-owner=o/a`,
      `${FILES}?gh-prism-owner=o/b`,
    ]);
    expect(actions()).toEqual([]);
  });

  it("offers its own code owner's files once, in its footer, with no filter icon in that team's box", () => {
    open(undefined, { teams: ["@o/a", "@o/b"], filter: filtering().filter, owner: "@O/A" });

    expect(boxes().map((box) => filterIn(box)?.tagName)).toEqual([undefined, "A"]);
    expect(actions().map((a) => [a.parentElement, a.href])).toEqual([
      [footer(), `${FILES}?gh-prism-owner=O/A`],
    ]);
  });

  it("loads its footer action as a new page on a plain click", () => {
    const { filter, navigate } = filtering();
    open(undefined, { filter, owner: "@o/team" });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    actions()[0]?.dispatchEvent(click);

    expect(navigate).toHaveBeenCalledWith(`${FILES}?gh-prism-owner=o/team`);
    expect(click.defaultPrevented).toBe(true);
  });

  it("offers nothing, its footer holding only the mark, where the page has no owner filter", () => {
    open(undefined, { owner: "@o/team" });

    expect(actions()).toEqual([]);
    expect(dialog()?.querySelector("a.gh-prism-owner-filter-icon")).toBeNull();
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
