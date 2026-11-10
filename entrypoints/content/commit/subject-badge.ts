/**
 * Badges a conventional commit title in GitHub's own message box, where a subject-only commit
 * keeps it. GitHub's title stays in the box, hidden and unchanged, so React goes on rendering it;
 * a copy led by the badge stands in front of it.
 */
import { type FilesPage, findCommitMessage } from "../files-page";
import { el } from "../ui/dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./subject-badge.css?inline";
import { parseConventionalTitle, titleBadge } from "./title-badge";

/**
 * Stands a badged copy of `page`'s commit title in front of GitHub's while that title is
 * conventional, following GitHub's re-renders of the card, until `signal` aborts.
 */
export function badgeSubject(page: FilesPage, signal: AbortSignal): void {
  const doc = page.sidebar.ownerDocument;
  const card = findCommitMessage(page)?.box.parentNode;
  const badged = el(doc, "span", "gh-prism-commit-title");
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  // GitHub's title as `badged` last copied it, so a sync that changes nothing writes nothing.
  let copied: string | undefined;

  const sync = () => {
    const title = findCommitMessage(page)?.title;
    const content = title && badgedContent(doc, title);
    if (!title || !content) {
      badged.remove();
      return;
    }
    if (copied !== title.innerHTML) {
      badged.replaceChildren(...content);
      // The badge replaces the prefix; the tooltip keeps it readable.
      badged.title = title.textContent ?? "";
    }
    copied = title.innerHTML;
    if (badged.nextSibling !== title) title.before(badged);
  };

  sync();
  doc.head.append(style);

  const observer = new MutationObserver(sync);
  if (card) observer.observe(card, { childList: true, characterData: true, subtree: true });

  signal.addEventListener("abort", () => {
    observer.disconnect();
    badged.remove();
    style.remove();
  });
}

/**
 * `title`'s content led by its badge, as nodes of `doc`, or `undefined` when the title isn't
 * conventional or GitHub put a link inside its prefix.
 */
function badgedContent(doc: Document, title: Element): (Node | string)[] | undefined {
  const text = title.textContent ?? "";
  const conventional = parseConventionalTitle(text);
  const [first, ...after] = title.childNodes;
  const opening = first?.nodeType === Node.TEXT_NODE ? (first.textContent ?? "") : "";
  const prefixLength = text.length - (conventional?.rest.length ?? 0);
  if (!conventional || opening.length < prefixLength) return undefined;

  return [
    ...titleBadge(doc, conventional, conventional.scope ? [conventional.scope] : []),
    opening.slice(prefixLength),
    ...after.map((node) => node.cloneNode(true)),
  ];
}
