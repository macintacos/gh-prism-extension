// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readTeamRoster, teamRosterReader } from "../../../utils/github/team-roster";
import { routedFetch } from "../../fixtures/fetch";
import adminPage from "../../fixtures/team-roster-admin.html?raw";

const pageUrl = (n: number) =>
  `https://github.com/orgs/excessive-dev/teams/frontend/members?page=${n}`;
const ok = (text: string) => () => Promise.resolve(new Response(text));
const notFound = () => Promise.resolve(new Response("", { status: 404 }));

/** A members page as a viewer outside the team's admins gets it: no checkbox cell. */
function page(...members: (readonly [string, string?])[]): string {
  const rows = members.map(
    ([login, name]) => `
    <li class="table-list-item member-list-item">
      <div class="table-list-cell member-avatar-cell"><a data-hovercard-type="user" data-hovercard-url="/users/${login}/hovercard" href="/orgs/excessive-dev/people/${login}"><img alt="@${login}"></a></div>
      <div class="table-list-cell">
        ${name ? `<a class="f4" data-hovercard-type="user" data-hovercard-url="/users/${login}/hovercard" href="/orgs/excessive-dev/people/${login}"> ${name} </a>` : ""}
        <span class="f5 color-fg-muted" itemprop="name">${login}</span>
      </div>
    </li>`,
  );
  return `<ul class="member-listing table-list">${rows.join("")}</ul><div class="paginate-container"></div>`;
}

const readRoster = (fetchFn: typeof fetch) =>
  readTeamRoster("@excessive-dev/frontend", fetchFn, new AbortController().signal);

afterEach(() => vi.restoreAllMocks());

describe("readTeamRoster", () => {
  it("reads an admin's members page with each member's login and name", async () => {
    const fetchFn = routedFetch({ [pageUrl(1)]: ok(adminPage), [pageUrl(2)]: ok(page()) });
    const signal = new AbortController().signal;

    const roster = await readTeamRoster("@excessive-dev/frontend", fetchFn, signal);

    expect(roster).toEqual([
      { login: "ada", name: "Ada Lovelace" },
      { login: "grace", name: "Grace Hopper" },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(pageUrl(1), { signal });
  });

  it("reads a member with no display name by login alone", async () => {
    const fetchFn = routedFetch({ [pageUrl(1)]: ok(page(["linus"])), [pageUrl(2)]: ok(page()) });

    expect(await readRoster(fetchFn)).toEqual([{ login: "linus" }]);
  });

  it("reads page after page until one lists fewer members than the first", async () => {
    const fetchFn = routedFetch({
      [pageUrl(1)]: ok(page(["a", "A"], ["b"])),
      [pageUrl(2)]: ok(page(["c"], ["d"])),
      [pageUrl(3)]: ok(page(["e"])),
    });

    const roster = await readRoster(fetchFn);

    expect(roster?.map(({ login }) => login)).toEqual(["a", "b", "c", "d", "e"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("stops at a page that adds no new member, keeping each member once", async () => {
    const fetchFn = routedFetch({
      [pageUrl(1)]: ok(page(["a"], ["b"])),
      [pageUrl(2)]: ok(page(["b"], ["c"])),
      [pageUrl(3)]: ok(page(["b"], ["c"])),
    });

    const roster = await readRoster(fetchFn);

    expect(roster?.map(({ login }) => login)).toEqual(["a", "b", "c"]);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("skips a row whose login isn't one GitHub allows", async () => {
    const fetchFn = routedFetch({
      [pageUrl(1)]: ok(page(["a"], ["no good"])),
      [pageUrl(2)]: ok(page()),
    });

    const roster = await readRoster(fetchFn);

    expect(roster?.map(({ login }) => login)).toEqual(["a"]);
  });

  it("reads nothing, quietly, from a team the viewer can't see", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await readRoster(routedFetch({ [pageUrl(1)]: notFound }))).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads nothing and warns once when the first page lists no members", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await readRoster(routedFetch({ [pageUrl(1)]: ok("<main></main>") }))).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads nothing when a later page fails", async () => {
    const fetchFn = routedFetch({ [pageUrl(1)]: ok(page(["a"])), [pageUrl(2)]: notFound });

    expect(await readRoster(fetchFn)).toBeUndefined();
  });

  it("reads nothing for a token that isn't a team", async () => {
    const fetchFn = routedFetch({});

    expect(await readTeamRoster("@octocat", fetchFn, new AbortController().signal)).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("teamRosterReader", () => {
  it("reads a team once however its token is cased", async () => {
    const fetchFn = vi.fn(async () => new Response(page(["a"])));
    const firstPage = "https://github.com/orgs/O/teams/Team/members?page=1";
    const teamRoster = teamRosterReader(fetchFn, new AbortController().signal);

    const [first, second] = await Promise.all([teamRoster("@O/Team"), teamRoster("@o/team")]);

    expect(second).toBe(first);
    expect(fetchFn.mock.calls.filter((call: unknown[]) => call[0] === firstPage)).toHaveLength(1);
  });
});
