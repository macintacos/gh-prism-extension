// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { prPage } from "../../../entrypoints/content/files-page";
import { showReportLink } from "../../../entrypoints/content/sidebar/report";

// Trimmed from PR #56's /changes file tree.
const FILTER_ROW = `
<div id="diff-file-tree-filter" class="d-flex flex-nowrap gap-2">
  <input type="text" aria-label="Filter files…">
  <div class="position-relative" id="filter-options">
    <button data-component="IconButton" type="button" aria-haspopup="true" aria-label="Filter options"></button>
  </div>
</div>`;

const DIFF_URL = "https://github.com/o/r/pull/1/changes";

let controller: AbortController;

const link = () => document.querySelector<HTMLAnchorElement>(".gh-prism-report");

function mount() {
  const page = { kind: prPage, sidebar: document.body, tree: document.body, diffs: document.body };
  showReportLink(page, controller.signal, {
    repo: { owner: "o", repo: "r" },
    diffUrl: DIFF_URL,
    version: "1.2.3",
  });
}

function setMetas(metas: Record<string, string>) {
  document.head.innerHTML = Object.entries(metas)
    .map(
      ([name, content]) =>
        `<meta name="octolytics-dimension-repository_${name}" content="${content}">`,
    )
    .join("");
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = FILTER_ROW;
  controller = new AbortController();
});

afterEach(() => controller.abort());

it.each<{ visibility: string; metas: Record<string, string>; diffUrl: string | null }>([
  { visibility: "public", metas: { public: "true", nwo: "o/r" }, diffUrl: DIFF_URL },
  { visibility: "private", metas: { public: "false", nwo: "o/r" }, diffUrl: null },
  { visibility: "unknown", metas: {}, diffUrl: null },
])(
  "prefills the report form for a $visibility repo, with the diff's URL only when public",
  ({ metas, diffUrl }) => {
    setMetas(metas);

    mount();

    const params = new URL(link()?.href ?? "").searchParams;
    expect(params.get("template")).toBe("miscategorized.yml");
    expect(params.get("version")).toBe("1.2.3");
    expect(params.get("diff-url")).toBe(diffUrl);
  },
);

it("places a new-tab link right after the filter-options button", () => {
  mount();

  expect(link()?.previousElementSibling?.id).toBe("filter-options");
  expect(link()?.target).toBe("_blank");
  expect(link()?.rel).toBe("noreferrer");
  expect(link()?.getAttribute("aria-label")).toBe("Report a miscategorized file");
});

it("adds nothing without a filter row", () => {
  document.body.innerHTML = "";

  mount();

  expect(link()).toBeNull();
});

it("replaces a link a restored snapshot carries", () => {
  document
    .querySelector("#filter-options")
    ?.after(Object.assign(document.createElement("a"), { className: "gh-prism-report" }));

  mount();

  expect(document.querySelectorAll(".gh-prism-report")).toHaveLength(1);
});

it("removes the link and its style on abort", () => {
  mount();
  const styleCount = document.head.querySelectorAll("style").length;

  controller.abort();

  expect(link()).toBeNull();
  expect(document.head.querySelectorAll("style")).toHaveLength(styleCount - 1);
});
