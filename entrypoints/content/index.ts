import { defineContentScript } from "wxt/utils/define-content-script";
import { connectPrData } from "@/utils/pr-port";
import { docPathsFor } from "./doc-paths";
import { readFilesRoute, watchFilesPages } from "./files-page";
import { showSections } from "./sections-view";

export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  main(ctx) {
    watchFilesPages(
      window,
      {
        onPage: (page, signal) => {
          const route = readFilesRoute(location.pathname);
          showSections(page, signal, route && docPathsFor(route, signal, connectPrData));
        },
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
