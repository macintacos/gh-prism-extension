import { defineContentScript } from "wxt/utils/define-content-script";
import { dressConversationFrame } from "./content/conversation/frame";

export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  allFrames: true,
  runAt: "document_start",
  main: () => dressConversationFrame(window),
});
