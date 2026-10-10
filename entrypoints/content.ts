export default defineContentScript({
  // TODO: a static match misses PRs reached by client-side navigation, and its path * also spans "/"
  // (blob/tree paths containing /pull/) — move to a pathname check on wxt:locationchange.
  matches: ["https://github.com/*/*/pull/*"],
  main() {
    console.log("gh-prism: content script loaded");
  },
});
