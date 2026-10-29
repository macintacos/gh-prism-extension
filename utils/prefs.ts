/**
 * The user's preferences, each a typed item in extension storage. Keys and values persist across
 * updates: change one only through the item's `version` and `migrations`. `fallback` stands in
 * only for a missing value: a stored value of the wrong shape reads back as is, so read it as
 * `unknown` and narrow it.
 */

import { storage } from "wxt/utils/storage";
import type { WhatsNewState } from "./whats-new";

/** The edge the sidebar docks on. */
export type Side = "left" | "right";

/**
 * The side the user last docked the sidebar on; Chrome sync carries it to their other computers
 * when on.
 */
export const sidebarSide = storage.defineItem<Side>("sync:sidebarSide", { fallback: "right" });

/** Which view the header's lines-changed counter shows: a pill per section, or GitHub's total. */
export type DiffstatView = "breakout" | "total";

/**
 * The view the user last switched the header counter to; Chrome sync carries it to their other
 * computers when on.
 */
export const diffstatView = storage.defineItem<DiffstatView>("sync:diffstatView", {
  fallback: "breakout",
});

/** Which view a commit page's message opens on: rendered as Markdown, or GitHub's own box. */
export type CommitMessageView = "rendered" | "plaintext";
export const commitMessageView = storage.defineItem<CommitMessageView>("sync:commitMessageView", {
  fallback: "rendered",
});

/**
 * Whether the user dismissed the notice on GitHub's classic Files changed page; kept on this
 * computer only.
 */
export const classicNoticeDismissed = storage.defineItem<boolean>("local:classicNoticeDismissed", {
  fallback: false,
});

/**
 * Which version's what's-new notes the user dismissed or first saw, and when; kept on this
 * computer only.
 */
export const whatsNewSeen = storage.defineItem<WhatsNewState>("local:whatsNewSeen", {
  fallback: {},
});
