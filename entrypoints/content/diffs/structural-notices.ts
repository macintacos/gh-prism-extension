import type { StructuralProblem } from "@/utils/structural/file-changes";
import { currentLayout, diffTables, observeDiffs } from "../files-page";
import { el } from "../ui/dom";
import { LOADING_DELAY_MS } from "../ui/team-box";
import type { LandingView } from "../visit/land";
import { pathsByAnchor } from "./on-screen";
import type { PaintOutcome } from "./structural";
import type { StructuralAnswer } from "./structural-files";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./structural-notices.css?inline";

/** Why a file shows GitHub's diff under Structural mode: every problem but `not-applicable`, or the painter's mismatch. */
export type NoticeKind = Exclude<StructuralProblem, "not-applicable"> | "mismatch";

export const NOTICE_COPY: Record<NoticeKind, string> = {
  unsupported: "Structural mode doesn't cover this file's language yet, so this is GitHub's diff.",
  "too-large": "This file is too large for Structural mode, so this is GitHub's diff.",
  "rate-limited":
    "GitHub is rate-limiting requests, so this is GitHub's diff; reload to try Structural mode again.",
  "no-access": "Sign in to GitHub to see this file in Structural mode.",
  failed: "Structural mode is in beta and couldn't compare this file, so this is GitHub's diff.",
  mismatch:
    "Structural mode is in beta and its reading of this file doesn't match the page, so this is GitHub's diff; reload to try again.",
};

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

export const NOTICE_CLASS = "gh-prism-structural-notice";
export const LOADING_CLASS = "gh-prism-structural-loading";
const KIND_ATTR = "data-gh-prism-notice";

/** The notices' view, plus `refresh` for a change `observeDiffs` can't see. */
export type StructuralNotices = LandingView & { refresh(): void };

/** What one mounted table wants before it, and the node of ours already there. */
interface Want {
  readonly table: HTMLTableElement;
  readonly show: NoticeKind | "loading" | undefined;
  readonly current: Element | undefined;
}

/** One pass's reads: each table's want, every path pending, and every node of ours under the diffs. */
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
  const style = Object.assign(doc.createElement("style"), { textContent: css });
  // A pending path's hold: its timer, or `true` once LOADING_DELAY_MS has passed.
  const holds = new Map<string, number | true>();
  let paths: ReadonlyMap<string, string> = new Map();
  let frame: number | undefined;

  const collect = (): Pass => {
    const wants: Want[] = [];
    const pending = new Set<string>();
    const split = currentLayout(diffs) === "split";
    for (const { table, anchor } of split ? diffTables(diffs) : []) {
      const path = paths.get(anchor);
      if (path === undefined) continue;
      const state = stateOf(path);
      if (state === "pending") pending.add(path);
      const show = state === "pending" ? (holds.get(path) === true ? "loading" : undefined) : state;
      const before = table.previousElementSibling ?? undefined;
      const current = before?.matches(`.${NOTICE_CLASS}, .${LOADING_CLASS}`) ? before : undefined;
      wants.push({ table, show, current });
    }
    return {
      wants,
      pending,
      ours: [...diffs.querySelectorAll(`.${NOTICE_CLASS}, .${LOADING_CLASS}`)],
    };
  };
  const nodeFor = (show: NoticeKind | "loading"): Element => {
    if (show === "loading") {
      const line = el(doc, "div", LOADING_CLASS);
      line.setAttribute("aria-hidden", "true");
      return line;
    }
    const notice = el(
      doc,
      "p",
      "gh-prism-structural-notice tw:m-0 tw:py-1 tw:px-4 tw:text-body-small tw:leading-body-small tw:text-fg-muted",
      NOTICE_COPY[show],
    );
    notice.setAttribute(KIND_ATTR, show);
    return notice;
  };
  const apply = ({ wants, ours }: Pass) => {
    const kept = new Set<Element>();
    for (const { table, show, current } of wants) {
      if (shows(current, show)) {
        if (current) kept.add(current);
      } else if (show !== undefined) table.before(nodeFor(show));
    }
    for (const node of ours) if (!kept.has(node)) node.remove();
  };
  const trackHolds = ({ pending }: Pass) => {
    for (const [path, hold] of holds) {
      if (pending.has(path)) continue;
      if (hold !== true) win?.clearTimeout(hold);
      holds.delete(path);
    }
    for (const path of pending) {
      if (holds.has(path) || !win) continue;
      holds.set(
        path,
        win.setTimeout(() => {
          holds.set(path, true);
          schedule();
        }, LOADING_DELAY_MS),
      );
    }
  };
  // Every read precedes every write, so a pass never forces a layout between them.
  const pass = () => {
    const work = collect();
    apply(work);
    trackHolds(work);
  };
  const schedule = () => {
    if (signal.aborted || !win) return;
    frame ??= win.requestAnimationFrame(() => {
      frame = undefined;
      pass();
    });
  };

  if (signal.aborted) return { refresh: () => {} };

  doc.head.append(style);
  observeDiffs(diffs, schedule, { signal });
  signal.addEventListener("abort", () => {
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
    for (const hold of holds.values()) if (hold !== true) win?.clearTimeout(hold);
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
