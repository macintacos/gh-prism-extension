import { defineContentScript } from "wxt/utils/define-content-script";
import { connectPrData } from "@/utils/pr-port";
import type { DiffstatChoice } from "./diffstat-view";
import { watchFilesPages } from "./files-page";
import { intentFor } from "./intent";
import { shareIntent, showSections } from "./sections-view";

export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  runAt: "document_start",
  main(ctx) {
    const diffstat: DiffstatChoice = { view: "breakout" };
    watchFilesPages(
      window,
      {
        onVisit: (route, visit) => {
          const intent = shareIntent((onProgress) =>
            intentFor(route, visit, connectPrData, onProgress),
          );
          return (page, signal) => showSections(page, signal, { intent, diffstat });
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
