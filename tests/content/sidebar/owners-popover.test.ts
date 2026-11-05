// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { describeListing } from "@/entrypoints/content/sidebar/owners-popover";
import type { OwnerIdentities } from "@/entrypoints/content/ui/owner-identity";
import { codeOwnerOf } from "@/utils/github/code-owners";
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
