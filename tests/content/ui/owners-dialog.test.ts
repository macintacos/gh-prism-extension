// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OwnerFilter, openOwnersDialog } from "../../../entrypoints/content/ui/owners-dialog";
import type { TeamAvatarOf, TeamMembers, TeamMembersOf } from "../../../utils/github/code-owners";
import type { TeamMember, TeamRosterOf } from "../../../utils/github/team-roster";

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
    teamRoster = async () => undefined,
    filter,
    owner,
  }: {
    teams?: string[];
    summary?: Node[];
    teamAvatar?: TeamAvatarOf;
    teamRoster?: TeamRosterOf;
    filter?: OwnerFilter;
    owner?: string;
  } = {},
) {
  const returnFocus = vi.fn();
  const reads = { summary, teams, teamMembers, teamAvatar, teamRoster, filter };
  const rest = { ...reads, returnFocus, signal: controller.signal };
  openOwnersDialog(
    document,
    owner === undefined ? { ...rest, title: "Code owners of engine.rs" } : { ...rest, owner },
  );
  return { returnFocus };
}

/** `n` placeholder logins, `member-01` on. */
const logins = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `member-${String(i + from).padStart(2, "0")}`);
/** A team of `total` whose JSON lists its first `listed`. */
const team = (total: number, listed = total): TeamMembers => ({
  total,
  members: logins(Math.min(listed, total)),
});
const showAll = () =>
  dialog()?.querySelector<HTMLButtonElement>("button.gh-prism-show-all") ?? null;
const searchToggle = () =>
  dialog()?.querySelector<HTMLButtonElement>('button[aria-label^="Filter members"]') ?? null;
const searchBox = () => dialog()?.querySelector<HTMLInputElement>("input") ?? null;
const memberText = (box = boxes()[0]) => members(box).map((member) => member.textContent);
const typeQuery = (query: string) => {
  const input = searchBox() as HTMLInputElement;
  input.value = query;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const escapeIn = (target: Element) => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

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

  it("lists every member of a team of six by avatar and login, linking each profile", async () => {
    open(answering(team(6)));
    await vi.waitFor(() => expect(members(boxes()[0])).toHaveLength(6));

    expect(
      members(boxes()[0]).map((member) => [
        member.textContent,
        member.querySelector("a")?.getAttribute("href"),
      ]),
    ).toEqual(logins(6).map((login) => [login, `https://github.com/${login}`]));
    expect(showAll()).toBeNull();
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

describe("a team's members in the dialog", () => {
  const roster = (n: number): TeamMember[] =>
    logins(n).map((login, i) => ({ login, name: `Person ${i + 1}` }));
  const answeringRoster =
    (answer: readonly TeamMember[] | undefined): TeamRosterOf =>
    async () =>
      answer;

  it("lists the first five of a team of seven, then a button to show all", async () => {
    open(answering(team(7)));
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    expect(memberText()).toEqual(logins(5));
    expect(showAll()?.textContent).toBe("Show all members");
    expect(showAll()?.closest("ul")).toBe(boxes()[0]?.querySelector("ul"));
  });

  it("shows every member GitHub listed at once on Show all, focusing the sixth", async () => {
    open(answering(team(7)), { teamRoster: () => new Promise(() => {}) });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    showAll()?.click();

    expect(memberText()).toEqual(logins(7));
    expect(boxes()[0]?.querySelector("li.gh-prism-members-status")).toBeNull();
    expect(document.activeElement).toBe(members(boxes()[0])[5]?.querySelector("a"));
  });

  const entering = (box = boxes()[0]) =>
    members(box)
      .filter((member) => member.classList.contains("gh-prism-member-enter"))
      .map((member) => member.querySelector(".gh-prism-member-login")?.textContent);

  it("marks only the rows Show all reveals to enter", async () => {
    open(answering(team(7)), { teamRoster: () => new Promise(() => {}) });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());
    expect(entering()).toEqual([]);

    showAll()?.click();

    expect(entering()).toEqual(logins(2, 6));
  });

  it("marks only the rows past those already shown to enter once the roster lands", async () => {
    let land: (roster: readonly TeamMember[]) => void = () => {};
    open(answering(team(9, 7)), {
      teamRoster: () => new Promise((resolve) => (land = resolve)),
    });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());
    showAll()?.click();

    land(roster(9));

    await vi.waitFor(() => expect(entering()).toEqual(logins(2, 8)));
  });

  it("marks no row to enter when a search shows them", async () => {
    open(answering(team(7)), { teamRoster: answeringRoster(roster(7)) });
    await vi.waitFor(() => expect(searchToggle()).not.toBeNull());
    searchToggle()?.click();
    await vi.waitFor(() => expect(searchBox()).not.toBeNull());

    typeQuery("member-0");

    await vi.waitFor(() => expect(memberText()).toHaveLength(7));
    expect(entering()).toEqual([]);
  });

  it("names every member GitHub listed once the roster lands after Show all", async () => {
    open(answering(team(7)), { teamRoster: answeringRoster(roster(7)) });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    showAll()?.click();

    await vi.waitFor(() => expect(memberText()[6]).toBe("member-07 Person 7"));
  });

  it("links the team page after a roster shorter than the team", async () => {
    open(answering(team(30, 20)), { teamRoster: answeringRoster(roster(25)) });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    showAll()?.click();

    await vi.waitFor(() => expect(members(boxes()[0])).toHaveLength(25));
    expect(links().some((link) => link.textContent === "See all 30 members")).toBe(true);
  });

  it("keeps focus on Show all when the roster lands", async () => {
    let land: (roster: TeamMember[]) => void = () => {};
    open(answering(team(8)), { teamRoster: () => new Promise((resolve) => (land = resolve)) });
    await vi.waitFor(() => expect(searchToggle()).not.toBeNull());
    searchToggle()?.click();
    showAll()?.focus();

    land(roster(8));

    await vi.waitFor(() => expect(memberText()[0]).toBe("member-01 Person 1"));
    expect(document.activeElement).toBe(showAll());
  });

  it("leaves focus in another team's box when this one's roster lands", async () => {
    let land: (roster: TeamMember[]) => void = () => {};
    open(answering(team(8)), {
      teams: ["@o/web", "@o/api"],
      teamRoster: async (token) =>
        token === "@o/api" ? new Promise((resolve) => (land = resolve)) : undefined,
    });
    await vi.waitFor(() =>
      expect(boxes()[1]?.querySelector("button[aria-expanded]")).not.toBeNull(),
    );
    boxes()[1]?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click();
    const webMember = members(boxes()[0])[0]?.querySelector("a");
    webMember?.focus();

    land(roster(8));

    await vi.waitFor(() => expect(memberText(boxes()[1])[0]).toBe("member-01 Person 1"));
    expect(document.activeElement).toBe(webMember);
  });

  it("shows the roster's members with their names once it lands after Show all", async () => {
    open(answering(team(30, 20)), { teamRoster: answeringRoster(roster(30)) });
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    showAll()?.click();

    await vi.waitFor(() => expect(members(boxes()[0])).toHaveLength(30));
    expect(memberText()[0]).toBe("member-01 Person 1");
    expect(members(boxes()[0])[0]?.querySelector(".gh-prism-member-name")?.textContent).toBe(
      "Person 1",
    );
  });

  it("holds the rest's loading line back 150 ms while the roster loads", async () => {
    vi.useFakeTimers();
    try {
      open(answering(team(30, 20)), { teamRoster: () => new Promise(() => {}) });
      await vi.waitFor(() => expect(showAll()).not.toBeNull());

      showAll()?.click();

      expect(memberText()).toEqual(logins(20));
      const loading = boxes()[0]?.querySelector("li.gh-prism-members-status");
      expect(loading?.textContent).toBe("");
      vi.advanceTimersByTime(150);
      expect(loading?.textContent).toBe("Loading 10 more members…");
    } finally {
      vi.useRealTimers();
    }
  });

  it("links the team page for the rest when the roster can't be read", async () => {
    open(answering(team(30, 20)));
    await vi.waitFor(() => expect(showAll()).not.toBeNull());

    showAll()?.click();

    await vi.waitFor(() =>
      expect(links().find((link) => link.textContent === "See all 30 members")?.href).toBe(
        "https://github.com/orgs/o/teams/team",
      ),
    );
    expect(memberText()).toEqual(logins(20));
  });
});

describe("filtering a team's members in the dialog", () => {
  const named: TeamMember[] = [
    ...logins(6).map((login) => ({ login })),
    { login: "ada", name: "Ada Lovelace" },
  ];

  async function openSearch(teamRoster: TeamRosterOf = async () => named) {
    open(answering({ total: 8, members: named.map(({ login }) => login) }), { teamRoster });
    await vi.waitFor(() => expect(searchToggle()).not.toBeNull());
    searchToggle()?.click();
  }

  it("matches by display name a member of a team GitHub listed whole", async () => {
    const whole = [...named, { login: "grace", name: "Grace Hopper" }];
    open(answering({ total: 8, members: whole.map(({ login }) => login) }), {
      teamRoster: async () => whole,
    });
    await vi.waitFor(() => expect(searchToggle()).not.toBeNull());
    searchToggle()?.click();

    typeQuery("hopper");

    await vi.waitFor(() => expect(memberText()).toEqual(["grace Grace Hopper"]));
  });

  it("names each team's toggle by its team", async () => {
    await openSearch();

    expect(searchToggle()?.getAttribute("aria-label")).toBe("Filter members of o/team");
    expect(searchToggle()?.dataset.tooltip).toBe("Filter members of o/team");
  });

  it("announces when no member matches", async () => {
    await openSearch();

    typeQuery("zzz");

    const said = [...(boxes()[0]?.querySelectorAll('[role="status"]') ?? [])].map(
      (status) => status.textContent,
    );
    expect(said).toContain("No members match “zzz”.");
  });

  it("announces that it matches logins alone when the roster can't be read", async () => {
    await openSearch(async () => undefined);

    await vi.waitFor(() =>
      expect(
        [...(boxes()[0]?.querySelectorAll('[role="status"]') ?? [])].some((status) =>
          status.textContent?.startsWith("Couldn't read every member's name"),
        ),
      ).toBe(true),
    );
  });

  it("offers no member filter for a team of six", async () => {
    open(answering(team(6)));
    await vi.waitFor(() => expect(members(boxes()[0])).toHaveLength(6));

    expect(searchToggle()).toBeNull();
  });

  it("shows a focused search box, naming its team, from the toggle", async () => {
    await openSearch();

    expect(searchToggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(searchToggle()?.getAttribute("aria-controls")).toBe(searchBox()?.id);
    expect(searchBox()?.getAttribute("aria-label")).toBe("Filter members of o/team");
    expect(document.activeElement).toBe(searchBox());
  });

  it("matches members by login, ignoring case", async () => {
    await openSearch();

    typeQuery("MEMBER-0");

    expect(memberText()).toEqual(logins(6));
    expect(showAll()).toBeNull();
  });

  it("matches members by display name once the roster lands", async () => {
    await openSearch();

    typeQuery("lovelace");

    await vi.waitFor(() => expect(memberText()).toEqual(["ada Ada Lovelace"]));
  });

  it("says when no member matches", async () => {
    await openSearch();

    typeQuery("zzz");

    expect(boxes()[0]?.textContent).toContain("No members match “zzz”.");
  });

  it("says it matches logins alone when the roster can't be read", async () => {
    await openSearch(async () => undefined);

    typeQuery("ada");

    await vi.waitFor(() =>
      expect(boxes()[0]?.textContent).toContain(
        "Couldn't read every member's name. Showing matches among the first 7.",
      ),
    );
    expect(memberText()).toEqual(["ada"]);
  });

  it("clears a non-empty box on Escape, keeping the dialog open", async () => {
    await openSearch();
    typeQuery("ada");

    const event = escapeIn(searchBox() as HTMLInputElement);

    expect(event.defaultPrevented).toBe(true);
    expect(searchBox()?.value).toBe("");
    expect(dialog()).not.toBeNull();
  });

  it("leaves Escape in an empty box to the dialog", async () => {
    await openSearch();

    const event = escapeIn(searchBox() as HTMLInputElement);

    expect(event.defaultPrevented).toBe(false);
  });

  it("hides the box and restores the collapsed list from the toggle again", async () => {
    await openSearch();
    typeQuery("ada");

    searchToggle()?.click();

    expect(searchBox()?.closest("[hidden]")).not.toBeNull();
    expect(searchToggle()?.getAttribute("aria-expanded")).toBe("false");
    expect(memberText()).toHaveLength(5);
    expect(showAll()).not.toBeNull();
  });
});

describe("the dialog about one code owner", () => {
  it("names itself by a heading linking that owner's page, with its avatar", () => {
    open(undefined, { owner: "@o/team" });

    const title = document.getElementById(dialog()?.getAttribute("aria-labelledby") ?? "");
    const link = title?.querySelector<HTMLAnchorElement>("a.gh-prism-owner");
    expect(title?.tagName).toBe("H2");
    expect(link?.href).toBe("https://github.com/orgs/o/teams/team");
    expect(link?.target).toBe("_blank");
    expect(link?.querySelector('.gh-prism-avatar[data-kind="team"]')).not.toBeNull();
    expect(title?.textContent).toBe("o/team");
  });
});
