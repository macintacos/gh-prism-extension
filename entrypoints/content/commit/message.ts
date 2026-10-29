/**
 * Renders a commit message out of GitHub's box as GitHub-flavored Markdown: its title as an `h1`,
 * its body reflowed like a README. Every element is built with `el()`; no HTML string is ever
 * parsed, so raw HTML in a message shows as text. GitHub's own links in the box are copied in.
 */
import type { Definition, List, ListItem, Nodes, Resource, Root, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { CommitMessage } from "../files-page";
import { el } from "../ui/dom";

type Content = (Node | string)[];

interface Context {
  readonly doc: Document;
  readonly links: readonly Element[];
  readonly definitions: ReadonlyMap<string, Definition>;
}

/**
 * Where text sits: in running text a placeholder is GitHub's link; inside a link's text it is the
 * link's text, so no link nests.
 */
type Mode = "linked" | "inLink";

const MAX_LENGTH = 50_000; // title and body source, a link counting as its placeholder

/**
 * `message`'s title as an `h1` and its body as GFM, as DOM of `doc`, or `undefined` past the caps.
 */
export function renderCommitMessage(
  doc: Document,
  message: Pick<CommitMessage, "title" | "body">,
): Node[] | undefined {
  const source = sourceWithinCaps(message);
  if (!source) return undefined;

  const titleTree = parse(source.title);
  const bodyTree = parse(source.body);
  if (tooDeep(titleTree) || tooDeep(bodyTree)) return undefined;

  const { links } = source;
  const context = { doc, links, definitions: definitionsOf(bodyTree) };
  const heading = titleOf(context, titleTree, message.title);
  const rest = bodyTree.children.flatMap((node) => nodesOf(context, node, "linked"));
  return [
    heading,
    ...rest.map((node) => (typeof node === "string" ? doc.createTextNode(node) : node)),
  ];
}

/**
 * Whether `message` is within the length and parse-cost caps, checked without parsing; one nested
 * too deep still renders as `undefined`.
 */
export const withinCaps = (message: Pick<CommitMessage, "title" | "body">): boolean =>
  sourceWithinCaps(message) !== undefined;

interface Source {
  readonly title: string;
  readonly body: string;
  /** GitHub's links, each written in `title` or `body` as the placeholder of its index. */
  readonly links: readonly Element[];
}

function sourceWithinCaps(message: Pick<CommitMessage, "title" | "body">): Source | undefined {
  const links: Element[] = [];
  const title = sourceOf(message.title, links);
  const body = message.body ? sourceOf(message.body, links) : "";
  if (title.length + body.length > MAX_LENGTH) return undefined;
  if (parseCost(title) + parseCost(body) > MAX_PARSE_COST) return undefined;
  return { title, body, links };
}

// Private-use code points around a link's index stand in for GitHub's `<a>` in the source.
const placeholder = (index: number): string => `\uE000${index}\uE001`;
const PLACEHOLDER = /\uE000(\d+)\uE001/g;
const WHOLE_PLACEHOLDER = /^\uE000(\d+)\uE001$/;
// Numeric character references too: micromark decodes them after `sourceOf`.
const PLACEHOLDER_CHARACTERS = /[\uE000\uE001]|&#(?:x0*e00[01]|0*5734[45]);/gi;

/** `part`'s text with each `<a>` in it appended to `links` and written as its placeholder. */
function sourceOf(part: Node, links: Element[]): string {
  let source = "";
  for (const child of part.childNodes) {
    if (child instanceof Element && child.localName === "a") {
      source += placeholder(links.push(child) - 1);
    } else if (child instanceof Element) {
      source += sourceOf(child, links);
    } else if (child.nodeType === Node.TEXT_NODE) {
      source += (child.textContent ?? "").replace(PLACEHOLDER_CHARACTERS, "");
    }
  }
  return source;
}

// ponytail: an estimate calibrated against micromark 4 / GFM 3, not a measurement; parse off the
// page's main thread if real messages start getting refused.
const MAX_PARSE_COST = 5_000_000;
const DELIMITERS = /[*_~[\]]/g;
// A blank line, or a line starting a bullet item, always ends a paragraph's inline content.
const PARAGRAPH_BREAK = /\n(?:[ \t]*\n| {0,3}[-*+][ \t]+(?=\S))/;

/**
 * An estimate of parsing `markdown`: micromark's inline parse grows with a paragraph's length
 * times its delimiters, and with its length squared after an unclosed `[`.
 */
function parseCost(markdown: string): number {
  let cost = 0;
  for (const chunk of markdown.split(PARAGRAPH_BREAK)) {
    const delimiters = chunk.match(DELIMITERS)?.length ?? 0;
    cost += chunk.length * (delimiters + (chunk.includes("[") ? chunk.length / 15 : 0));
  }
  return cost;
}

function parse(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

const MAX_DEPTH = 32; // tree levels below the root

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
    return el(
      context.doc,
      "h1",
      "",
      ...only.children.flatMap((n) => nodesOf(context, n, "linked")),
    );
  }
  return el(context.doc, "h1", "", ...[...original.childNodes].map((n) => n.cloneNode(true)));
}

const write = (context: Context, mode: Mode, value: string): Content =>
  mode === "linked" ? linked(context, value) : [plain(context, value)];

/** Text with each placeholder as a copy of GitHub's link. */
function linked({ links }: Context, value: string): Content {
  const content: Content = [];
  let textStart = 0;
  for (const match of value.matchAll(PLACEHOLDER)) {
    content.push(value.slice(textStart, match.index));
    const link = links[Number(match[1])];
    if (link) content.push(link.cloneNode(true));
    textStart = match.index + match[0].length;
  }
  content.push(value.slice(textStart));
  return content.filter((part) => part !== "");
}

/** Text with each placeholder as its link's text. */
function plain({ links }: Context, value: string): string {
  return value.replace(PLACEHOLDER, (_, i: string) => links[Number(i)]?.textContent ?? "");
}

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

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
function linkTo(context: Context, { url, title }: Resource, content: Content): Content {
  const href = hrefOf(context, url);
  if (!href) return content;
  const a = el(context.doc, "a", "", ...content);
  a.href = href;
  if (title) a.title = plain(context, title);
  return [a];
}

/** A list item; a tight list's items unwrap their paragraphs, as GitHub's do. */
function itemOf(context: Context, item: ListItem, loose: boolean, mode: Mode): HTMLLIElement {
  const { doc } = context;
  const content = item.children.flatMap((child) =>
    child.type === "paragraph" && !loose
      ? child.children.flatMap((n) => nodesOf(context, n, mode))
      : nodesOf(context, child, mode),
  );
  if (item.checked == null) return el(doc, "li", "", ...content);

  const checkbox = el(doc, "input", "task-list-item-checkbox");
  checkbox.type = "checkbox";
  checkbox.disabled = true;
  checkbox.checked = item.checked;
  const [first] = content;
  if (loose && first instanceof Element && first.localName === "p") {
    first.prepend(checkbox, " ");
    return el(doc, "li", "task-list-item", ...content);
  }
  return el(doc, "li", "task-list-item", checkbox, " ", ...content);
}

function listOf(context: Context, node: List, mode: Mode): HTMLElement {
  const { doc } = context;
  const loose = Boolean(node.spread) || node.children.some((item) => item.spread);
  const items = node.children.map((item) => itemOf(context, item, loose, mode));
  const list = node.ordered ? el(doc, "ol", "", ...items) : el(doc, "ul", "", ...items);

  if (node.ordered && node.start != null && node.start !== 1)
    list.setAttribute("start", `${node.start}`);
  if (node.children.some((item) => item.checked != null)) list.classList.add("contains-task-list");
  return list;
}

function tableOf(context: Context, node: Table, mode: Mode): HTMLTableElement {
  const { doc } = context;
  const [head, ...rows] = node.children.map((row, i) =>
    el(
      doc,
      "tr",
      "",
      ...row.children.map((cell, j) => {
        const td = el(doc, i === 0 ? "th" : "td", "", ...nodesOf(context, cell, mode));
        const align = node.align?.[j];
        if (align) td.setAttribute("align", align);
        return td;
      }),
    ),
  );

  const table = el(doc, "table", "", el(doc, "thead", "", ...(head ? [head] : [])));
  if (rows.length > 0) table.append(el(doc, "tbody", "", ...rows));
  return table;
}

/** `node` as DOM content of `context.doc`, its text written as `mode` says. */
function nodesOf(context: Context, node: Nodes, mode: Mode): Content {
  const { doc } = context;
  const children = (inner: Mode = mode): Content =>
    "children" in node ? node.children.flatMap((child) => nodesOf(context, child, inner)) : [];

  switch (node.type) {
    case "root":
    case "listItem":
    case "tableRow":
    case "tableCell":
      return children();
    case "text":
      return write(context, mode, node.value);
    case "paragraph":
      return [el(doc, "p", "", ...children())];
    case "heading":
      return [el(doc, `h${node.depth}`, "", ...children())];
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
    case "yaml":
      return [plain(context, node.value)];
    case "break":
      return [el(doc, "br", "")];
    case "thematicBreak":
      return [el(doc, "hr", "")];
    case "blockquote":
      return [el(doc, "blockquote", "", ...children())];
    case "list":
      return [listOf(context, node, mode)];
    case "table":
      return [tableOf(context, node, mode)];
    case "link":
      return linkTo(context, node, children("inLink"));
    case "linkReference": {
      const definition = context.definitions.get(node.identifier);
      const content = children("inLink");
      return definition ? linkTo(context, definition, content) : content;
    }
    case "image": {
      const alt = [plain(context, node.alt ?? "")];
      return mode === "inLink" ? alt : linkTo(context, node, alt);
    }
    case "imageReference": {
      const definition = context.definitions.get(node.identifier);
      const alt = [plain(context, node.alt ?? "")];
      return mode === "inLink" || !definition ? alt : linkTo(context, definition, alt);
    }
    case "footnoteReference":
      return [`[^${node.label ?? node.identifier}]`];
    case "footnoteDefinition": {
      const marker = `[^${node.label ?? node.identifier}]: `;
      const content = children();
      const [first] = content;
      if (node.children[0]?.type === "paragraph" && first instanceof Element) first.prepend(marker);
      else content.unshift(marker);
      return content;
    }
    case "definition":
      return [];
    default:
      return node satisfies never;
  }
}
