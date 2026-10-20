/**
 * Adds a link beside the file tree's filter-options button that opens a prefilled issue for a
 * file gh-prism put in the wrong section.
 */

import { type FilesPage, findFilterOptions, isPublicRepo } from "../files-page";
import { el, icon } from "../ui/dom";
// ?inline: a plain import would ship in the manifest, styling every github.com page.
import css from "./report.css?inline";

export interface ReportOptions {
  /** The repo the Files view belongs to, to confirm the page's visibility is its own. */
  readonly repo: { readonly owner: string; readonly repo: string };
  /** The Files view's URL, prefilled only on a public repo. */
  readonly diffUrl: string;
  /** The installed extension's version. */
  readonly version: string;
}

/** Octicons 19.15.0 (MIT, GitHub Inc.): report. */
const REPORT =
  "M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z";

// Template file and field ids must match .github/ISSUE_TEMPLATE/miscategorized.yml.
function reportUrl(diffUrl: string | undefined, version: string): string {
  const url = new URL("https://github.com/macintacos/gh-prism-extension/issues/new");
  url.searchParams.set("template", "miscategorized.yml");
  if (diffUrl) url.searchParams.set("diff-url", diffUrl);
  url.searchParams.set("version", version);
  return url.href;
}

/**
 * Adds the report link just after GitHub's filter-options button, until `signal` aborts. The
 * diff's URL is prefilled only when the page shows `repo` is public.
 */
export function showReportLink(
  page: FilesPage,
  signal: AbortSignal,
  { repo, diffUrl, version }: ReportOptions,
): void {
  const filterOptions = findFilterOptions(page);
  if (!filterOptions) return;
  const doc = page.sidebar.ownerDocument;
  const style = Object.assign(doc.createElement("style"), { textContent: css });

  // A DOM clone of the filter row, such as a restored snapshot, can carry an earlier link.
  for (const stale of doc.querySelectorAll(".gh-prism-report")) stale.remove();
  // Primer's medium default IconButton, like GitHub's filter-options button beside it.
  const link = el(
    doc,
    "a",
    "gh-prism-report tw:relative tw:inline-grid tw:shrink-0 tw:place-content-center tw:size-[var(--control-medium-size,32px)] tw:rounded-medium tw:[border:var(--borderWidth-thin,1px)_solid_var(--button-default-borderColor-rest)] tw:bg-[var(--button-default-bgColor-rest)] tw:text-[color:var(--fgColor-muted)] tw:hover:bg-[var(--button-default-bgColor-hover)] tw:active:bg-[var(--button-default-bgColor-active)] tw:focus-visible:outline-2 tw:focus-visible:outline-focus-outline tw:focus-visible:outline-offset-2",
    icon(doc, REPORT, {}),
  );
  link.href = reportUrl(isPublicRepo(doc, repo) ? diffUrl : undefined, version);
  link.target = "_blank";
  link.rel = "noreferrer";
  link.setAttribute("aria-label", "Report a miscategorized file");

  filterOptions.after(link);
  doc.head.append(style);
  signal.addEventListener("abort", () => {
    link.remove();
    style.remove();
  });
}
