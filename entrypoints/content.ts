export default defineContentScript({
  matches: ["https://github.com/*/*/pull/*"],
  main() {
    console.log("gh-prism: content script loaded");
  },
});
