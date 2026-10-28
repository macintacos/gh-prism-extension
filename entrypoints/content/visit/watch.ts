/**
 * Follows Files view visits, and the pages each one renders, across GitHub's navigation; and
 * likewise a pull request's classic Files changed page, and its header on its header tabs.
 */

import {
  type FilesRoute,
  isFilesPath,
  readFilesRoute,
  readHeaderTabPr,
} from "@/utils/github/files-route";
import type { PrRef } from "@/utils/github/pr-ref";
import {
  type ClassicPage,
  type FilesPage,
  findClassicPage,
  findFilesPage,
  findHeaderPage,
  type HeaderPage,
} from "../files-page";

// Long enough for popstate's ~200 ms early fire and a slow cold render.
const SETTLE_MS = 10_000;

/** What to do with each render of a page's markup during one visit. */
export type OnPage<P = FilesPage> = (page: P, signal: AbortSignal) => void;

/** The callbacks through which `watchPages` reports visits and missing markup. */
interface PageHandlers<P, R> {
  /**
   * A page's markup first appeared at `route`; `signal` aborts once the visit ends. A hash change
   * never ends it. Returns the handler for that markup and each replacement GitHub renders during
   * the visit, whose `signal` aborts once it is replaced or removed.
   */
  onVisit(route: R, signal: AbortSignal): OnPage<P>;
  /** The page's markup never appeared. Fires at most once for each `watchPages` call. */
  onMissing(): void;
}

/**
 * The callbacks through which `watchFilesPages` reports visits to the Files changed tab, each
 * ending once the pathname changes, and that tab's markup never appearing.
 */
export type FilesPageHandlers = PageHandlers<FilesPage, FilesRoute>;

/**
 * How `watchPages` reads the pathnames one kind of page shows on, finds its markup, and tells
 * whether a found render still shows. Routes `visitOf` names alike share one visit; without it,
 * each pathname is its own.
 */
interface PageFinder<P, R> {
  routeOf(pathname: string): R | undefined;
  visitOf?(route: R): string;
  find(doc: Document): P | undefined;
  showing(page: P): boolean;
}

const FILES_VIEW: PageFinder<FilesPage, FilesRoute> = {
  routeOf: readFilesRoute,
  find: findFilesPage,
  showing: ({ sidebar, tree, diffs }) =>
    sidebar.isConnected && tree.isConnected && diffs.isConnected,
};

const CLASSIC: PageFinder<ClassicPage, FilesRoute> = {
  routeOf: readFilesRoute,
  find: findClassicPage,
  showing: ({ toolbar, reviewTools }) => toolbar.isConnected && reviewTools.isConnected,
};

const HEADER: PageFinder<HeaderPage, PrRef> = {
  routeOf: readHeaderTabPr,
  visitOf: ({ owner, repo, number }) => `${owner}/${repo}#${number}`,
  find: findHeaderPage,
  showing: ({ slot }) => slot.isConnected,
};

/**
 * Calls `onVisit` for each visit to a Files changed tab in `win`, on first load and on GitHub's
 * own `soft-nav:end` (fired once the new page has rendered) and `popstate`, until `signal`
 * aborts. Each trigger follows the markup over a settle window, since `popstate` fires before the
 * DOM swap and GitHub may re-render the markup while the page loads; a mutation observer hands
 * over a replacement before it is painted. Not WXT's location-change event: it fires at navigation
 * start, before GitHub renders, and on every hash change a file click makes.
 */
export const watchFilesPages = (
  win: Window,
  handlers: FilesPageHandlers,
  signal: AbortSignal,
): void => watchPages(win, FILES_VIEW, handlers, signal);

/**
 * Calls `onPage` for each render of a pull request's classic Files changed page in `win`, as
 * `watchFilesPages` follows the new one, until `signal` aborts. Each render's `signal` aborts once
 * it is replaced or removed, or the pathname changes.
 */
export const watchClassicPages = (
  win: Window,
  onPage: OnPage<ClassicPage>,
  signal: AbortSignal,
): void => watchPages(win, CLASSIC, { onVisit: () => onPage, onMissing: () => {} }, signal);

/**
 * Calls `onVisit` for each visit to a pull request's header tabs in `win`, as `watchFilesPages`
 * follows the Files changed tab, until `signal` aborts. Moving between one pull request's header
 * tabs keeps the visit, and its page while GitHub keeps the header's slot.
 */
export const watchHeaderPages = (
  win: Window,
  onVisit: (pr: PrRef, signal: AbortSignal) => OnPage<HeaderPage>,
  signal: AbortSignal,
): void => watchPages(win, HEADER, { onVisit, onMissing: () => {} }, signal);

function watchPages<P, R>(
  win: Window,
  { routeOf, visitOf, find, showing }: PageFinder<P, R>,
  handlers: PageHandlers<P, R>,
  signal: AbortSignal,
): void {
  let visit: { key: string; onPage: OnPage<P>; controller: AbortController } | undefined;
  let shown: { page: P; controller: AbortController } | undefined;
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
    const route = routeOf(pathname);
    const key = route && visitOf ? visitOf(route) : pathname;
    if (visit && visit.key !== key) leave();
    if (shown && showing(shown.page)) return;

    const page = route && find(win.document);
    drop();
    if (!route || !page) return;

    if (!visit) {
      const controller = new AbortController();
      visit = { key, controller, onPage: handlers.onVisit(route, controller.signal) };
    }
    shown = { page, controller: new AbortController() };
    visit.onPage(page, shown.controller.signal);
  };

  const observer = new MutationObserver(sync);

  const endSettle = () => {
    observer.disconnect();
    const { pathname } = win.location;
    // GitHub shows the classic page in the new one's place, so neither is missing.
    if (!shown && !missingReported && isFilesPath(pathname) && !findClassicPage(win.document)) {
      missingReported = true;
      handlers.onMissing();
    }
  };

  const settle = () => {
    win.clearTimeout(timer);
    sync();
    observer.observe(win.document, { childList: true, subtree: true });
    timer = win.setTimeout(endSettle, SETTLE_MS);
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
