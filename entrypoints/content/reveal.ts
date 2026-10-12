/**
 * Brings a file's diff, or a line in it, into view, and glides the window there instead of
 * letting it jump.
 */

import {
  expandButtonOf,
  expandedDiff,
  type FilesPage,
  findDiff,
  lineRowOf,
  loadDiffButtonOf,
  observeDiffs,
} from "./files-page";

// ponytail: one fixed 5 s wait per step; make it adaptive if slow networks miss it.
const REVEAL_TIMEOUT_MS = 5_000;
// A longer trip jumps to this share of the viewport short of its end, then glides the rest.
const GLIDE_VIEWPORTS = 0.5;

/**
 * Clicks `link`, the native tree row's link, and glides the window to where GitHub scrolls the
 * file's diff instead of letting it jump there; on a page kind that reveals by hash, follows the
 * link's hash instead. Once `signal` aborts, it no longer glides.
 */
export function revealDiff(
  page: FilesPage,
  link: HTMLAnchorElement,
  { signal }: { signal: AbortSignal },
): void {
  switch (page.kind.reveal) {
    case "hash":
      followHash(link, signal);
      break;
    case "click":
      clickAndGlide(link, signal);
      break;
    default:
      page.kind.reveal satisfies never;
  }
}

/** Clicks `link` and glides the window to where GitHub scrolls instead of letting it jump. */
function clickAndGlide(link: HTMLAnchorElement, signal: AbortSignal): void {
  const win = link.ownerDocument.defaultView;
  const from = win?.scrollY ?? 0;
  link.click();
  if (!win || signal.aborted) return;
  // GitHub scrolls in an animation frame its click handler requests; this one runs right after
  // it, before the jump is painted.
  const frame = win.requestAnimationFrame(() => glideFrom(win, from));
  signal.addEventListener("abort", () => win.cancelAnimationFrame(frame), { once: true });
}

/**
 * Moves the page to `link`'s file the way GitHub's own code does: it replaces the URL's hash
 * and announces it, and GitHub glides to the file and marks it current. GitHub ignores an
 * unchanged hash, so a current file is first announced as left.
 */
function followHash(link: HTMLAnchorElement, signal: AbortSignal): void {
  const win = link.ownerDocument.defaultView;
  const hash = link.getAttribute("href");
  if (!win || !hash || signal.aborted) return;
  if (win.location.hash !== hash) replaceHash(win, hash);
  else retakeHash(win, { signal });
}

/**
 * Has GitHub take `win`'s URL hash as if it had just arrived, scrolling to what it names. GitHub
 * ignores an unchanged hash, so the hash is first announced as left. Once `signal` aborts, it no
 * longer announces the hash's return.
 */
export function retakeHash(win: Window, { signal }: { signal: AbortSignal }): void {
  const hash = win.location.hash;
  if (!hash || signal.aborted) return;
  replaceHash(win, "");
  const timer = win.setTimeout(() => replaceHash(win, hash));
  signal.addEventListener("abort", () => win.clearTimeout(timer), { once: true });
}

function replaceHash(win: Window, hash: string): void {
  const oldURL = win.location.href;
  const url = new URL(oldURL);
  url.hash = hash;
  win.history.replaceState(win.history.state, "", url);
  win.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: url.href }));
}

/** Turns the window's jump from `from` to where it is now into a glide over the last stretch. */
function glideFrom(win: Window, from: number): void {
  if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = win.scrollY;
  const reach = win.innerHeight * GLIDE_VIEWPORTS;
  win.scrollTo({ top: Math.min(Math.max(from, to - reach), to + reach), behavior: "instant" });
  win.scrollTo({ top: to, behavior: "smooth" });
}

/**
 * Glides the file's diff to `line`, centred. Mounts, expands or loads the diff first when GitHub
 * has not rendered that far, and falls back to the file's header when no row carries the line.
 * `link` is the native tree row's link, through which `revealDiff` mounts the diff; `line` is a
 * 1-based head-file line. Never rejects; once `signal` aborts, it neither clicks nor scrolls
 * again.
 */
export async function revealDiffLine(
  page: FilesPage,
  link: HTMLAnchorElement,
  line: number,
  { signal }: { signal: AbortSignal },
): Promise<void> {
  if (signal.aborted) return;
  const { diffs } = page;
  // Re-found each time: GitHub may replace a region when it expands or loads it.
  const diff = () => findDiff(page, link);
  const row = () => lineRowOf(diff(), link, line);
  if (!diff()) {
    // GitHub mounts a virtualized diff and scrolls to its header
    revealDiff(page, link, { signal });
    if (!(await untilFound(diffs, diff, signal))) return;
  }
  if (!row() && clicked(expandButtonOf(diff())))
    await untilFound(diffs, () => expandedDiff(diff()), signal);
  if (signal.aborted) return;
  let target = row();
  if (!target && clicked(loadDiffButtonOf(diff()))) target = await untilFound(diffs, row, signal);
  if (signal.aborted) return;
  if (target) centre(target);
  else revealDiff(page, link, { signal }); // the file's header
}

function centre(row: Element): void {
  const win = row.ownerDocument.defaultView;
  const from = win?.scrollY ?? 0;
  row.scrollIntoView({ block: "center", behavior: "instant" });
  if (win) glideFrom(win, from);
}

/** Clicks `button` when there is one; returns whether it clicked. */
function clicked(button: HTMLElement | null): boolean {
  button?.click();
  return button !== null;
}

/**
 * Resolves with `find()` once it is non-null, checked now and after each debounced mutation
 * under `diffs`. Resolves with `find()`'s value at `REVEAL_TIMEOUT_MS`, or with `null` once
 * `signal` aborts.
 */
function untilFound<T>(
  diffs: Element,
  find: () => T | null,
  signal: AbortSignal,
): Promise<T | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const watching = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (found: T | null) => {
      watching.abort(); // ends the observer, its debounce timer, and the abort listener
      clearTimeout(timer);
      resolve(found);
    };
    const check = () => {
      const found = find();
      if (found !== null) finish(found);
    };
    signal.addEventListener("abort", () => finish(null), { signal: watching.signal });
    timer = setTimeout(() => finish(find()), REVEAL_TIMEOUT_MS);
    observeDiffs(diffs, check, { signal: watching.signal });
    check();
  });
}
