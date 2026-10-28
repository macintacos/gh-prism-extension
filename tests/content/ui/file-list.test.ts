// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fileList, pathTree } from "@/entrypoints/content/ui/file-list";
import { outline } from "../../fixtures/file-list";

describe("pathTree", () => {
  it("groups files under their folders, each keeping its full path", () => {
    const paths = ["api/generated/client.ts", "web/app.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      {
        folder: "api/generated/",
        children: [{ name: "client.ts", path: "api/generated/client.ts" }],
      },
      { folder: "web/", children: [{ name: "app.ts", path: "web/app.ts" }] },
    ]);
  });

  it("merges a chain of folders that each hold only one folder", () => {
    const paths = ["a/b/c/x.ts", "a/b/c/y.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      {
        folder: "a/b/c/",
        children: [
          { name: "x.ts", path: "a/b/c/x.ts" },
          { name: "y.ts", path: "a/b/c/y.ts" },
        ],
      },
    ]);
  });

  it("keeps a folder apart from its only subfolder when it also holds a file", () => {
    const paths = ["a/x.ts", "a/b/y.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      {
        folder: "a/",
        children: [
          { name: "x.ts", path: "a/x.ts" },
          { folder: "b/", children: [{ name: "y.ts", path: "a/b/y.ts" }] },
        ],
      },
    ]);
  });

  it("nests sibling folders under their shared parent", () => {
    const paths = ["src/a/x.ts", "src/b/y.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      {
        folder: "src/",
        children: [
          { folder: "a/", children: [{ name: "x.ts", path: "src/a/x.ts" }] },
          { folder: "b/", children: [{ name: "y.ts", path: "src/b/y.ts" }] },
        ],
      },
    ]);
  });

  it("puts a file with no folder at the top level", () => {
    const paths = ["README.md", "web/app.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      { name: "README.md", path: "README.md" },
      { folder: "web/", children: [{ name: "app.ts", path: "web/app.ts" }] },
    ]);
  });

  it("orders folders by their first file's appearance", () => {
    const paths = ["web/a.ts", "api/b.ts", "web/c.ts"];

    const tree = pathTree(paths);

    expect(tree).toEqual([
      {
        folder: "web/",
        children: [
          { name: "a.ts", path: "web/a.ts" },
          { name: "c.ts", path: "web/c.ts" },
        ],
      },
      { folder: "api/", children: [{ name: "b.ts", path: "api/b.ts" }] },
    ]);
  });

  it("is empty for no paths", () => {
    const tree = pathTree([]);

    expect(tree).toEqual([]);
  });
});

describe("fileList", () => {
  it("lists folders with their contents indented below them", () => {
    const paths = ["server/src/main/A.java", "server/src/test/B.java", "README.md"];

    const list = fileList(document, paths);

    expect(outline(list)).toEqual([
      "server/src/",
      "  main/",
      "    A.java",
      "  test/",
      "    B.java",
      "README.md",
    ]);
  });

  it("lets a muted monospace folder label break after each slash", () => {
    const list = fileList(document, ["server/src/A.java"]);

    const label = list.querySelector("li > div");

    expect(label?.querySelectorAll("wbr")).toHaveLength(2);
    expect(label?.classList).toContain("tw:text-fg-muted");
    expect(label?.classList).toContain("tw:font-mono");
  });

  it("renders folders and names as text, never as markup", () => {
    const list = fileList(document, ["<img src=x>/<b>y<b>.ts"]);

    expect(outline(list)).toEqual(["<img src=x>/", "  <b>y<b>.ts"]);
    expect(list.querySelector("img, b")).toBeNull();
  });

  it("adds the nodes `under` returns for a file's full path after its name", () => {
    const seen: string[] = [];
    const under = (path: string) => {
      seen.push(path);
      return [Object.assign(document.createElement("span"), { textContent: "owner" })];
    };

    const list = fileList(document, ["web/app.ts"], under);

    const file = list.querySelector("ul ul > li");
    expect(seen).toEqual(["web/app.ts"]);
    expect(file?.lastElementChild?.textContent).toBe("owner");
    expect(file?.firstElementChild?.textContent).toBe("app.ts");
  });
});
