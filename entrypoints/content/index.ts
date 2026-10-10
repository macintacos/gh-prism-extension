import { defineContentScript } from "wxt/utils/define-content-script";
import { watchFilesPages } from "./files-page";
import { showSections } from "./sections-view";
import css from "./sections-view.css?raw";

export default defineContentScript({
  // Every GitHub page: soft navigation reaches a pull request without re-injecting the script.
  matches: ["https://github.com/*"],
  main(ctx) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    ctx.signal.addEventListener("abort", () => style.remove());
    watchFilesPages(
      window,
      {
        onPage: showSections,
        onMissing: () =>
          console.warn("gh-prism: Files changed tree not found; leaving GitHub's tree as is"),
      },
      ctx.signal,
    );
  },
});
