import type { StructuralProblem } from "@/utils/structural/file-changes";
import { diffTables, observeDiffs } from "../files-page";
import { el } from "../ui/dom";
import { LOADING_DELAY_MS } from "../ui/loading-view";
import type { LandingView } from "../visit/land";
import { pathsByAnchor } from "./on-screen";
import type { PaintOutcome } from "./structural";
import type { StructuralAnswer } from "./structural-files";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./structural-notices.css?inline";

/** Why a file shows GitHub's diff under Structural mode. */
export type NoticeKind = Exclude<StructuralProblem, "not-applicable"> | "mismatch";

/** The sentence each kind shows. */
export const NOTICE_COPY: Record<NoticeKind, string> = {
  unsupported: "Structural mode doesn't cover this file's language yet, so this is GitHub's diff.",
  "too-large": "This file is too large for Structural mode, so this is GitHub's diff.",
  "rate-limited":
    "GitHub is rate-limiting requests, so this is GitHub's diff; reload to try Structural mode again.",
  "no-access":
    "Sign in to GitHub to see this file in Structural mode; until then, this is GitHub's diff.",
  failed: "Structural mode is in beta and couldn't compare this file, so this is GitHub's diff.",
  mismatch:
    "Structural mode is in beta and its reading of this file doesn't match the page, so this is GitHub's diff; reload to try again.",
};

// A dot after a name character, then a short plain suffix: a dotfile's name or a suffix holding
// anything else could be private, and the form is public.
const EXTENSION = /[^/.](\.[A-Za-z0-9_+-]{1,16})$/;

/**
 * The form that asks for Structural mode to cover a language, prefilled with `path`'s extension
 * alone, never its name or folders. Template file and field id must match
 * .github/ISSUE_TEMPLATE/language_request.yml.
 */
export function languageRequestUrl(path: string): string {
  const url = new URL("https://github.com/macintacos/gh-prism-extension/issues/new");
  url.searchParams.set("template", "language_request.yml");
  const extension = EXTENSION.exec(path)?.[1];
  if (extension) url.searchParams.set("extensions", extension);
  return url.href;
}

/** What a mounted file shows beside its diff: a pending request, a notice, or nothing. */
export type FileState = "pending" | NoticeKind | undefined;

/** The notice for a file's settled answer and the painter's latest outcome, if it needs one. */
export function noticeOf(
  answer: StructuralAnswer | undefined,
  outcome: PaintOutcome | undefined,
): NoticeKind | undefined {
  if (answer?.ok === false) return answer.problem === "not-applicable" ? undefined : answer.problem;
  return answer && outcome === "mismatch" ? "mismatch" : undefined;
}

// Keep in sync with structural-notices.css's selector, the notice's class string below, and the
// copies in e2e/smoke.e2e.ts and bench/structural-mode-live.ts.
export const NOTICE_CLASS = "gh-prism-structural-notice";
export const LOADING_CLASS = "gh-prism-structural-loading";
export const KIND_ATTR = "data-gh-prism-structural-notice";

/** The notices' view, plus `refresh` for a change `observeDiffs` can't see. */
export type StructuralNotices = LandingView & { refresh(): void };

/** What one mounted table wants before it, and the node of ours already there. */
interface Want {
  readonly table: HTMLTableElement;
  readonly path: string;
  readonly show: NoticeKind | "loading" | undefined;
  readonly current: Element | undefined;
}

/** One pass's reads: each table's want, every pending path, and our nodes under the diffs. */
interface Pass {
  readonly wants: readonly Want[];
  readonly pending: ReadonlySet<string>;
  readonly ours: readonly Element[];
}

/** Whether `node` is already what `show` asks for. */
function shows(node: Element | undefined, show: Want["show"]): boolean {
  if (show === undefined) return node === undefined;
  if (show === "loading") return node?.classList.contains(LOADING_CLASS) ?? false;
  return node?.getAttribute(KIND_ATTR) === show;
}

/**
 * Shows each mounted file's notice or held-back loading line under `diffs` until `signal` aborts,
 * then removes every node and the sheet. `stateOf` is asked again on every pass.
 */
export function showStructuralNotices(
  diffs: Element,
  signal: AbortSignal,
  stateOf: (path: string) => FileState,
): StructuralNotices {
  const doc = diffs.ownerDocument;
  const win = doc.defaultView;
  if (!win || signal.aborted) return { refresh: () => {} };

  const style = Object.assign(doc.createElement("style"), { textContent: css });
  // A pending path's hold: its timer, or `true` once LOADING_DELAY_MS has passed. A timer, not a
  // CSS delay: a delayed node would still wake every observeDiffs consumer for each fast answer.
  const holds = new Map<string, number | true>();
  let paths: ReadonlyMap<string, string> = new Map();
  let frame: number | undefined;

  const collect = (): Pass => {
    const wants: Want[] = [];
    const pending = new Set<string>();
    const tables = diffTables(diffs);
    const showsSplit = tables.some(({ layout }) => layout === "split");
    for (const { table, anchor, layout } of showsSplit ? tables : []) {
      const path = paths.get(anchor);
      if (path === undefined) continue;
      const state = stateOf(path);
      if (state === "pending") pending.add(path);
      const overdue = holds.get(path) === true && layout === "split";
      const show = state === "pending" ? (overdue ? "loading" : undefined) : state;
      const before = table.previousElementSibling ?? undefined;
      const current = before?.matches(`.${NOTICE_CLASS}, .${LOADING_CLASS}`) ? before : undefined;
      wants.push({ table, path, show, current });
    }
    return {
      wants,
      pending,
      ours: [...diffs.querySelectorAll(`.${NOTICE_CLASS}, .${LOADING_CLASS}`)],
    };
  };
  const requestLink = (path: string): HTMLAnchorElement => {
    const link = el(
      doc,
      "a",
      "gh-prism-structural-request tw:text-[color:var(--fgColor-accent)] tw:underline tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-1 tw:rounded-[2px]",
      "Request this language",
    );
    link.href = languageRequestUrl(path);
    link.target = "_blank";
    link.rel = "noreferrer";
    return link;
  };
  const nodeFor = (show: NoticeKind | "loading", path: string): Element => {
    if (show === "loading") {
      const line = el(doc, "div", LOADING_CLASS);
      line.setAttribute("aria-hidden", "true");
      return line;
    }
    const notice = el(
      doc,
      "p",
      "gh-prism-structural-notice tw:m-0 tw:py-1 tw:ps-10 tw:pe-4 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
      NOTICE_COPY[show],
    );
    if (show === "unsupported") notice.append(" ", requestLink(path));
    notice.setAttribute(KIND_ATTR, show);
    return notice;
  };
  const apply = ({ wants, ours }: Pass) => {
    const kept = new Set<Element>();
    for (const { table, path, show, current } of wants) {
      if (shows(current, show)) {
        if (current) kept.add(current);
      } else if (show !== undefined) table.before(nodeFor(show, path));
    }
    for (const node of ours) if (!kept.has(node)) node.remove();
  };
  const trackHolds = ({ pending }: Pass) => {
    for (const [path, hold] of holds) {
      if (pending.has(path)) continue;
      if (hold !== true) win.clearTimeout(hold);
      holds.delete(path);
    }
    for (const path of pending) {
      if (holds.has(path)) continue;
      holds.set(
        path,
        win.setTimeout(() => {
          holds.set(path, true);
          schedule();
        }, LOADING_DELAY_MS),
      );
    }
  };
  // A settled pass writes nothing: each insertion wakes observeDiffs, so the next pass must be the
  // last.
  const pass = () => {
    const reads = collect();
    apply(reads);
    trackHolds(reads);
  };
  const schedule = () => {
    if (signal.aborted) return;
    frame ??= win.requestAnimationFrame(() => {
      frame = undefined;
      pass();
    });
  };

  doc.head.append(style);
  observeDiffs(diffs, schedule, { signal });
  signal.addEventListener("abort", () => {
    if (frame !== undefined) win.cancelAnimationFrame(frame);
    for (const hold of holds.values()) if (hold !== true) win.clearTimeout(hold);
    holds.clear();

    for (const node of diffs.querySelectorAll(`.${NOTICE_CLASS}, .${LOADING_CLASS}`)) node.remove();
    style.remove();
  });

  return {
    sections(sections) {
      paths = pathsByAnchor(sections);
      schedule();
    },
    refresh: schedule,
  };
}
