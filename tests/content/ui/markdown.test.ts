// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { markdownNodes } from "../../../entrypoints/content/ui/markdown";

function rendered(markdown: string): HTMLElement {
  const root = document.createElement("div");
  root.append(...markdownNodes(document, markdown));
  return root;
}

describe("markdownNodes", () => {
  it("renders headings, bullets, and paragraphs as h4, ul > li, and p", () => {
    const root = rendered("# Title\n\n- one\n* two\n\nSome text\nwrapped");

    expect(root.querySelector("h4")?.textContent).toBe("Title");
    expect([...root.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual([
      "one",
      "two",
    ]);
    expect(root.querySelector("p")?.textContent).toBe("Some text wrapped");
  });

  it("renders bold as strong and backticks as code", () => {
    const root = rendered("a **bold** and `code` b");

    expect(root.querySelector("strong")?.textContent).toBe("bold");
    expect(root.querySelector("code")?.textContent).toBe("code");
    expect(root.textContent).toBe("a bold and code b");
  });

  it.each([
    ["[text](https://example.com/a)", "text"],
    ["see https://example.com/a", "https://example.com/a"],
  ])("links %s in a new tab", (markdown, text) => {
    const link = rendered(markdown).querySelector("a");

    expect(link?.textContent).toBe(text);
    expect(link?.getAttribute("href")).toBe("https://example.com/a");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
  });

  it("renders HTML tags as their own text", () => {
    const markdown = "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>";

    const root = rendered(markdown);

    expect(root.querySelector("script, img")).toBeNull();
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("makes no link for a non-http URL", () => {
    const root = rendered("[x](javascript:alert(1))");

    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent).toBe("[x](javascript:alert(1))");
  });

  it("leaves a bare URL's trailing punctuation as text", () => {
    const root = rendered("see https://example.com/a.");

    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a");
    expect(root.querySelector("p")?.lastChild?.textContent).toBe(".");
  });

  it("renders a GitHub-generated release body", () => {
    const markdown = [
      "## What's Changed",
      "* Add a thing by @u in https://github.com/o/r/pull/1",
      "",
      "**Full Changelog**: https://github.com/o/r/compare/v1...v2",
    ].join("\n");

    const root = rendered(markdown);

    expect(root.querySelector("h4")?.textContent).toBe("What's Changed");
    expect(root.querySelector("li")?.textContent).toBe(
      "Add a thing by @u in https://github.com/o/r/pull/1",
    );
    expect(root.querySelector("li a")?.getAttribute("href")).toBe("https://github.com/o/r/pull/1");
    expect(root.querySelector("p strong")?.textContent).toBe("Full Changelog");
    expect(root.querySelector("p a")?.getAttribute("href")).toBe(
      "https://github.com/o/r/compare/v1...v2",
    );
  });
});
