import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AMO_API } from "../../../../scripts/tasks/amo/api";
import {
  createListing,
  licenseSlug,
  listingPayload,
  readmeDescription,
  readmeScreenshots,
  SANDBOX_PR,
} from "../../../../scripts/tasks/amo/listing";
import { amoWith, status } from "../../../fixtures/amo";
import type { routedFetch } from "../../../fixtures/fetch";

const HOMEPAGE = "https://github.com/macintacos/gh-prism-extension";
const ADDON = `${AMO_API}/addons/addon/gh-prism@excessive.dev/`;
const UPLOAD = `${AMO_API}/addons/upload/`;
const README = readFileSync("README.md", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { description: string };

const json = (value: unknown, code = 200) => status(code, JSON.stringify(value));

const payloadFields = {
  manifestName: "gh-prism: Sectioned Pull Request Review",
  summary: pkg.description,
  description: "desc",
  homepage: HOMEPAGE,
  supportUrl: `${HOMEPAGE}/issues`,
  license: "MIT",
};

describe("licenseSlug", () => {
  it("reads the license name from LICENSE's first line", () => {
    expect(licenseSlug(readFileSync("LICENSE", "utf8"))).toBe("MIT");
  });

  it("throws on a first line that names no license", () => {
    expect(() => licenseSlug("Copyright 2026\n")).toThrow();
  });
});

describe("readmeDescription", () => {
  const fixture = [
    "# gh-prism",
    "",
    "First paragraph",
    "<kbd>Shift</kbd>+<kbd>&#92;</kbd> wraps here.",
    "",
    "<picture>",
    '  <img src="x.png">',
    "</picture>",
    "",
    "## What it does",
    "",
    "See [Troubleshooting](#troubleshooting).",
    "",
    "### Sections",
    "",
    "- A bullet",
    "  continues.",
    "",
    "## Install",
    "",
    "Not included.",
  ].join("\n");

  it("flattens README.md's opening into AMO's Markdown subset", () => {
    expect(readmeDescription(fixture, HOMEPAGE)).toBe(
      [
        "First paragraph `Shift`+`\\` wraps here.",
        "",
        "**What it does**",
        "",
        `See [Troubleshooting](${HOMEPAGE}#troubleshooting).`,
        "",
        "**Sections**",
        "",
        "- A bullet continues.",
      ].join("\n"),
    );
  });

  it("leaves no HTML or relative anchors in the real README's description", () => {
    const description = readmeDescription(README, HOMEPAGE);

    expect(description.split("\n").some((line) => line.startsWith("<"))).toBe(false);
    expect(description).not.toContain("<kbd>");
    expect(description).not.toContain("](#");
    expect(description).toContain("**Sections in a sidebar**");
  });
});

describe("readmeScreenshots", () => {
  it("lists the README's light screenshots in order, each an existing file", () => {
    const screenshots = readmeScreenshots(README);

    expect(screenshots[0]).toBe("docs/images/hero-light.png");
    expect(new Set(screenshots).size).toBe(screenshots.length);
    expect(screenshots.every((path) => existsSync(path))).toBe(true);
  });
});

describe("listingPayload", () => {
  it("builds AMO's add-on body around the upload, with the reviewer notes", () => {
    const payload = listingPayload({ ...payloadFields, uploadUuid: "uuid-1" });

    expect(payload).toMatchObject({
      categories: { firefox: ["web-development"] },
      default_locale: "en-US",
      slug: "gh-prism",
      name: { "en-US": payloadFields.manifestName },
      summary: { "en-US": pkg.description },
      description: { "en-US": "desc" },
      homepage: { "en-US": HOMEPAGE },
      support_url: { "en-US": `${HOMEPAGE}/issues` },
      version: { upload: "uuid-1", license: "MIT" },
    });
    expect(payload.version.approval_notes).toContain(SANDBOX_PR);
  });

  it("uses package.json's description as a summary AMO accepts", () => {
    expect(pkg.description.length).toBeLessThanOrEqual(250);
    expect(pkg.description).not.toMatch(/https?:/);
  });
});

describe("createListing", () => {
  const screenshots = ["docs/images/a-light.png", "docs/images/b-light.png"];

  const VERSION = `${ADDON}versions/1.0.0/`;
  const PREVIEWS = `${ADDON}previews/`;

  const flowRoutes = (previews: () => Promise<Response>) => ({
    [UPLOAD]: json({ uuid: "uuid-1" }),
    [`${UPLOAD}uuid-1/`]: json({ processed: true, valid: true }),
    [`${AMO_API}/addons/addon/`]: json({ guid: "gh-prism@excessive.dev" }, 201),
    [VERSION]: json({}),
    [PREVIEWS]: previews,
  });

  const deps = (amo: ReturnType<typeof amoWith>["amo"]) => ({
    amo,
    sleep: vi.fn(() => Promise.resolve()),
    readFile: (path: string) => Buffer.from(path),
    version: "1.0.0",
    xpi: ".output/gh-prism-1.0.0-firefox.zip",
    sourcesZip: ".output/gh-prism-1.0.0-sources.zip",
    screenshots,
    fields: payloadFields,
    log: vi.fn(),
  });

  const calls = (fetch: ReturnType<typeof routedFetch>) =>
    fetch.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`);

  it("uploads, creates the add-on, then attaches the sources and screenshots", async () => {
    const { amo, fetch } = amoWith(flowRoutes(json({})));

    await createListing(deps(amo));

    expect(calls(fetch)).toEqual([
      `POST ${UPLOAD}`,
      `GET ${UPLOAD}uuid-1/`,
      `POST ${AMO_API}/addons/addon/`,
      `PATCH ${VERSION}`,
      `POST ${PREVIEWS}`,
      `POST ${PREVIEWS}`,
    ]);
    const create = fetch.mock.calls[2]?.[1];
    expect(JSON.parse(String(create?.body)).version.upload).toBe("uuid-1");
  });

  it("uploads the xpi by its file name to the listed channel", async () => {
    const { amo, fetch } = amoWith(flowRoutes(json({})));

    await createListing(deps(amo));

    const body = fetch.mock.calls[0]?.[1]?.body as FormData;
    expect(body.get("channel")).toBe("listed");
    expect((body.get("upload") as File).name).toBe("gh-prism-1.0.0-firefox.zip");
  });

  it("attaches the sources zip and each screenshot at its position", async () => {
    const { amo, fetch } = amoWith(flowRoutes(json({})));

    await createListing(deps(amo));

    const [source, ...previews] = fetch.mock.calls
      .slice(3)
      .map(([, init]) => init?.body as FormData);
    expect((source?.get("source") as File | undefined)?.name).toBe("gh-prism-1.0.0-sources.zip");
    expect(previews.map((b) => [(b.get("image") as File).name, b.get("position")])).toEqual([
      ["a-light.png", "0"],
      ["b-light.png", "1"],
    ]);
  });

  it("polls an unprocessed upload every 5 seconds", async () => {
    let checks = 0;
    const processing = () =>
      json(checks++ === 0 ? { processed: false } : { processed: true, valid: true })();
    const { amo } = amoWith({ ...flowRoutes(json({})), [`${UPLOAD}uuid-1/`]: processing });
    const listingDeps = deps(amo);

    await createListing(listingDeps);

    expect(listingDeps.sleep.mock.calls).toEqual([[5000]]);
  });

  it("stops at an upload answer without a uuid", async () => {
    const { amo, fetch } = amoWith({ ...flowRoutes(json({})), [UPLOAD]: json({}) });

    await expect(createListing(deps(amo))).rejects.toThrow(/no uuid/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("still sends every screenshot, then names the one AMO refused", async () => {
    let n = 0;
    const refuseFirst = () => (n++ === 0 ? status(400, "too small")() : json({})());
    const { amo, fetch } = amoWith(flowRoutes(refuseFirst));

    await expect(createListing(deps(amo))).rejects.toThrow(/docs\/images\/a-light\.png: too small/);
    expect(calls(fetch).filter((call) => call === `POST ${PREVIEWS}`)).toHaveLength(2);
  });

  it("still sends every screenshot, then names a refused sources zip", async () => {
    const { amo, fetch } = amoWith({ ...flowRoutes(json({})), [VERSION]: status(400, "bad zip") });

    await expect(createListing(deps(amo))).rejects.toThrow(/sources\.zip: bad zip/);
    expect(calls(fetch).filter((call) => call === `POST ${PREVIEWS}`)).toHaveLength(2);
  });

  it("still sends every screenshot, then names one whose request failed", async () => {
    let n = 0;
    const dropFirst = () => (n++ === 0 ? Promise.reject(new Error("ECONNRESET")) : json({})());
    const { amo, fetch } = amoWith(flowRoutes(dropFirst));

    await expect(createListing(deps(amo))).rejects.toThrow(/a-light\.png: Error: ECONNRESET/);
    expect(calls(fetch).filter((call) => call === `POST ${PREVIEWS}`)).toHaveLength(2);
  });

  it("stops before creating the add-on when AMO finds the upload invalid", async () => {
    const { amo, fetch } = amoWith({
      ...flowRoutes(json({})),
      [`${UPLOAD}uuid-1/`]: json({
        processed: true,
        valid: false,
        validation: { messages: [{ type: "error" }, { type: "error" }, { type: "warning" }] },
        url: "https://amo/upload/uuid-1",
      }),
    });

    await expect(createListing(deps(amo))).rejects.toThrow(/2 errors.*https:\/\/amo\/upload/);
    expect(calls(fetch)).not.toContain(`POST ${AMO_API}/addons/addon/`);
  });
});
