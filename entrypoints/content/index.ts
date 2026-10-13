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
    // `fallback` covers only a missing side; a corrupt one reads back as stored.
    const saved: unknown = await sidebarSide.getValue().catch((error: unknown) => {
      console.error("gh-prism: reading the sidebar side failed", error);
      return sidebarSide.fallback;
    });
    const side: SideChoice = {
      side: saved === "left" || saved === "right" ? saved : sidebarSide.fallback,
    };
    const save = (picked: Side) =>
      sidebarSide
        .setValue(picked)
        .catch((error: unknown) =>
          console.error("gh-prism: saving the sidebar side failed", error),
        );
    watchFilesPages(
      window,
      {
        onVisit: (route, visit) => {
          const intent = shareIntent((onProgress) => intentFor(route, visit, sources, onProgress));
          return (page, signal) => {
            showVisit(page, signal, { intent, diffstat });
            dockSidebar(page, signal, { choice: side, save });
          };
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
