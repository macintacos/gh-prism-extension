// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { describeListing, describePullRequest } from "@/entrypoints/content/sidebar/owners-popover";
import type { OwnerIdentities } from "@/entrypoints/content/ui/owner-identity";
import { codeOwnerOf, type PrCodeOwners, type PrReviewer } from "@/utils/github/code-owners";
import { outline } from "../../fixtures/file-list";

const file = (path: string, ...tokens: string[]) => ({
  path: `src/${path}`,
  owners: tokens.map(codeOwnerOf),
});

const PLAIN: OwnerIdentities = { teamAvatar: async () => undefined };

const listOf = (files: ReturnType<typeof file>[], identities = PLAIN) =>
  describeListing(document, { folder: "src/", files }, identities).list;

const headings = (list: Element) => [...list.querySelectorAll("h3")];

describe("a folder's list", () => {
  it("names a set its files share once, above all of them", () => {
    const files = [file("a.ts", "@o/team"), file("b.ts", "@o/team")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["Owned by o/team", "  a.ts", "  b.ts"]);
    expect(headings(list)).toHaveLength(1);
  });

  it("groups files by owner set, in the order of each set's first file", () => {
    const files = [file("a.ts", "@o/x"), file("b.ts", "@o/y"), file("c.ts", "@o/x")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["Owned by o/x", "  a.ts", "  c.ts", "Owned by o/y", "  b.ts"]);
  });

  it("groups owners regardless of order or case, headed as the first file lists them", () => {
    const files = [file("a.ts", "@a", "@b"), file("b.ts", "@b", "@a"), file("c.ts", "@B", "@A")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["Owned by a, b", "  a.ts", "  b.ts", "  c.ts"]);
  });

  it("keeps overlapping sets apart", () => {
    const files = [file("a.ts", "@a"), file("b.ts", "@a", "@b")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["Owned by a", "  a.ts", "Owned by a, b", "  b.ts"]);
  });

  it("lists files without a code owner last, under a heading with no owners", () => {
    const files = [file("a.ts"), file("b.ts", "@o/x")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["Owned by o/x", "  b.ts", "No code owner", "  a.ts"]);
    expect(
      headings(list).map((heading) => heading.querySelector(".gh-prism-owner-name")?.textContent),
    ).toEqual(["o/x", undefined]);
    expect(headings(list)[1]?.querySelector("a")).toBeNull();
  });

  it("heads each set with its owners' linked avatars and names, each followed by a filter icon showing their files", () => {
    const files = [file("a.ts", "@o/x", "@someone")];
    const filter = {
      linkOf: (token: string) => ({ href: `https://x.test/${token}`, shown: false }),
      navigate: () => {},
    };

    const list = listOf(files, { ...PLAIN, filter });

    const [heading] = headings(list);
    expect(
      [...(heading?.querySelectorAll("a") ?? [])].map((link) => link.getAttribute("href")),
    ).toEqual([
      "https://github.com/orgs/o/teams/x",
      "https://x.test/@o/x",
      "https://github.com/someone",
      "https://x.test/@someone",
    ]);
  });

  it("lays each group's files out as a tree of muted subfolders", () => {
    const files = [file("a/b/c.ts", "@o/x"), file("a/d.ts", "@o/x"), file("e.ts", "@o/y")];

    const list = listOf(files);

    expect(outline(list)).toEqual([
      "Owned by o/x",
      "  a/",
      "    b/",
      "      c.ts",
      "    d.ts",
      "Owned by o/y",
      "  e.ts",
    ]);
    expect(
      [...list.querySelectorAll(".tw\\:font-mono.tw\\:text-fg-muted")].map(
        (folder) => folder.textContent,
      ),
    ).toEqual(["a/", "b/"]);
  });

  it("groups a 3,000-file folder into its four sets", () => {
    const sets = [["@o/a"], ["@o/b"], ["@o/a", "@o/b"], []];
    const files = Array.from({ length: 3000 }, (_, i) => file(`f${i}.ts`, ...(sets[i % 4] ?? [])));

    const list = listOf(files);

    expect(headings(list).map((heading) => heading.textContent)).toEqual([
      "Owned by o/a",
      "Owned by o/b",
      "Owned by o/a, o/b",
      "No code owner",
    ]);
    expect(headings(list).map((heading) => heading.nextElementSibling?.children.length)).toEqual([
      750, 750, 750, 750,
    ]);
  });
});

describe("the whole pull request's list", () => {
  const changed = (...files: ReturnType<typeof file>[]): PrCodeOwners =>
    new Map(files.map(({ path, owners }) => [path, { owners, ownedByViewer: false }]));
  const reviewer = (token: string, ...teams: string[]): PrReviewer => ({
    token,
    teams,
    codeOwner: false,
  });
  const describeOf = (codeOwners: PrCodeOwners, prReviewers: readonly PrReviewer[] | undefined) =>
    describePullRequest(document, { codeOwners, prReviewers }, PLAIN);
  const listIn = (summary: readonly Node[]) => {
    const list = summary.find((node) => node instanceof HTMLUListElement);
    if (list === undefined) throw new Error("The summary holds no list");
    return list;
  };
  const tagged = (summary: readonly Node[]) =>
    headings(listIn(summary))
      .filter((heading) => heading.querySelector("[data-unreviewed]"))
      .map((heading) => heading.nextElementSibling?.textContent);
  const callOut = (summary: readonly Node[]) =>
    summary.find((node) => node instanceof HTMLParagraphElement)?.textContent;

  const codeOwners = changed(
    file("web/a.ts", "@o/web"),
    file("README.md"),
    file("infra/main.tf", "@ada"),
    file("web/b.ts", "@o/web"),
    file("docs/guide.md", "@o/docs", "@ada"),
  );

  it("groups every changed file by owner set, by full path, with no code owner last", () => {
    const { summary } = describeOf(codeOwners, undefined);

    expect(outline(listIn(summary))).toEqual([
      "Owned by o/web",
      "  src/web/",
      "    a.ts",
      "    b.ts",
      "Owned by ada",
      "  src/infra/",
      "    main.tf",
      "Owned by o/docs, ada",
      "  src/docs/",
      "    guide.md",
      "No code owner",
      "  src/",
      "    README.md",
    ]);
  });

  it("marks an owner who reviews, and a team a reviewer reviews for, in the heading's name", () => {
    const { summary } = describeOf(codeOwners, [reviewer("@ada"), reviewer("@grace", "@o/web")]);

    const [web, ada, docs] = headings(listIn(summary));

    expect(web?.querySelectorAll("[data-reviewing]")).toHaveLength(1);
    expect(ada?.querySelectorAll("[data-reviewing]")).toHaveLength(1);
    expect(docs?.querySelectorAll("[data-reviewing]")).toHaveLength(1);
    const marked = web?.querySelector("[data-reviewing]")?.textContent ?? "";
    expect(marked).not.toBe("");
    expect(web?.getAttribute("aria-label")).toContain(marked);
  });

  it("names who reviews for a team in the mark's words and tooltip alike", () => {
    const { summary } = describeOf(codeOwners, [reviewer("@ada"), reviewer("@grace", "@o/web")]);

    const [web, ada] = headings(listIn(summary)).map(
      (heading) => heading.querySelector<HTMLElement>("[data-reviewing]") ?? undefined,
    );

    expect(web?.textContent).toContain("grace");
    expect(ada?.textContent).not.toContain("ada");
    for (const mark of [web, ada]) {
      expect(mark?.textContent).toContain(mark?.dataset.tooltip);
      expect(mark?.dataset.tooltip).not.toMatch(/reviewed/i);
    }
  });

  it("tags and calls out the groups no current reviewer owns, never files with no code owner", () => {
    const { summary } = describeOf(codeOwners, [reviewer("@grace", "@o/docs")]);

    expect(tagged(summary)).toEqual(["src/web/a.tsb.ts", "src/infra/main.tf"]);
    expect(callOut(summary)).toMatch(/3 files/);
  });

  it("counts in the call-out exactly the files under the tagged groups", () => {
    const { summary } = describeOf(codeOwners, [reviewer("@ada")]);

    const taggedFiles = headings(listIn(summary))
      .filter((heading) => heading.querySelector("[data-unreviewed]"))
      .flatMap((heading) => [...(heading.nextElementSibling?.querySelectorAll("li") ?? [])])
      .filter((item) => item.querySelector("ul") === null);

    expect(taggedFiles.length).toBeGreaterThan(0);
    expect(callOut(summary)).toMatch(new RegExp(`^${taggedFiles.length} files? `));
  });

  it("tags every owned group when the PR has no reviewers", () => {
    const { summary } = describeOf(codeOwners, []);

    expect(tagged(summary)).toHaveLength(3);
    expect(callOut(summary)).toMatch(/4 files/);
  });

  it("words the call-out to agree with its count", () => {
    const one = describeOf(changed(file("infra/main.tf", "@ada")), []);
    const many = describeOf(codeOwners, []);

    expect(callOut(one.summary)).toMatch(/^1 file has\b.*\bits\b/);
    expect(callOut(many.summary)).toMatch(/^4 files have\b.*\btheir\b/);
  });

  it("draws no mark, tag, or call-out when the reviewers are unknown", () => {
    const { summary } = describeOf(codeOwners, undefined);

    expect(summary).toHaveLength(1);
    expect(listIn(summary).querySelector("[data-reviewing], [data-unreviewed]")).toBeNull();
  });

  it("calls nothing out when reviewers own every owned group", () => {
    const { summary } = describeOf(codeOwners, [reviewer("@ada"), reviewer("@o/web")]);

    expect(tagged(summary)).toEqual([]);
    expect(callOut(summary)).toBeUndefined();
  });

  it("is titled for the pull request, with every owning team once", () => {
    const { title, teams } = describeOf(codeOwners, []);

    expect(title).toBe("Code owners of this pull request");
    expect(teams).toEqual(["@o/web", "@o/docs"]);
  });
});
