/**
 * A team's whole roster, logins and display names, read from its members page's HTML a page at a
 * time. The JSON `readTeamMembers` reads stops at about 20 logins and names no one.
 */

import { codeOwnerOf, LOGIN, oncePerTeam } from "./code-owners";

/** A team member: their login and, when they set one, their display name. */
export interface TeamMember {
  readonly login: string;
  readonly name?: string;
}

/** Reads an `@org/team` token's whole roster; `undefined` when it can't be read. Never rejects. */
export type TeamRosterOf = (team: string) => Promise<readonly TeamMember[] | undefined>;

// GitHub's markup, untrusted: read as text only. An admin's rows add a checkbox cell.
const ROW = "li.member-list-item";
const MEMBER_LINK = "a[data-hovercard-url]";
const MAX_PAGES = 20;
const HOVERCARD = /^\/users\/([^/]+)\/hovercard$/;

/**
 * `team`'s members in GitHub's order, each once, read from `<team page>/members?page=N` until a
 * page has fewer rows than the first or adds no new member, at most 20 pages. `undefined` for any other token, for a
 * team the viewer can't see, once a read fails, or when the first page lists no members; logs one
 * warning on an unexpected shape unless `signal` aborted.
 */
export async function readTeamRoster(
  team: string,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<readonly TeamMember[] | undefined> {
  const teamPage = codeOwnerOf(team).url;
  if (!team.includes("/") || !teamPage) return undefined;

  const roster = new Map<string, TeamMember>();
  try {
    let pageSize = 0;
    // ponytail: 20 pages (about 600 members) is the ceiling; past it the box links the team page.
    // Search a larger team with GitHub's server-side `?query=` instead of reading it whole.
    for (let n = 1; n <= MAX_PAGES; n++) {
      const url = `${teamPage}/members?page=${n}`;
      const response = await fetchFn(url, { signal });
      if (!response.ok) return undefined;
      const { rows, members } = membersOf(await response.text());
      if (n === 1) {
        if (members.length === 0) throw new Error(`${url} lists no members`);
        pageSize = rows;
      }
      const before = roster.size;
      for (const member of members) if (!roster.has(member.login)) roster.set(member.login, member);
      if (rows < pageSize || roster.size === before) return [...roster.values()];
    }
    return undefined;
  } catch (error) {
    if (!signal.aborted) console.warn(`gh-prism: couldn't read ${team}'s roster`, error);
    return undefined;
  }
}

/**
 * A members page's row count, and the members its rows list, skipping a row with no valid login. A
 * name that only repeats the login is no name.
 */
function membersOf(html: string): { rows: number; members: TeamMember[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const rows = [...doc.querySelectorAll(ROW)];
  const members = rows.flatMap((row): TeamMember[] => {
    const links = [...row.querySelectorAll(MEMBER_LINK)];
    const login = HOVERCARD.exec(links[0]?.getAttribute("data-hovercard-url") ?? "")?.[1];
    if (login === undefined || !LOGIN.test(login)) return [];
    const name = links.map((link) => link.textContent?.trim()).find(Boolean);
    return [name && name.toLowerCase() !== login.toLowerCase() ? { login, name } : { login }];
  });
  return { rows: rows.length, members };
}

/**
 * `readTeamRoster` through `fetchFn` until `signal` aborts, asking each team at most once,
 * ignoring case. A read that fails stays failed for the visit.
 */
export function teamRosterReader(fetchFn: typeof fetch, signal: AbortSignal): TeamRosterOf {
  return oncePerTeam((team) => readTeamRoster(team, fetchFn, signal));
}
