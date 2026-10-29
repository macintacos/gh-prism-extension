/**
 * Renders a commit message out of GitHub's box as GitHub-flavored Markdown: its title as an `h1`,
 * its body reflowed like a README. Every element is built with `el()`; no HTML string is ever
 * parsed, so raw HTML in a message shows as text. GitHub's own links in the box are copied in.
 */
import type { Definition, ListItem, Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { CommitMessage } from "../files-page";
import { el } from "../ui/dom";

const MAX_LENGTH = 50_000;
const MAX_DEPTH = 32;

// Private-use code points around a link's index stand in for GitHub's `<a>` in the source.
const PLACEHOLDER = /\uE000(\d+)\uE001/g;
const WHOLE_PLACEHOLDER = /^\uE000(\d+)\uE001$/;

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

type Content = (Node | string)[];

interface Context {
  readonly doc: Document;
  readonly links: readonly Element[];
  readonly definitions: ReadonlyMap<string, Definition>;
}

/** `message`'s title as an `h1` and its body as GFM, as DOM of `doc`, or `undefined` past the caps. */
export function renderCommitMessage(
  doc: Document,
  message: Pick<CommitMessage, "title" | "body">,
): Node[] | undefined {
  const links: Element[] = [];
  const title = sourceOf(message.title, links);
  const body = message.body ? sourceOf(message.body, links) : "";
  if (title.length + body.length > MAX_LENGTH) return undefined;

  const titleTree = parse(title);
  const bodyTree = parse(body);
  if (tooDeep(titleTree) || tooDeep(bodyTree)) return undefined;

  const heading = titleOf(
    { doc, links, definitions: definitionsOf(titleTree) },
    titleTree,
    message.title,
  );
  const context = { doc, links, definitions: definitionsOf(bodyTree) };
  const rest = bodyTree.children.flatMap((node) => nodesOf(context, node, linked));
  return [
    heading,
    ...rest.map((node) => (typeof node === "string" ? doc.createTextNode(node) : node)),
  ];
}

/** `part`'s text with each `<a>` in it appended to `links` and written as its placeholder. */
function sourceOf(part: Node, links: Element[]): string {
  let source = "";
  for (const child of part.childNodes) {
    if (child instanceof Element && child.localName === "a") {
      source += `\uE000${links.push(child) - 1}\uE001`;
    } else if (child instanceof Element) {
      source += sourceOf(child, links);
    } else if (child.nodeType === Node.TEXT_NODE) {
      source += (child.textContent ?? "").replace(/[\uE000\uE001]/g, "");
    }
  }
  return source;
}

function parse(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** Whether `tree` nests deeper than `MAX_DEPTH`, walked without recursion. */
function tooDeep(tree: Root): boolean {
  const stack: [Nodes, number][] = [[tree, 0]];
  for (let entry = stack.pop(); entry; entry = stack.pop()) {
    const [node, depth] = entry;
    if (depth > MAX_DEPTH) return true;
    if ("children" in node) for (const child of node.children) stack.push([child, depth + 1]);
  }
  return false;
}

function definitionsOf(tree: Root): Map<string, Definition> {
  const definitions = new Map<string, Definition>();
  const stack: Nodes[] = [tree];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node.type === "definition" && !definitions.has(node.identifier)) {
      definitions.set(node.identifier, node);
    }
    if ("children" in node) stack.push(...[...node.children].reverse());
  }
  return definitions;
}

/** The title as an `h1`: its inline Markdown, or GitHub's own nodes when it parses as a block. */
function titleOf(context: Context, tree: Root, original: Element): HTMLHeadingElement {
  const [only] = tree.children;
  if (tree.children.length === 1 && only?.type === "paragraph") {
    return el(context.doc, "h1", "", ...only.children.flatMap((n) => nodesOf(context, n, linked)));
  }
  return el(context.doc, "h1", "", ...[...original.childNodes].map((n) => n.cloneNode(true)));
}

type Text = (context: Context, value: string) => Content;

/** Text with each placeholder as a copy of GitHub's link. */
function linked({ links }: Context, value: string): Content {
  const content: Content = [];
  let last = 0;
  for (const match of value.matchAll(PLACEHOLDER)) {
    content.push(value.slice(last, match.index));
    const link = links[Number(match[1])];
    if (link) content.push(link.cloneNode(true));
    last = match.index + match[0].length;
  }
  content.push(value.slice(last));
  return content.filter((part) => part !== "");
}

/** Text with each placeholder as its link's text. */
function plain({ links }: Context, value: string): string {
  return value.replace(PLACEHOLDER, (_, i: string) => links[Number(i)]?.textContent ?? "");
}

function plainText(context: Context, value: string): Content {
  return [plain(context, value)];
}

/** `url` when it resolves to a safe protocol; a placeholder takes GitHub's link's `href`. */
function hrefOf(context: Context, url: string): string | undefined {
  const index = WHOLE_PLACEHOLDER.exec(url)?.[1];
  const href = index ? context.links[Number(index)]?.getAttribute("href") : plain(context, url);
  if (!href) return undefined;
  try {
    return SAFE_PROTOCOLS.has(new URL(href, context.doc.baseURI).protocol) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** A link to `url` holding `content`, or `content` alone when `url` isn't safe. */
function linkTo(
  context: Context,
  url: string,
  title: string | null | undefined,
  content: Content,
): Content {
  const href = hrefOf(context, url);
  if (!href) return content;
  const a = el(context.doc, "a", "", ...content);
  a.href = href;
  if (title) a.title = plain(context, title);
  return [a];
}

/** A list item; a tight list's items unwrap their paragraphs, as GitHub's do. */
function itemOf(context: Context, item: ListItem, loose: boolean, text: Text): HTMLLIElement {
  const { doc } = context;
  const content = item.children.flatMap((child) =>
    child.type === "paragraph" && !loose
      ? child.children.flatMap((n) => nodesOf(context, n, text))
      : nodesOf(context, child, text),
  );
  if (item.checked == null) return el(doc, "li", "", ...content);

  const box = el(doc, "input", "task-list-item-checkbox");
  box.type = "checkbox";
  box.disabled = true;
  box.checked = item.checked;
  const [first] = content;
  if (loose && first instanceof Element && first.localName === "p") {
    first.prepend(box, " ");
    return el(doc, "li", "task-list-item", ...content);
  }
  return el(doc, "li", "task-list-item", box, " ", ...content);
}

function nodesOf(context: Context, node: Nodes, text: Text): Content {
  const { doc } = context;
  const children = (inner: Text = text): Content =>
    "children" in node ? node.children.flatMap((child) => nodesOf(context, child, inner)) : [];

  switch (node.type) {
    case "text":
      return text(context, node.value);
    case "paragraph":
      return [el(doc, "p", "", ...children())];
    case "heading":
      return [el(doc, HEADINGS[node.depth - 1] ?? "h6", "", ...children())];
    case "emphasis":
      return [el(doc, "em", "", ...children())];
    case "strong":
      return [el(doc, "strong", "", ...children())];
    case "delete":
      return [el(doc, "del", "", ...children())];
    case "inlineCode":
      return [el(doc, "code", "", plain(context, node.value))];
    case "code":
      return [el(doc, "pre", "", el(doc, "code", "", plain(context, node.value)))];
    case "html":
      return [plain(context, node.value)];
    case "break":
      return [el(doc, "br", "")];
    case "thematicBreak":
      return [el(doc, "hr", "")];
    case "blockquote":
      return [el(doc, "blockquote", "", ...children())];
    case "list": {
      const loose = Boolean(node.spread) || node.children.some((item) => item.spread);
      const items = node.children.map((item) => itemOf(context, item, loose, text));
      const list = node.ordered ? el(doc, "ol", "", ...items) : el(doc, "ul", "", ...items);
      if (node.ordered && node.start != null && node.start !== 1)
        list.setAttribute("start", `${node.start}`);
      if (node.children.some((item) => item.checked != null))
        list.classList.add("contains-task-list");
      return [list];
    }
    case "link":
      return linkTo(context, node.url, node.title, children(plainText));
    case "linkReference": {
      const definition = context.definitions.get(node.identifier);
      const content = children(plainText);
      return definition ? linkTo(context, definition.url, definition.title, content) : content;
    }
    case "image": {
      const alt = [plain(context, node.alt ?? "")];
      return text === plainText ? alt : linkTo(context, node.url, node.title, alt);
    }
    case "imageReference": {
      const definition = context.definitions.get(node.identifier);
      const alt = [plain(context, node.alt ?? "")];
      if (text === plainText || !definition) return alt;
      return linkTo(context, definition.url, definition.title, alt);
    }
    case "table": {
      const [head, ...rows] = node.children.map((row, i) =>
        el(
          doc,
          "tr",
          "",
          ...row.children.map((cell, j) => {
            const td = el(
              doc,
              i === 0 ? "th" : "td",
              "",
              ...cell.children.flatMap((n) => nodesOf(context, n, text)),
            );
            const align = node.align?.[j];
            if (align) td.setAttribute("align", align);
            return td;
          }),
        ),
      );
      const table = el(doc, "table", "", el(doc, "thead", "", ...(head ? [head] : [])));
      if (rows.length > 0) table.append(el(doc, "tbody", "", ...rows));
      return [table];
    }
    case "definition":
      return [];
    default:
      return children();
  }
}
