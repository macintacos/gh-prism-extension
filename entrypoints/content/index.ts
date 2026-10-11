import { defineContentScript } from "wxt/utils/define-content-script";
import { storage } from "wxt/utils/storage";
import { connectPrData } from "@/utils/pr-port";
import type { DiffstatChoice } from "./diffstat-view";
import { watchFilesPages } from "./files-page";
import { intentFor } from "./intent";
import { storedIntents } from "./intent-cache";
import { shareIntent, showSections } from "./sections-view";
import { dockSidebar, type Side, type SideChoice } from "./sidebar-side";

const CACHED_DIFFS = 50;

export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  runAt: "document_start",
  async main(ctx) {
    const diffstat: DiffstatChoice = { view: "breakout" };
    const sources = { connect: connectPrData, cache: storedIntents(storage, CACHED_DIFFS) };
    const savedSide = storage.defineItem<unknown>("sync:sidebarSide");
    // Read before watching, so a sidebar saved on the left never opens on the right first.
    const side: SideChoice = { side: (await savedSide.getValue()) === "left" ? "left" : "right" };
    const save = (picked: Side) =>
      savedSide
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
            showSections(page, signal, { intent, diffstat });
            dockSidebar(page.sidebar.ownerDocument, signal, { choice: side, save });
          };
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
