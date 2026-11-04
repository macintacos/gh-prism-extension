import { defineContentScript } from "wxt/utils/define-content-script";
import { dressConversationFrame, showFrameReviewerFiles } from "./content/conversation/frame";

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  allFrames: true,
  runAt: "document_start",
  main: () => {
    dressConversationFrame(window);
    // Never aborts: the frame's document never navigates, as its links out go to the parent.
    showFrameReviewerFiles(window, fetch, new AbortController().signal);
  },
});
