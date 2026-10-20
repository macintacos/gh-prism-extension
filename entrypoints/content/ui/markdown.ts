import { el } from "./dom";

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const INLINE =
  /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

/**
 * `markdown` as DOM nodes of `doc`, from a subset: headings (all as `h4`), `-`/`*` bullets,
 * paragraphs, `**bold**`, `` `code` ``, `[text](url)`, and bare http(s) URLs. Everything else,
 * HTML included, stays literal text.
 */
export function markdownNodes(doc: Document, markdown: string): Node[] {
  const nodes: Node[] = [];
  let paragraph: string[] = [];
  let list: HTMLUListElement | undefined;
  const endParagraph = () => {
    if (paragraph.length > 0)
      nodes.push(el(doc, "p", "", ...inlineNodes(doc, paragraph.join(" "))));
    paragraph = [];
  };

  for (const line of markdown.split(/\r?\n/).map((raw) => raw.trim())) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (bullet) {
      endParagraph();
      if (!list) {
        list = el(doc, "ul", "");
        nodes.push(list);
      }
      list.append(el(doc, "li", "", ...inlineNodes(doc, bullet[1] ?? "")));
      continue;
    }
    list = undefined;
    if (heading) {
      endParagraph();
      nodes.push(el(doc, "h4", "", ...inlineNodes(doc, heading[1] ?? "")));
    } else if (line === "") {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();

  return nodes;
}

function inlineNodes(doc: Document, text: string): (Node | string)[] {
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    nodes.push(text.slice(last, match.index));
    last = match.index + match[0].length;

    const [source, bold, code, label, href, bare] = match;
    if (bold !== undefined) nodes.push(el(doc, "strong", "", ...inlineNodes(doc, bold)));
    else if (code !== undefined) nodes.push(el(doc, "code", "", code));
    else nodes.push(link(doc, label ?? bare ?? "", href ?? bare ?? "") ?? source);
  }
  nodes.push(text.slice(last));

  return nodes.filter((node) => node !== "");
}

/** An `a` to `href` opening in a new tab, or undefined unless `href` is an http(s) URL. */
function link(doc: Document, text: string, href: string): HTMLAnchorElement | undefined {
  if (!URL.canParse(href) || !["https:", "http:"].includes(new URL(href).protocol))
    return undefined;

  const a = el(doc, "a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  return a;
}
