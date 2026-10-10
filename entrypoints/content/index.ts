import { defineContentScript } from "wxt/utils/define-content-script";
import { connectPrData } from "@/utils/pr-port";
import { watchFilesPages } from "./files-page";
import { intentFor } from "./intent";
import { showSections } from "./sections-view";

export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  main(ctx) {
    watchFilesPages(
      window,
      {
        onPage: (page, route, signal) =>
          showSections(page, signal, (onProgress) =>
            intentFor(route, signal, connectPrData, onProgress),
          ),
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
