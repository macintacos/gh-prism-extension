export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrHead extends PrRef {
  headSha: string;
}

const EMBEDDED_DATA_SELECTOR = 'script[data-target="react-app.embeddedData"]';
const EMBEDDED_DATA_SCRIPT =
  /<script[^>]*data-target="react-app\.embeddedData"[^>]*>([\s\S]*?)<\/script>/;
const SHA = /^[0-9a-f]{40}$/;

function at(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return undefined;
    // Checked to be a non-null object just above.
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sameName(a: unknown, b: string): boolean {
  return typeof a === "string" && a.toLowerCase() === b.toLowerCase();
}

/**
 * The PR's head SHA from GitHub's embedded page data, or `undefined` unless that data
 * names `pr`.
 *
 * @remarks
 * The embedded script reflects the last full page load, not the current URL: after a soft
 * navigation it still holds the previous page's payload, hence the match check.
 */
export function prHeadShaFromEmbeddedData(
  json: string | null | undefined,
  pr: PrRef,
): string | undefined {
  if (json == null) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }
  const route = at(data, "payload", "pullRequestsLayoutRoute");
  const headSha = at(route, "pullRequest", "headSha");
  const matches =
    at(route, "pullRequest", "number") === pr.number &&
    sameName(at(route, "repository", "ownerLogin"), pr.owner) &&
    sameName(at(route, "repository", "name"), pr.repo);
  return matches && typeof headSha === "string" && SHA.test(headSha) ? headSha : undefined;
}

/** The embedded page-data JSON from a PR page's HTML, for contexts without a `DOMParser`. */
export function prEmbeddedDataFromHtml(html: string): string | undefined {
  return EMBEDDED_DATA_SCRIPT.exec(html)?.[1];
}

export function readPrPageHeadSha(
  doc: { querySelector(selectors: string): { textContent: string | null } | null },
  pr: PrRef,
): string | undefined {
  return prHeadShaFromEmbeddedData(doc.querySelector(EMBEDDED_DATA_SELECTOR)?.textContent, pr);
}
