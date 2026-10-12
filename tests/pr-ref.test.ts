import { describe, expect, it } from "vitest";
import type { PrRef } from "../utils/pr-ref";
import {
  prEmbeddedDataFromHtml,
  prHeadShaFromEmbeddedData,
  readPrPageHeadSha,
} from "../utils/pr-ref";

const sha = "a".repeat(40);
const pr: PrRef = { kind: "pr", owner: "macintacos", repo: "gh-prism-sandbox", number: 2 };

const payload = (number: number, ownerLogin: string, name: string, headSha = sha) =>
  JSON.stringify({
    payload: {
      pullRequestsLayoutRoute: {
        pullRequest: { number, headSha, headRepositoryOwnerLogin: "someone-else" },
        repository: { ownerLogin, name },
      },
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
