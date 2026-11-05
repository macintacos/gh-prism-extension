// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { describeListing } from "@/entrypoints/content/sidebar/owners-popover";
import { codeOwnerOf } from "@/utils/github/code-owners";
import { outline } from "../../fixtures/file-list";

const file = (path: string, ...tokens: string[]) => ({
  path: `src/${path}`,
  owners: tokens.map(codeOwnerOf),
});

const listOf = (files: ReturnType<typeof file>[]) =>
  describeListing(document, { folder: "src/", files }).list;

const headings = (list: Element) => [...list.querySelectorAll("h3")];

describe("a folder's list", () => {
  it("names a set its files share once, above all of them", () => {
    const files = [file("a.ts", "@o/team"), file("b.ts", "@o/team")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["@o/team", "  a.ts", "  b.ts"]);
    expect(headings(list)).toHaveLength(1);
  });

  it("groups files by owner set, in the order of each set's first file", () => {
    const files = [file("a.ts", "@o/x"), file("b.ts", "@o/y"), file("c.ts", "@o/x")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["@o/x", "  a.ts", "  c.ts", "@o/y", "  b.ts"]);
  });

  it("groups owners regardless of order or case, headed as the first file lists them", () => {
    const files = [file("a.ts", "@a", "@b"), file("b.ts", "@b", "@a"), file("c.ts", "@B", "@A")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["@a, @b", "  a.ts", "  b.ts", "  c.ts"]);
  });

  it("keeps overlapping sets apart", () => {
    const files = [file("a.ts", "@a"), file("b.ts", "@a", "@b")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["@a", "  a.ts", "@a, @b", "  b.ts"]);
  });

  it("lists files without a code owner last, under a muted heading", () => {
    const files = [file("a.ts"), file("b.ts", "@o/x")];

    const list = listOf(files);

    expect(outline(list)).toEqual(["@o/x", "  b.ts", "No code owner", "  a.ts"]);
    expect(headings(list).map((heading) => heading.classList.contains("tw:text-fg-muted"))).toEqual(
      [false, true],
    );
  });

  it("lays each group's files out as a tree of muted subfolders", () => {
    const files = [file("a/b/c.ts", "@o/x"), file("a/d.ts", "@o/x"), file("e.ts", "@o/y")];

    const list = listOf(files);

    expect(outline(list)).toEqual([
      "@o/x",
      "  a/",
      "    b/",
      "      c.ts",
      "    d.ts",
      "@o/y",
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
      "@o/a",
      "@o/b",
      "@o/a, @o/b",
      "No code owner",
    ]);
    expect(headings(list).map((heading) => heading.nextElementSibling?.children.length)).toEqual([
      750, 750, 750, 750,
    ]);
  });
});
