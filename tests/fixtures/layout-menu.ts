/**
 * Plays GitHub's Layout menu on a fixture page: a gear click mounts `menu` under
 * `#__primerPortalRoot__` after a microtask, its checked item the layout on screen; an item click posts `/users/diffview`, swaps each diff
 * table for its `tables[layout]` copy, replaces `?diff=`, and unmounts the menu, focusing the gear.
 * `omit` leaves one Layout item out. It plays until `signal` aborts, or for the page's life.
 *
 * Self-contained, with no imports and no closure over module state, so `page.addInitScript` can
 * install it too.
 */
export function installLayoutMenu(options: {
  menu: string;
  tables: { unified: string; split: string };
  omit?: "unified" | "split";
  signal?: AbortSignal;
}): void {
  const GEAR = "button:has(.octicon-gear)";
  const LABEL = '[data-component="ActionList.Item.Label"]';
  const parse = (html: string) =>
    new DOMParser().parseFromString(`<body>${html}`, "text/html").body;
  let openMenu: { list: Element; gear: HTMLButtonElement } | undefined;

  const close = () => {
    if (!openMenu) return;
    openMenu.list.remove();
    openMenu.gear.setAttribute("aria-expanded", "false");
    openMenu.gear.focus();
    openMenu = undefined;
  };

  const choose = (layout: "unified" | "split") => {
    const table = parse(options.tables[layout]).querySelector("table");
    for (const onScreenTable of document.querySelectorAll("table[data-diff-anchor]")) {
      if (table) onScreenTable.replaceWith(document.importNode(table, true));
    }
    const url = new URL(location.href);
    url.searchParams.set("diff", layout);
    history.replaceState(history.state, "", url);
    // Only a page served as github.com has somewhere to post; happy-dom's origin has none.
    if (location.protocol === "https:")
      void fetch("/users/diffview", { method: "POST", body: `diff=${layout}` }).catch(() => {});
    close();
  };

  const mount = (gear: HTMLButtonElement) => {
    const list = parse(options.menu).querySelector('ul[role="menu"]');
    if (!list) return;
    // Checked as GitHub's: the layout on screen, read off the first table's columns.
    const columns = document.querySelector("table[data-diff-anchor] > colgroup")?.childElementCount;
    const shown = columns === 4 ? "split" : "unified";
    for (const item of list.querySelectorAll('[role="menuitemradio"]')) {
      const label = item.querySelector(LABEL)?.textContent?.trim().toLowerCase();
      item.setAttribute("aria-checked", String(label === shown));
      if (label === options.omit) item.remove();
      else if (label === "unified" || label === "split")
        item.addEventListener("click", () => choose(label));
    }
    list.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") close();
    });
    let portal = document.querySelector("#__primerPortalRoot__");
    if (!portal) {
      portal = Object.assign(document.createElement("div"), { id: "__primerPortalRoot__" });
      document.body.append(portal);
    }
    portal.append(list);
    gear.setAttribute("aria-expanded", "true");
    openMenu = { list, gear };
  };

  document.addEventListener(
    "click",
    (event) => {
      const gear = event.target instanceof Element ? event.target.closest(GEAR) : null;
      if (!(gear instanceof HTMLButtonElement)) return;
      if (openMenu) close();
      else queueMicrotask(() => mount(gear));
    },
    { capture: true, ...(options.signal ? { signal: options.signal } : {}) },
  );
}
