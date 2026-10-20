/** When the what's-new block shows: the rule alone, with the clock passed in. */

/** What gh-prism remembers about the what's-new block; version strings and a timestamp only. */
export interface WhatsNewState {
  dismissed?: string;
  shown?: {
    version: string;
    /** When `version` first showed, in ms since the epoch. */
    at: number;
  };
}

const WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** `saved` as a WhatsNewState, dropping any field of the wrong shape. */
export function whatsNewStateOf(saved: unknown): WhatsNewState {
  if (typeof saved !== "object" || saved === null) return {};
  const { dismissed, shown } = saved as Record<string, unknown>;
  const state: WhatsNewState = {};

  if (typeof dismissed === "string") state.dismissed = dismissed;
  if (typeof shown === "object" && shown !== null) {
    const { version, at } = shown as Record<string, unknown>;
    if (typeof version === "string" && typeof at === "number") state.shown = { version, at };
  }

  return state;
}

/**
 * Whether `version`'s notes show at `now`, and the state to store: the first view of a new version
 * stamps `shown`, which starts its 3-day window. Returns `state` itself when nothing changes.
 */
export function whatsNewAt(
  state: WhatsNewState,
  version: string,
  now: number,
): { shows: boolean; state: WhatsNewState } {
  if (state.dismissed === version) return { shows: false, state };
  if (state.shown?.version !== version) {
    return { shows: true, state: { ...state, shown: { version, at: now } } };
  }
  return { shows: now - state.shown.at < WINDOW_MS, state };
}

/** `state` with `version` dismissed. */
export function dismissWhatsNew(state: WhatsNewState, version: string): WhatsNewState {
  return { ...state, dismissed: version };
}
