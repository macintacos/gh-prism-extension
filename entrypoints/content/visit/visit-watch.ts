/** Follows Files view visits, and the pages each one renders, across GitHub's navigation. */

import { type FilesRoute, isFilesPath, readFilesRoute } from "@/utils/github/files-route";
import { type FilesPage, findFilesPage } from "../files-page";

// Long enough for popstate's ~200 ms early fire and a slow cold render.
const SETTLE_MS = 10_000;

/** What to do with each Files changed markup GitHub renders during one visit. */
export type OnPage = (page: FilesPage, signal: AbortSignal) => void;

export interface FilesPageHandlers {
  /**
   * The Files changed tab's markup first appeared at `route`; `signal` aborts once the pathname
   * changes or leaves the tab. A hash change is not a new visit. Returns the handler for that
   * markup and each replacement GitHub renders during the visit, whose `signal` aborts once it is
   * replaced or removed.
   */
  onVisit(route: FilesRoute, signal: AbortSignal): OnPage;
  /**
   * The Files changed tab's markup never appeared. Fires at most once for each
   * `watchFilesPages` call.
   */
  onMissing(): void;
}

const isShowing = ({ sidebar, tree, diffs }: FilesPage) =>
  sidebar.isConnected && tree.isConnected && diffs.isConnected;

/**
 * Calls `onVisit` for each visit to a Files changed tab in `win`, on first load and on GitHub's
 * own `soft-nav:end` (fired once the new page has rendered) and `popstate`, until `signal`
 * aborts. Each trigger follows the markup over a settle window, since `popstate` fires before the
 * DOM swap and GitHub may re-render the markup while the page loads; a mutation observer hands
 * over a replacement before it is painted. Not WXT's location-change event: it fires at navigation
 * start, before GitHub renders, and on every hash change a file click makes.
 */
export function watchFilesPages(
  win: Window,
  handlers: FilesPageHandlers,
  signal: AbortSignal,
): void {
  let visit: { pathname: string; onPage: OnPage; controller: AbortController } | undefined;
  let shown: { page: FilesPage; controller: AbortController } | undefined;
  let timer: number | undefined;
  let missingReported = false;

  const drop = () => {
    shown?.controller.abort();
    shown = undefined;
  };

  const leave = () => {
    drop();
    visit?.controller.abort();
    visit = undefined;
  };

  const sync = () => {
    const { pathname } = win.location;
    if (visit && visit.pathname !== pathname) leave();
    if (shown && isShowing(shown.page)) return;
    const route = readFilesRoute(pathname);
    const page = route && findFilesPage(win.document);
    drop();
    if (!route || !page) return;
    if (!visit) {
      const controller = new AbortController();
      visit = { pathname, controller, onPage: handlers.onVisit(route, controller.signal) };
    }
    shown = { page, controller: new AbortController() };
    visit.onPage(page, shown.controller.signal);
  };

  const observer = new MutationObserver(sync);

  const settle = () => {
    win.clearTimeout(timer);
    sync();
    observer.observe(win.document, { childList: true, subtree: true });
    timer = win.setTimeout(() => {
      observer.disconnect();
      if (!shown && !missingReported && isFilesPath(win.location.pathname)) {
        missingReported = true;
        handlers.onMissing();
      }
    }, SETTLE_MS);
  };

  win.document.addEventListener("soft-nav:end", settle, { signal });
  win.addEventListener("popstate", settle, { signal });
  signal.addEventListener("abort", () => {
    win.clearTimeout(timer);
    observer.disconnect();
    leave();
  });
  settle();
}
