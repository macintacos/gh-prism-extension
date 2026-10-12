/**
 * The user's preferences, each a typed item in extension storage. `fallback` stands in only for
 * a missing value: a stored value of the wrong shape reads back as is, so narrow it on read.
 */

import { storage } from "wxt/utils/storage";

/** The edge the sidebar docks on. */
export type Side = "left" | "right";

/** The side the sidebar docks on, synced across the user's browsers. */
export const sidebarSide = storage.defineItem<Side>("sync:sidebarSide", { fallback: "right" });
