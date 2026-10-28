/**
 * Adds an "Only files owned by…" section to GitHub's file-tree filter menu: "Me", standing in for
 * GitHub's "Only files owned by you", then each reviewer who owns a changed file.
 */

import { isOwner, owningReviewers, type PrCodeOwners } from "@/utils/github/code-owners";
import { ownerOf, withOwner, withViewerOwner } from "@/utils/github/files-route";
import {
  copyMenuGroup,
  copyMenuItem,
  type FilesPage,
  type FilterMenu,
  followFilterMenu,
  viewerLogin,
} from "../files-page";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./owner-section.css?inline";

/** The visit's code owners, and how the section loads a pick. */
export interface OwnerSectionOptions {
  /** The visit's code owners, read once per visit; never re-fetched here. */
  readonly codeOwners: Promise<PrCodeOwners | undefined>;
  /** Loads `href` as a new page: the owner filter reads its owner once per page. */
  readonly navigate: (href: string) => void;
}

/**
 * Adds the "Only files owned by…" section to GitHub's file-tree filter menu each time it opens,
 * until `signal` aborts: "Me", standing in for GitHub's "Only files owned by you", then each
 * reviewer who owns a changed file. Adds nothing when the code owners don't arrive, when nobody
 * qualifies, or when the menu's markup is unrecognized.
 */
export function showOwnerSection(
  page: FilesPage,
  signal: AbortSignal,
  { codeOwners, navigate }: OwnerSectionOptions,
): void {
  void codeOwners.then((read) => {
    if (!read || signal.aborted) return;
    const doc = page.sidebar.ownerDocument;
    const viewer = viewerLogin(doc);
    const reviewers = owningReviewers(read, viewer);

    const style = Object.assign(doc.createElement("style"), { textContent: css });
    doc.head.append(style);
    signal.addEventListener("abort", () => style.remove());

    followFilterMenu(
      page,
      (menu, closed) => addSection(doc, menu, closed, { reviewers, viewer, navigate }),
      { signal },
    );
  });
}

interface SectionParts {
  readonly reviewers: readonly string[];
  readonly viewer: string | undefined;
  readonly navigate: (href: string) => void;
}

function addSection(
  doc: Document,
  menu: FilterMenu,
  closed: AbortSignal,
  { reviewers, viewer, navigate }: SectionParts,
): void {
  const { ownedByYou } = menu;
  if (!ownedByYou && reviewers.length === 0) return;
  const owner = ownerOf(doc.location.search);
  const { group: section, list } = copyMenuGroup(menu, "Only files owned by…");
  section.classList.add("gh-prism-owner-section");

  if (ownedByYou) {
    const checked = ownedByYou.item.getAttribute("aria-checked") === "true";
    list.append(
      entry(menu, list.children.length, "Me", checked, () => {
        if (viewer !== undefined && owner !== undefined)
          navigate(withViewerOwner(doc.location.href, viewer));
        else ownedByYou.item.click();
      }),
    );
  }
  for (const token of reviewers) {
    const checked = owner !== undefined && isOwner(token, { token: owner });
    // ponytail: a pick reloads the page, since the owner filter reads its owner once per page and
    // never un-hides; re-read the owner on an in-page URL change in watch.ts and land.ts to skip it.
    list.append(
      entry(menu, list.children.length, token, checked, () =>
        navigate(withOwner(doc.location.href, checked ? undefined : token)),
      ),
    );
  }

  const dividerCopy = ownedByYou ? undefined : (menu.divider.cloneNode(true) as Element);
  if (ownedByYou) {
    ownedByYou.group.before(section);
    // Primer's focus zone skips only disabled items; a hidden one traps the arrow keys.
    ownedByYou.item.setAttribute("disabled", "");
  } else if (dividerCopy) menu.divider.after(section, dividerCopy);
  closed.addEventListener("abort", () => {
    section.remove();
    dividerCopy?.remove();
    ownedByYou?.item.removeAttribute("disabled");
  });
}

/** A menu entry labelled `text` that runs `pick` on click, Enter, or Space, then closes the menu. */
function entry(
  menu: FilterMenu,
  n: number,
  text: string,
  checked: boolean,
  pick: () => void,
): HTMLElement {
  const { item, label } = copyMenuItem(menu);
  const id = `gh-prism-owner-${n}`;
  item.id = id;
  item.setAttribute("role", "menuitemradio");
  item.setAttribute("tabindex", "-1");
  item.setAttribute("aria-labelledby", `${id}--label`);
  item.setAttribute("aria-checked", String(checked));
  label.id = `${id}--label`;
  label.textContent = text;

  const run = () => {
    pick();
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  };
  item.addEventListener("click", run);
  item.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    run();
  });
  return item;
}
