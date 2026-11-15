/**
 * gh-prism's headed group at the end of GitHub's diff settings menu, and the gate that says
 * whether the items in it can be offered.
 */

import {
  copyMenuDivider,
  copyMenuGroup,
  diffTables,
  type FilesPage,
  findCompactLineHeight,
  findLayoutGear,
  followLayoutMenu,
  type LayoutMenu,
  menuEntry,
  observeDiffs,
} from "../files-page";
import { prismGlyph } from "../ui/mark";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./prism-menu.css?inline";

/** Whether gh-prism's group can be offered: "closed" until the gear is found, "given up" once an open menu can't host it. */
export type MenuGate = "closed" | "open" | "given up";

/** One checkmark item in gh-prism's diff settings group. */
export interface PrismMenuItem {
  readonly id: string;
  readonly text: string;
  readonly subtitle?: string;
  readonly checked: () => boolean;
  readonly pick: () => void;
  /** Runs on every gate change. */
  readonly follow: (gate: MenuGate) => void;
}

/** Appends gh-prism's group, holding `items`, each time `page`'s diff settings menu opens, until `signal` aborts. */
export function showPrismMenu(
  page: FilesPage,
  signal: AbortSignal,
  items: readonly PrismMenuItem[],
): void {
  const doc = page.sidebar.ownerDocument;
  let gate: MenuGate = "closed";
  const warned = new Set<string>();
  const warnOnce = (message: string) => {
    if (warned.has(message)) return;
    warned.add(message);
    console.warn(`gh-prism: ${message}`);
  };
  const setGate = (next: MenuGate) => {
    gate = next;
    for (const item of items) item.follow(gate);
  };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  doc.head.append(style);
  signal.addEventListener("abort", () => style.remove());

  const openGate = () => {
    if (gate !== "closed") return;
    if (findLayoutGear(page)) setGate("open");
    else if (diffTables(page.diffs).length > 0)
      warnOnce(
        "the diff settings gear is missing, so diffs keep wrapping long lines and click to comment stays off",
      );
  };

  const addGroup = (menu: LayoutMenu) => {
    const compact = findCompactLineHeight(menu);
    const { headedGroup, divider } = menu;
    if (!compact || !headedGroup || !divider) {
      setGate("given up");
      warnOnce(
        "the diff settings menu can't hold gh-prism's group, so diffs keep wrapping long lines and click to comment stays off",
      );
      return;
    }
    const dividerCopy = copyMenuDivider({ divider });
    const { group, list, heading } = copyMenuGroup({ headedGroup }, "gh-prism");
    heading.append(prismGlyph(doc, { class: "tw:ms-1 tw:align-text-bottom" }));
    for (const item of items)
      list.append(
        menuEntry(compact, {
          id: item.id,
          text: item.text,
          subtitle: item.subtitle,
          role: "menuitemcheckbox",
          checked: item.checked(),
          pick: item.pick,
        }),
      );
    menu.list.append(dividerCopy, group);
  };

  observeDiffs(page.diffs, openGate, { signal });
  followLayoutMenu(
    doc,
    (menu) => {
      openGate();
      if (gate === "open") addGroup(menu);
    },
    { signal },
  );
  openGate();
}
