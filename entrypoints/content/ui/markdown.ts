/**
 * Release notes Markdown as DOM. Writes bare tags (`h4`, `p`, `ul`, `li`, `strong`, `code`, `a`)
 * and no classes, so the caller styles them. Headings are all `h4` so the notes never outrank the
 * block's `h3`.
 */
import { el } from "./dom";

const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
// A URL never ends in sentence punctuation, so a trailing period stays text.
const INLINE =
  /\*\*(?<bold>.+?)\*\*|`(?<code>[^`]+)`|\[(?<label>[^\]]+)\]\((?<href>[^)\s]+)\)|(?<bare>https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

/**
 * `markdown` as DOM nodes of `doc`, from a subset: headings, `-`/`*` bullets, paragraphs,
 * `**bold**`, `` `code` ``, `[text](url)`, and bare http(s) URLs. Everything else, HTML included,
 * stays literal text.
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
    const bullet = BULLET.exec(line)?.[1];
    const heading = HEADING.exec(line)?.[1];
    if (bullet === undefined) list = undefined;

    if (bullet !== undefined) {
      endParagraph();
      if (!list) {
        list = el(doc, "ul", "");
        nodes.push(list);
      }
      list.append(el(doc, "li", "", ...inlineNodes(doc, bullet)));
    } else if (heading !== undefined) {
      endParagraph();
      nodes.push(el(doc, "h4", "", ...inlineNodes(doc, heading)));
    } else if (line === "") endParagraph();
    else paragraph.push(line);
  }
  endParagraph();

  return nodes;
}

function inlineNodes(doc: Document, text: string): (Node | string)[] {
  const nodes: (Node | string)[] = [];
  let consumed = 0;
  for (const match of text.matchAll(INLINE)) {
    nodes.push(text.slice(consumed, match.index));
    consumed = match.index + match[0].length;

    const groups: Partial<Record<string, string>> = match.groups ?? {};
    const { bold, code, label, href, bare } = groups;
    if (bold !== undefined) nodes.push(el(doc, "strong", "", ...inlineNodes(doc, bold)));
    else if (code !== undefined) nodes.push(el(doc, "code", "", code));
    else nodes.push(link(doc, label ?? bare ?? "", href ?? bare ?? "") ?? match[0]);
  }
  nodes.push(text.slice(consumed));

  return nodes.filter((node) => node !== "");
}

/**
 * An `a` to `href` opening in a new tab, so a click doesn't leave the pull request, or undefined
 * unless `href` is an http(s) URL.
 */
function link(doc: Document, text: string, href: string): HTMLAnchorElement | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (!["https:", "http:"].includes(url.protocol)) return undefined;

  const a = el(doc, "a", "", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  return a;
}
