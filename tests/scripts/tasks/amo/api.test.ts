import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AMO_API,
  AMO_KEYS_PAGE,
  addonStatus,
  amoFetch,
  amoJwt,
  checkAmo,
} from "../../../../scripts/tasks/amo/api";
import { amoWith, status } from "../../../fixtures/amo";
import { routedFetch } from "../../../fixtures/fetch";

const credentials = { issuer: "user:1:2", secret: "s3cret" };
const ADDON = `${AMO_API}/addons/addon/gh-prism@excessive.dev/`;

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("amoJwt", () => {
  it("signs an HS256 token whose claims expire 60 seconds after issue", () => {
    const token = amoJwt(credentials, 1000, "abc");

    const [header, payload, signature] = token.split(".") as [string, string, string];

    expect(decode(header)).toEqual({ alg: "HS256", typ: "JWT" });
    expect(decode(payload)).toEqual({ iss: "user:1:2", jti: "abc", iat: 1000, exp: 1060 });
    expect(signature).toBe(
      createHmac("sha256", "s3cret").update(`${header}.${payload}`).digest("base64url"),
    );
  });
});

describe("amoFetch", () => {
  it("prefixes AMO's API and authorizes each call with a fresh JWT", async () => {
    const { fetch, amo } = amoWith({ [`${AMO_API}/x/`]: status(200) });

    await amo("/x/");

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${AMO_API}/x/`);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      `JWT ${amoJwt(credentials, 1000, "nonce")}`,
    );
  });

  it("signs every call with its own token", async () => {
    const fetch = routedFetch({ [`${AMO_API}/x/`]: status(200) });
    let n = 0;
    const amo = amoFetch(
      credentials,
      fetch,
      () => 1000,
      () => `nonce-${n++}`,
    );

    await amo("/x/");
    await amo("/x/");

    const tokens = fetch.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get("Authorization"),
    );
    expect(tokens).toEqual([
      `JWT ${amoJwt(credentials, 1000, "nonce-0")}`,
      `JWT ${amoJwt(credentials, 1000, "nonce-1")}`,
    ]);
  });
});

describe("addonStatus", () => {
  it("is listed when AMO has the add-on, after a single GET", async () => {
    const { amo, fetch } = amoWith({ [ADDON]: status(200) });

    expect(await addonStatus(amo)).toEqual({ listed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.method ?? "GET").toBe("GET");
  });

  it("is unlisted when AMO has no such add-on", async () => {
    const { amo } = amoWith({ [ADDON]: status(404) });

    expect(await addonStatus(amo)).toEqual({ listed: false });
  });

  it("names the credentials problem when AMO refuses them", async () => {
    const { amo } = amoWith({ [ADDON]: status(401) });

    const result = await addonStatus(amo);

    expect("problem" in result && result.problem).toMatch(/refused FIREFOX_JWT_ISSUER/);
  });
});

describe("checkAmo", () => {
  it("is ready when AMO has the add-on", async () => {
    const { amo } = amoWith({ [ADDON]: status(200) });

    expect(await checkAmo(amo)).toBeNull();
  });

  it("asks for new credentials when AMO refuses them", async () => {
    const { amo } = amoWith({ [ADDON]: status(401) });

    const problem = await checkAmo(amo);

    expect(problem).toContain("HTTP 401");
    expect(problem).toContain(AMO_KEYS_PAGE);
  });

  it("points at the listing workflow when the add-on doesn't exist", async () => {
    const { amo } = amoWith({ [ADDON]: status(404) });

    expect(await checkAmo(amo)).toContain("amo-listing.yml");
  });

  it("reports any other status", async () => {
    const { amo } = amoWith({});

    expect(await checkAmo(amo)).toContain("HTTP 500");
  });

  it("refuses a Firefox-only run of a version AMO already has", async () => {
    const { amo } = amoWith({ [ADDON]: status(200), [`${ADDON}versions/1.2.3/`]: status(200) });

    expect(await checkAmo(amo, "1.2.3")).toContain("already has gh-prism 1.2.3");
  });

  it("is ready for a Firefox-only run of a version AMO lacks", async () => {
    const { fetch, amo } = amoWith({
      [ADDON]: status(200),
      [`${ADDON}versions/1.2.3/`]: status(404),
    });

    const problem = await checkAmo(amo, "1.2.3");

    expect(problem).toBeNull();
    expect(fetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "GET"]);
  });
});
