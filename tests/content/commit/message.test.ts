// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderCommitMessage } from "../../../entrypoints/content/commit/message";
import { type CommitMessage, findCommitMessage } from "../../../entrypoints/content/files-page";
import { type COMMIT_MESSAGES, foundPage, loadCommitFixture } from "../../fixtures/files-page";

type Card = CommitMessage;

/** The commit page loaded with the `name` card, and that card's message. */
function cardOf(name: keyof typeof COMMIT_MESSAGES): Card {
  loadCommitFixture(name);
  const card = findCommitMessage(foundPage());
  if (!card) throw new Error(`no message box in ${name}`);
  return card;
}

/** The `lists` card with `title` and `body` as text; a `null` body drops the body span. */
function crafted(title: string, body: string | null): Card {
  const card = cardOf("lists");
  card.title.textContent = title;
  if (body === null) {
    card.body?.remove();
    return { ...card, body: null };
  }
  if (card.body) card.body.textContent = body;
  return card;
}

/** A crafted body span holding `children`, as GitHub's text and links. */
function bodyOf(...children: (Node | string)[]): Card {
  const card = crafted("title", "");
  card.body?.replaceChildren(...children);
  return card;
}

/** A detached clone of the `sha` card's `#14437` anchor, taken before the card under test loads. */
function issueLink(): Node {
  const anchor = cardOf("sha").box.querySelector("a.issue-link");
  if (!anchor) throw new Error("no issue link");
  return anchor.cloneNode(true);
}

function render(card: Card): HTMLDivElement {
  const nodes = renderCommitMessage(document, card);
  if (!nodes) throw new Error("rendered nothing");
  const root = document.createElement("div");
  root.append(...nodes);
  return root;
}

describe("renderCommitMessage", () => {
  it("reflows hard-wrapped lines into one paragraph and splits on a blank line", () => {
    const line = "word ".repeat(14).trim();
    const root = render(crafted("title", `${line}\n${line}\n${line}\n\n${line}`));

    expect(root.querySelectorAll("p")).toHaveLength(2);
    expect(root.querySelector("br")).toBeNull();
  });

  it("keeps each bullet's continuation lines in its own list item", () => {
    const root = render(cardOf("lists"));

    expect(root.querySelectorAll("ul")).toHaveLength(1);
    const items = root.querySelectorAll("ul > li");
    expect(items).toHaveLength(7);
    expect(items[0]?.textContent).toContain("so comments, Viewed, and file clicks keep working");
  });

  it("renders every GFM element", () => {
    const body = [
      "## Changes",
      "",
      "Text with `inline code`, **bold**, *emphasis*, ~~struck~~, and a [link](https://example.com/a).",
      "",
      "### Lists",
      "",
      "- one",
      "- two",
      "  - nested",
      "1. first",
      "2. second",
      "- [x] done",
      "- [ ] open",
      "",
      "> quoted",
      "> lines",
      "",
      "```ts",
      "const answer = 42;",
      "```",
      "",
      "| Name | Count |",
      "| :--- | ----: |",
      "| a    | 1     |",
      "",
      "---",
    ].join("\n");
    const root = render(crafted("title", body));

    for (const selector of [
      "h2",
      "h3",
      "p > code",
      "strong",
      "em",
      "del",
      'a[href="https://example.com/a"]',
      "ul > li > ul > li",
      "ol > li",
      "blockquote > p",
      'table > thead > tr > th[align="left"]',
      'tbody > tr > td[align="right"]',
      "hr",
    ]) {
      expect(root.querySelector(selector), selector).not.toBeNull();
    }
    expect(root.querySelector("pre > code")?.textContent).toBe("const answer = 42;");
    const tasks = [...root.querySelectorAll("ul.contains-task-list > li.task-list-item")];
    const boxes = tasks.map((item) => item.firstElementChild as HTMLInputElement);
    expect(boxes.map((box) => [box.type, box.disabled, box.checked])).toEqual([
      ["checkbox", true, true],
      ["checkbox", true, false],
    ]);
    expect(root.querySelector("ul li p")).toBeNull();
  });

  it("renders the title as an h1 with its inline Markdown", () => {
    const [first] = renderCommitMessage(document, crafted("Fix `foo` in bar", null)) ?? [];

    expect(first?.nodeName).toBe("H1");
    expect((first as Element).querySelector("code")?.textContent).toBe("foo");
  });

  it("renders a title that parses as a block as GitHub shows it", () => {
    const [first] = renderCommitMessage(document, crafted("- not a list", null)) ?? [];

    expect(first?.nodeName).toBe("H1");
    expect(first?.textContent).toBe("- not a list");
  });

  it("renders a subject-only message as the title alone", () => {
    const nodes = renderCommitMessage(document, cardOf("subject"));

    expect(nodes?.map((node) => node.nodeName)).toEqual(["H1"]);
  });

  it.each(["sha", "mention"] as const)("copies GitHub's links in the %s card", (name) => {
    const card = cardOf(name);
    const before = card.box.outerHTML;
    const root = render(card);

    const ours = [...root.querySelectorAll("a")];
    const github = [...card.box.querySelectorAll("a")];
    expect(ours.map((a) => a.href)).toEqual(github.map((a) => a.href));
    for (const [i, a] of ours.entries()) expect(a).not.toBe(github[i]);
    expect(card.box.outerHTML).toBe(before);
  });

  it("gives a Markdown link whose URL GitHub linked GitHub's href and its own text", () => {
    const root = render(cardOf("links"));

    const link = [...root.querySelectorAll("a")].find((a) => a.textContent === "Release notes");
    expect(link?.href).toBe("https://github.com/github/codeql-action/releases");
    expect(link?.parentElement?.textContent).not.toContain(")");
  });

  it("writes a reference inside inline code as text", () => {
    const root = render(bodyOf("`", issueLink(), "`"));

    expect(root.querySelector("code")?.textContent).toBe("#14437");
    expect(root.querySelector("code a")).toBeNull();
  });

  it("never nests a reference inside a Markdown link", () => {
    const root = render(bodyOf("[see ", issueLink(), "](https://example.com)"));

    const bodyLinks = [...root.querySelectorAll("a")].filter((a) => !a.closest("h1"));
    expect(bodyLinks).toHaveLength(1);
    expect(root.querySelector("a a")).toBeNull();
  });

  it("writes a reference inside raw HTML as text", () => {
    const root = render(bodyOf("<span>", issueLink(), "</span>"));

    expect(root.textContent).toContain("<span>#14437</span>");
    expect(root.textContent).not.toMatch(/[\uE000\uE001]/);
  });

  it("renders untrusted HTML and unsafe links inert", () => {
    const body = [
      "<script>alert(1)</script>",
      "",
      "<img src=x onerror=alert(1)>",
      "",
      '<a href="javascript:alert(1)">x</a>',
      "",
      "[js](javascript:alert(1)) [vb](vbscript:x) [data](data:text/html,x)",
    ].join("\n");
    const root = render(crafted("title", body));

    expect(root.querySelector("script, img, iframe")).toBeNull();
    const attributes = [...root.querySelectorAll("*")].flatMap((e) => e.getAttributeNames());
    expect(attributes.filter((name) => name.startsWith("on"))).toEqual([]);
    for (const a of root.querySelectorAll("a")) {
      expect(["https:", "http:", "mailto:"]).toContain(new URL(a.href).protocol);
    }
    expect(root.textContent).toContain("<script>alert(1)</script>");
  });

  it("renders an image as a link to it, labelled with its alt text", () => {
    const root = render(crafted("title", "![alt](https://example.com/a.png)"));

    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector('a[href="https://example.com/a.png"]')?.textContent).toBe("alt");
  });

  it("never treats the message's own placeholder characters as a link", () => {
    const root = render(bodyOf(issueLink(), " \uE0000\uE001"));

    const bodyLinks = [...root.querySelectorAll("a")].filter((a) => !a.closest("h1"));
    expect(bodyLinks).toHaveLength(1);
    expect(root.textContent).not.toMatch(/[\uE000\uE001]/);
  });

  it.each([
    ["hex", "&#xE000;0&#xE001;"],
    ["decimal", "&#57344;0&#57345;"],
  ])("never treats a %s character reference to a placeholder as a link", (_, forged) => {
    const issue = issueLink() as HTMLAnchorElement;
    const root = render(bodyOf(issue, ` see ${forged} and [x](${forged})`));

    const githubLinks = [...root.querySelectorAll("a")].filter((a) => a.href === issue.href);
    expect(githubLinks.map((a) => a.textContent)).toEqual([issue.textContent]);
  });

  it("keeps a footnote's reference and definition as text", () => {
    const root = render(crafted("title", "Fix it[^1].\n\n[^1]: The note."));

    expect(root.textContent).toContain("Fix it[^1].");
    expect(root.textContent).toContain("[^1]: The note.");
  });

  it("keeps a paragraph in every item of a loose list", () => {
    const root = render(crafted("title", "- a\n\n- b"));

    expect(root.querySelectorAll("li > p")).toHaveLength(2);
  });

  it("puts a loose task item's checkbox at the start of its paragraph", () => {
    const root = render(crafted("title", "- [x] a\n\n- [ ] b"));

    expect(root.querySelectorAll("li.task-list-item > p > input:first-child")).toHaveLength(2);
  });

  it("resolves a link reference defined inside a blockquote", () => {
    const root = render(crafted("title", "> [x]: https://example.com/x\n\n[see][x]"));

    expect(root.querySelector('a[href="https://example.com/x"]')?.textContent).toBe("see");
  });

  it("renders an image inside a link as its alt text", () => {
    const root = render(
      crafted("title", "[![alt](https://example.com/a.png)](https://example.com/b)"),
    );

    const bodyLinks = [...root.querySelectorAll("a")].filter((a) => !a.closest("h1"));
    expect(bodyLinks.map((a) => [a.href, a.textContent])).toEqual([
      ["https://example.com/b", "alt"],
    ]);
    expect(root.querySelector("a a")).toBeNull();
  });

  it("refuses a body over the length cap", () => {
    expect(renderCommitMessage(document, crafted("title", "a".repeat(50_001)))).toBeUndefined();
  });

  it("refuses a deeply nested blockquote", () => {
    expect(
      renderCommitMessage(document, crafted("title", `${">".repeat(40)} deep`)),
    ).toBeUndefined();
  });

  it("refuses a deeply nested list", () => {
    const list = Array.from({ length: 40 }, (_, i) => `${"  ".repeat(i)}- item`).join("\n");

    expect(renderCommitMessage(document, crafted("title", list))).toBeUndefined();
  });

  it("refuses a paragraph of unpaired emphasis delimiters", () => {
    expect(renderCommitMessage(document, crafted("title", "*_".repeat(10_000)))).toBeUndefined();
  });

  it("refuses a long paragraph after an unclosed bracket", () => {
    const body = `[${"word ".repeat(8_000)}`;

    expect(renderCommitMessage(document, crafted("title", body))).toBeUndefined();
  });

  it("refuses a paragraph of closing brackets", () => {
    expect(renderCommitMessage(document, crafted("title", "]".repeat(20_000)))).toBeUndefined();
  });

  it("counts indented bullet lines as one paragraph's delimiters", () => {
    const body = `x\n${"    - [*[*\n".repeat(2_000)}`;

    expect(renderCommitMessage(document, crafted("title", body))).toBeUndefined();
  });

  it("renders a long list rich in inline Markdown", () => {
    const lines = Array.from(
      { length: 300 },
      (_, n) =>
        `- **item ${n}**: fix [#${n}](https://example.com/${n}) in \`snake_case_name\` and _note_`,
    );
    const root = render(crafted("title", lines.join("\n")));

    expect(root.querySelectorAll("ul > li")).toHaveLength(300);
  });

  it("renders a large table just under the length cap", () => {
    const rows = Array.from({ length: 500 }, (_, i) => `| ${i} | row |`);
    const table = ["| n | name |", "| - | - |", ...rows].join("\n");
    const body = `${table}\n\n${"a".repeat(49_000 - table.length)}`;

    expect(renderCommitMessage(document, crafted("title", body))).toBeDefined();
  });
});
