import { defineContentScript } from "wxt/utils/define-content-script";
import { dressConversationFrame, showFrameReviewerFiles } from "./content/conversation/frame";

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  allFrames: true,
  runAt: "document_start",
  main: (ctx) => {
    dressConversationFrame(window);
    showFrameReviewerFiles(window, fetch, ctx.signal);
  },
});
