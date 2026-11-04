import { basename } from "node:path";
import { ADDON_GUID, AMO_PAGE, type AmoFetch, credentialsRefused } from "./api";

/** A public pull request AMO's reviewers can open; the other sandbox repository is private. */
export const SANDBOX_PR =
  "https://github.com/excessive-dev/gh-prism-codeowners-sandbox/pull/1/changes";

const DEVELOPER_HUB = "https://addons.mozilla.org/developers/addon/gh-prism/edit";
const UPLOAD_POLL_MS = 5000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export const REVIEWER_NOTES = `gh-prism sorts a GitHub pull request's changed files into sections on its Files changed tab, and works on commit pages too. Reviewing it needs a GitHub sign-in (any free account): gh-prism runs on GitHub's new Files changed tab, a feature preview you turn on while signed in (README.md, section "Troubleshooting", in the sources zip).

To try it, sign in to github.com and open this public pull request: ${SANDBOX_PR}. The sidebar lists its files under Implementation, Tests, Docs & Comments, Config, and Generated / lockfiles, and a file with code owners shows a shield on hover.

Build instructions are in README.md, section "Build from source", in the sources zip. A release build inlines its release notes from WXT_RELEASE_NOTES into content-scripts/content.js for the sidebar's What's new; this first version was built without them.

web-ext lint's UNSAFE_VAR_ASSIGNMENT warnings all come from libraries bundled into content-scripts/content.js: @pierre/trees, a file-tree library, and the Preact it renders with (three), and micromark, which parses commit messages as Markdown (two: its decode-named-character-reference sets a detached element's innerHTML to an "&name;" entity, and its own document().write is not the DOM's). gh-prism's own code sets no innerHTML.`;

/** AMO's license slug from LICENSE's first line, such as `MIT` from "MIT License". */
export function licenseSlug(licenseText: string): string {
  const match = /^(\S+) License$/.exec(licenseText.split("\n")[0]?.trim() ?? "");
  if (!match?.[1]) {
    throw new Error(`LICENSE's first line names no license: ${licenseText.split("\n")[0]}`);
  }
  return match[1];
}

const htmlBlockEnd = (line: string) => {
  const tag = /^<(details|picture)\b/.exec(line)?.[1];
  return tag === undefined ? null : `</${tag}>`;
};

/** README.md's opening through § What it does, flattened into the Markdown AMO renders. */
export function readmeDescription(readme: string, homepage: string): string {
  const lines = readme.split("\n");
  const start = lines.findIndex((line) => line.startsWith("# ")) + 1;
  const whatItDoes = lines.indexOf("## What it does");
  const end = lines.findIndex((line, i) => i > whatItDoes && line.startsWith("## "));

  const out: string[] = [];
  let skipUntil: string | null = null;
  for (const line of lines.slice(start, end)) {
    if (skipUntil !== null) {
      if (line.startsWith(skipUntil)) skipUntil = null;
      continue;
    }
    skipUntil = htmlBlockEnd(line);
    // Inline <kbd> can open a wrapped line; any other leading tag is an HTML block.
    if (skipUntil !== null || /^<(?!kbd>)/.test(line)) continue;

    const heading = /^#{2,3} (.*)$/.exec(line)?.[1];
    const text = line.trim();
    const previous = out.at(-1);
    if (heading !== undefined) {
      out.push("", `**${heading}**`, "");
    } else if (text === "" || text.startsWith("- ") || !previous) {
      out.push(text);
    } else {
      out[out.length - 1] = `${previous} ${text}`;
    }
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replaceAll("](#", `](${homepage}#`)
    .trim();
}

/** The `docs/images/*-light.png` screenshots in README.md's order, each once. */
export function readmeScreenshots(readme: string): string[] {
  return [...new Set(readme.match(/docs\/images\/[\w-]+-light\.png/g))];
}

export interface ListingFields {
  manifestName: string;
  summary: string;
  description: string;
  homepage: string;
  supportUrl: string;
  license: string;
}

/** The JSON body for AMO's `POST /addons/addon/`, listing gh-prism with its first version. */
export function listingPayload(input: ListingFields & { uploadUuid: string }) {
  const en = (value: string) => ({ "en-US": value });
  return {
    categories: { firefox: ["web-development"] },
    default_locale: "en-US",
    slug: "gh-prism",
    name: en(input.manifestName),
    summary: en(input.summary),
    description: en(input.description),
    homepage: en(input.homepage),
    support_url: en(input.supportUrl),
    version: { upload: input.uploadUuid, license: input.license, approval_notes: REVIEWER_NOTES },
  };
}

const ADDON_PATH = `/addons/addon/${ADDON_GUID}/`;

/** Whether AMO already has gh-prism's add-on; throws when AMO refuses the credentials. */
export async function listingExists(amo: AmoFetch): Promise<boolean> {
  const { status } = await amo(ADDON_PATH);
  if (status === 200) return true;
  if (status === 404) return false;
  if (status === 401 || status === 403) throw new Error(credentialsRefused(status));
  throw new Error(`AMO answered HTTP ${status} for ${ADDON_GUID}`);
}

export interface CreateListingDeps {
  amo: AmoFetch;
  sleep: (ms: number) => Promise<void>;
  readFile: (path: string) => Buffer;
  version: string;
  xpi: string;
  sourcesZip: string;
  screenshots: string[];
  fields: ListingFields;
  log: (message: string) => void;
}

interface Upload {
  uuid: string;
  processed: boolean;
  valid: boolean;
  url?: string;
  validation?: { messages?: { type: string }[] };
}

const form = (entries: Record<string, string | [Buffer, string]>) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === "string") body.append(name, value);
    else body.append(name, new Blob([new Uint8Array(value[0])]), value[1]);
  }
  return body;
};

async function ok(response: Response, what: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`AMO refused ${what} (HTTP ${response.status}): ${await response.text()}`);
  }
  return response;
}

async function processedUpload(deps: CreateListingDeps): Promise<Upload> {
  const sent = await ok(
    await deps.amo("/addons/upload/", {
      method: "POST",
      body: form({ upload: [deps.readFile(deps.xpi), basename(deps.xpi)], channel: "listed" }),
    }),
    "the upload",
  );
  const { uuid } = (await sent.json()) as Upload;
  for (let waited = 0; waited <= UPLOAD_TIMEOUT_MS; waited += UPLOAD_POLL_MS) {
    const upload = (await (
      await ok(await deps.amo(`/addons/upload/${uuid}/`), "the upload check")
    ).json()) as Upload;
    if (upload.processed) return { ...upload, uuid };
    await deps.sleep(UPLOAD_POLL_MS);
  }
  throw new Error(`AMO did not process upload ${uuid} within 10 minutes`);
}

async function attachmentProblem(response: Response, part: string): Promise<string | null> {
  return response.ok ? null : `${part}: ${await response.text()}`;
}

/** Creates gh-prism's AMO listing with its first version, sources zip, and screenshots. */
export async function createListing(deps: CreateListingDeps): Promise<void> {
  const upload = await processedUpload(deps);
  if (!upload.valid) {
    const errors = (upload.validation?.messages ?? []).filter((m) => m.type === "error").length;
    throw new Error(`AMO found ${errors} errors in the upload: ${upload.url}`);
  }

  await ok(
    await deps.amo("/addons/addon/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(listingPayload({ ...deps.fields, uploadUuid: upload.uuid })),
    }),
    "the new add-on",
  );

  const problems: string[] = [];
  const source = await attachmentProblem(
    await deps.amo(`${ADDON_PATH}versions/${deps.version}/`, {
      method: "PATCH",
      body: form({ source: [deps.readFile(deps.sourcesZip), basename(deps.sourcesZip)] }),
    }),
    `the sources zip ${deps.sourcesZip}`,
  );
  if (source) problems.push(source);
  for (const [position, path] of deps.screenshots.entries()) {
    const problem = await attachmentProblem(
      await deps.amo(`${ADDON_PATH}previews/`, {
        method: "POST",
        body: form({ image: [deps.readFile(path), basename(path)], position: String(position) }),
      }),
      path,
    );
    if (problem) problems.push(problem);
  }

  deps.log(`Created ${AMO_PAGE}; edit it at ${DEVELOPER_HUB}`);
  if (problems.length > 0) {
    throw new Error(
      `The add-on exists, but add these by hand at ${DEVELOPER_HUB}:\n${problems.join("\n")}`,
    );
  }
}
