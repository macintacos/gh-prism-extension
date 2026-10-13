import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import { connectPrData } from "@/utils/github/pr-port";
import { readDiffPin } from "@/utils/github/pr-ref";
import { type IntentSources, intentFor, shareIntent } from "@/utils/intent/intent";
import { storedIntents } from "@/utils/intent/intent-cache";
import { sidebarSide } from "@/utils/prefs";
import type { DiffstatChoice } from "./header/diffstat-view";
import { dockSidebar, type Side, type SideChoice } from "./sidebar/sidebar-side";
import { showVisit } from "./visit/visit";
import { watchFilesPages } from "./visit/visit-watch";

const CACHED_DIFFS = 50;

/**
 * On every Files view on github.com, shows the sidebar's sections, orders the diffs to match,
 * stands in for the diffstat, and docks the sidebar on the saved side with a switch.
 */
export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  runAt: "document_start",
  async main(ctx) {
    const diffstat: DiffstatChoice = { view: "breakout" };
    const sources = {
      connect: connectPrData,
      cache: storedIntents(storage, CACHED_DIFFS),
      pinOf: (diff) => readDiffPin(document, diff),
    } satisfies IntentSources;
    // Read before watching, so a sidebar saved on the left never opens on the right first.
    const side = sideChoiceOf(await readSavedSide());

    watchFilesPages(
      window,
      {
        onVisit: (route, visit) => {
          const intent = shareIntent((onProgress) => intentFor(route, visit, sources, onProgress));
          return (page, signal) => {
            showVisit(page, signal, { intent, diffstat });
            dockSidebar(page, signal, { choice: side, save: saveSide });
          };
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});

/** The stored sidebar side, unchecked, or the default when storage won't read. */
const readSavedSide = (): Promise<unknown> =>
  sidebarSide.getValue().catch((error: unknown) => {
    console.error("gh-prism: reading the sidebar side failed", error);
    return sidebarSide.fallback;
  });

/** The side to dock on: `saved`, when it names one, else the default. */
function sideChoiceOf(saved: unknown): SideChoice {
  // `fallback` covers only a missing side; a corrupt one reads back as stored.
  return { side: saved === "left" || saved === "right" ? saved : sidebarSide.fallback };
}

const saveSide = (picked: Side) =>
  sidebarSide
    .setValue(picked)
    .catch((error: unknown) => console.error("gh-prism: saving the sidebar side failed", error));
