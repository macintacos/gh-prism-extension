import { describe, expect, it } from "vitest";
import type { CommitHead, PrRef } from "../../../utils/github/pr-ref";
import {
  diffPinFromEmbeddedData,
  prEmbeddedDataFromHtml,
  prHeadShaFromEmbeddedData,
  readDiffPin,
  readPrPageHeadSha,
  readViewedSeed,
  viewedFromEmbeddedData,
} from "../../../utils/github/pr-ref";
import commitFilterFixture from "../../fixtures/viewed-commit-filter-page.html?raw";
import viewedFixture from "../../fixtures/viewed-files-page.html?raw";

const sha = "a".repeat(40);
const base = "b".repeat(40);
const pr: PrRef = { kind: "pr", owner: "macintacos", repo: "gh-prism-sandbox", number: 2 };

const payload = (
  number: number,
  ownerLogin: string,
  name: string,
  headSha = sha,
  baseSha: unknown = base,
) =>
  JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number, headSha, headRepositoryOwnerLogin: "someone-else" },
        repository: { ownerLogin, name },
      },
      pullRequestsChangesRoute: { diffContents: [{ oldCommitOid: baseSha }] },
    },
  });

describe("prHeadShaFromEmbeddedData", () => {
  it.each([
    ["the matching PR", payload(2, "macintacos", "gh-prism-sandbox")],
    ["owner and repo differing only in case", payload(2, "MacIntacos", "GH-Prism-Sandbox")],
  ])("returns the head SHA for %s", (_, json) => {
    expect(prHeadShaFromEmbeddedData(json, pr)).toBe(sha);
  });

  it.each([
    ["another PR number", payload(3, "macintacos", "gh-prism-sandbox")],
    ["another owner", payload(2, "someone", "gh-prism-sandbox")],
    ["another repo", payload(2, "macintacos", "other")],
    [
      "a payload without pullRequestsLayoutRoute",
      '{"payload":{"repoPullsDashboardContentRoute":{}}}',
    ],
    [
      "a headSha that isn't 40 lowercase hex",
      payload(2, "macintacos", "gh-prism-sandbox", "A".repeat(40)),
    ],
    ["invalid JSON", "{not json"],
    ["null", null],
    ["undefined", undefined],
  ])("returns undefined for %s", (_, json) => {
    expect(prHeadShaFromEmbeddedData(json, pr)).toBeUndefined();
  });

  it("ignores the fork owner", () => {
    const forkPr = { ...pr, owner: "someone-else" };
    expect(
      prHeadShaFromEmbeddedData(payload(2, "macintacos", "gh-prism-sandbox"), forkPr),
    ).toBeUndefined();
  });
});

describe("prEmbeddedDataFromHtml", () => {
  it("extracts the embedded JSON from surrounding markup", () => {
    const json = payload(2, "macintacos", "gh-prism-sandbox");
    const html = `<html><body><div>x</div><script type="application/json" data-target="react-app.embeddedData">${json}</script><script>y()</script></body></html>`;
    expect(prEmbeddedDataFromHtml(html)).toBe(json);
  });

  it("returns undefined when the script is absent", () => {
    expect(prEmbeddedDataFromHtml("<html><script>y()</script></html>")).toBeUndefined();
  });
});

describe("readPrPageHeadSha", () => {
  it("reads the head SHA from the page's embedded data script", () => {
    let seen = "";
    const doc = {
      querySelector: (s: string) => {
        seen = s;
        return { textContent: payload(2, "macintacos", "gh-prism-sandbox") };
      },
    };

    expect(readPrPageHeadSha(doc, pr)).toBe(sha);
    expect(seen).toBe('script[data-target="react-app.embeddedData"]');
  });
});

describe("diffPinFromEmbeddedData", () => {
  it("pins the diff at the page's head and base", () => {
    expect(diffPinFromEmbeddedData(payload(2, "macintacos", "gh-prism-sandbox"), pr)).toEqual({
      baseSha: base,
      headSha: sha,
    });
  });

  const withBase = (baseSha: unknown) => payload(2, "macintacos", "gh-prism-sandbox", sha, baseSha);

  it.each([
    [
      "missing",
      payload(2, "macintacos", "gh-prism-sandbox").replace(`"oldCommitOid":"${base}"`, ""),
    ],
    ["empty", withBase("")],
    ["uppercase hex", withBase("B".repeat(40))],
    ["39 hex digits", withBase("b".repeat(39))],
    ["a branch name", withBase("main")],
    ["a number", withBase(42)],
  ])("has no pin when the base is %s", (_, json) => {
    expect(diffPinFromEmbeddedData(json, pr)).toBeUndefined();
  });

  it.each([
    ["the head isn't a full SHA", payload(2, "macintacos", "gh-prism-sandbox", "a".repeat(7))],
    ["the data names another PR", payload(3, "macintacos", "gh-prism-sandbox")],
  ])("has no pin when %s", (_, json) => {
    expect(diffPinFromEmbeddedData(json, pr)).toBeUndefined();
  });
});

describe("readDiffPin", () => {
  const doc = {
    querySelector: () => ({ textContent: payload(2, "macintacos", "gh-prism-sandbox") }),
  };

  it("reads the pin from the page's embedded data", () => {
    expect(readDiffPin(doc, pr)).toEqual({ baseSha: base, headSha: sha });
  });

  it("has no pin for a commit", () => {
    const commit: CommitHead = {
      kind: "commit",
      owner: "macintacos",
      repo: "gh-prism-sandbox",
      headSha: sha,
    };
    expect(readDiffPin(doc, commit)).toBeUndefined();
  });
});

const viewedPr: PrRef = { ...pr, number: 3 };

const viewedPayload = (changes: unknown) =>
  JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number: 3 },
        repository: { ownerLogin: "macintacos", name: "gh-prism-sandbox" },
      },
      pullRequestsChangesRoute: changes,
    },
  });

const viewedChanges = {
  diffSummaries: [{ pathDigest: "ab12", markedAsViewed: true }],
  user: { shouldShowViewedFilesCount: true },
};

describe("viewedFromEmbeddedData", () => {
  it("reads every file's Viewed state and the page-wide offer", () => {
    expect(viewedFromEmbeddedData(prEmbeddedDataFromHtml(viewedFixture), viewedPr)).toEqual({
      offered: true,
      viewed: new Map([
        ["c9bd6e09f349b0f93c557afe2376f4a9345a21b5daed12c6af0a714773aba693", true],
        ["b1a35a68f14e696205874893c07fd24fdb88882b47c23cc0e0c80a30c7d53759", false],
        ["13ee4b2252c9e516a0547f2891aa2105c3ca71c6d7a1e682c69be97998dfc87e", false],
      ]),
    });
  });

  it("has no seed for the commit-filtered route", () => {
    expect(
      viewedFromEmbeddedData(prEmbeddedDataFromHtml(commitFilterFixture), viewedPr),
    ).toBeUndefined();
  });

  it("has no seed when the data names another PR", () => {
    expect(
      viewedFromEmbeddedData(prEmbeddedDataFromHtml(viewedFixture), { ...viewedPr, number: 4 }),
    ).toBeUndefined();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["no diffSummaries", viewedPayload({ ...viewedChanges, diffSummaries: undefined })],
    ["diffSummaries not an array", viewedPayload({ ...viewedChanges, diffSummaries: {} })],
    [
      "an entry without pathDigest",
      viewedPayload({ ...viewedChanges, diffSummaries: [{ markedAsViewed: true }] }),
    ],
    [
      "a non-hex pathDigest",
      viewedPayload({
        ...viewedChanges,
        diffSummaries: [{ pathDigest: "src/a.ts", markedAsViewed: true }],
      }),
    ],
    [
      "a non-boolean markedAsViewed",
      viewedPayload({
        ...viewedChanges,
        diffSummaries: [{ pathDigest: "ab12", markedAsViewed: "true" }],
      }),
    ],
    ["a missing shouldShowViewedFilesCount", viewedPayload({ ...viewedChanges, user: {} })],
  ])("has no seed for %s", (_, json) => {
    expect(viewedFromEmbeddedData(json, viewedPr)).toBeUndefined();
  });
});

describe("readViewedSeed", () => {
  const doc = { querySelector: () => ({ textContent: viewedPayload(viewedChanges) }) };

  it("reads the seed from the page's embedded data", () => {
    expect(readViewedSeed(doc, viewedPr)).toEqual({
      offered: true,
      viewed: new Map([["ab12", true]]),
    });
  });

  it("has no seed for a commit", () => {
    const commit: CommitHead = {
      kind: "commit",
      owner: "macintacos",
      repo: "gh-prism-sandbox",
      headSha: sha,
    };
    expect(readViewedSeed(doc, commit)).toBeUndefined();
  });
});
